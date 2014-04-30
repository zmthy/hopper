// Provides the 'parse' function, which transforms a list of lexed tokens into a
// list of Grace AST nodes.

"use strict";

var ast, lookahead, undefined;

ast = require("./ast");

// Parse a token stream.
function parse(tokens) {
  var module, parser;

  parser = new Parser(tokens);
  module = parser.module();

  if ((tokens = parser.tokens).length > 0) {
    throw "Unexpected leftover token '" + tokens[0] + "'";
  }

  return module;
};

lookahead = {

  keyword: function(value, parser) {
    return this.value("keyword", value, parser);
  },

  symbol: function(value, parser) {
    return this.value("symbol", value, parser);
  },

  punctuation: function(value, parser) {
    return this.value("punctuation", value, parser);
  },

  newline: function(parser) {
    return this.type("newline", parser);
  },

  identifier: function(parser) {
    return this.type("identifier", parser);
  },

  string: function(parser) {
    return this.type("string", parser);
  },

  number: function(parser) {
    return this.type("number", parser);
  },

  value: function(type, value, parser) {
    parser.test = function() {
      var token = this.peek();
      return token.type === type &&
        (typeof value === "string" && token.value === value ||
          typeof value === "function" && value(token.value));
    };

    return parser;
  },

  type: function(type, parser) {
    parser.test = function(value) {
      var token = this.peek();
      return token.type === type &&
        (typeof value !== "string" || token.value === value);
    }

    return parser;
  },

  parsers: function(name) {
    var after, i, l, parser, parsers;

    function run(test, failure) {
      return function() {
        var parser, result;

        for (i = 0; i < l; i++) {
          parser = parsers[i];
          if (this.test(parser)) {
            return test || (result = this.one(parser),
              after ? after.call(this, result) : result);
          }
        }

        return failure.call(this);
      };
    }

    l = arguments.length;

    if (typeof arguments[l - 1] === "function") {
      after = arguments[l - 1];
      l -= 1;
    }

    parsers = Array.prototype.slice.call(arguments, 1, l);
    l = parsers.length;

    parser = run(false, function() { this.error(name); });
    parser.test = run(true, function() { return false; });

    return parser;
  }

};

function Parser(tokens) {
  var i, j, l;

  this.tokens = tokens = tokens.concat();

  for (i = 1, l = tokens.length; i < l; i++) {
    if (tokens[i].type === "newline") {
      j = ++i;
      while (j < l && tokens[j].type === "newline") { j++; }
      tokens.splice(i, j = j - i);
      l -= j;
    }
  }
}

Parser.prototype = {

  module: function() {
    var body, dialect, imports, nodes;

    nodes = [];

    dialect = this.lone("dialect");
    imports = this.any("import");
    body = this.any("statementOrMethod");

    if (dialect !== null) {
      nodes.push(dialect);
    }

    return nodes.concat(imports, body);
  },

  newline: lookahead.newline(function() {
    var token = this.peek();

    // A close brace counts as a newline.
    if (token.type !== "punctuation" || token.value !== "}") {
      this.expect("newline");
    }
  }),

  def: lookahead.keyword("def", function() {
    var ident, pattern, value;

    this.keyword("def");
    ident = this.identifier();

    pattern = this.on("symbol", ":", function() {
      return this.expression();
    });

    this.symbol("=");
    value = this.expression();
    this.newline();

    return new ast.Def(ident, pattern, value);
  }),

  "var": lookahead.keyword("var", function() {
    var ident, pattern, value;

    this.keyword("var");
    ident = this.identifier();

    pattern = this.on("symbol", ":", function() {
      return this.expression();
    });

    value = this.on("symbol", ":=", function() {
      return this.expression();
    });

    this.newline();

    return new ast.Var(ident, pattern, value);
  }),

  object: lookahead.keyword("object", function() {
    this.keyword("object");
    return this.braces(function() {
      return new ast.ObjectConstructor(this.any("statementOrMethod"));
    });
  }),

  method: lookahead.keyword("method", function() {
    this.keyword("method");
    return this.methodRest("statement", function(signature, pattern, body) {
      return new ast.Method(signature, pattern, body);
    })
  }),

  "class": lookahead.keyword("class", function() {
    this.keyword("class");
    return this.methodRest("statementOrMethod",
        function(signature, pattern, body) {
      return new ast.Method(signature, pattern,
        [new ast.ObjectConstructor(body)]);
    });
  }),

  methodRest: lookahead.identifier(function(parser, make) {
    var first, signature, pattern;

    first = this.one("signaturePart", false);
    signature = first.parameters.length === 0 ?
      [first] : [first].concat(this.any("signaturePart", true));

    pattern = this.on("symbol", "->", function() {
      this.expression();
    });

    return this.braces(function() {
      return make.call(this, signature, pattern, this.any(parser));
    });
  }),

  signaturePart: lookahead.identifier(function(required) {
    var name, params;

    name = this.identifier();

    if (!required) {
      this.on("symbol", ":=", function() {
        name.value += " :=";
        required = true;
      });
    }

    params = this[required ? "one" : "lone"]("parentheses", function() {
      return this.commas("parameter");
    }) || [];

    return new ast.SignaturePart(name, params);
  }),

  parameter: lookahead.identifier(function() {
    var name, pattern;

    name = this.identifier();
    pattern = this.on("symbol", ":", function() {
      return this.expression();
    });

    return new ast.Parameter(name, pattern);
  }),

  // Require one or more of the given parsings, separated by commas.
  commas: function(parser) {
    var results = [];

    function comma(result) {
      results.push(result);

      this.on("punctuation", ",", function() {
        comma.call(this, this.one(parser));
      });
    }

    comma.call(this, this.one(parser));

    return results;
  },

  braces: lookahead.punctuation("{", function(f) {
    return this.wrapped("{", "}", f);
  }),

  parentheses: lookahead.punctuation("(", function(f) {
    return this.wrapped("(", ")", f || this.expression);
  }),

  wrapped: function(o, c, f) {
    var result;

    this.punctuation(o);
    result = f.call(this);
    this.punctuation(c);

    return result;
  },

  dialect: lookahead.keyword("dialect", function() {
    var path;

    this.keyword("dialect")
    path = this.path();
    this.newline();

    return new ast.Dialect(path);
  }),

  "import": lookahead.keyword("import", function() {
    var path, ident;

    this.keyword("import");
    path = this.path();
    this.identifier("as");
    ident = this.identifier();
    this.newline();

    return new ast.Import(path, ident);
  }),

  statement:
    lookahead.parsers("statement", "def", "var", "expressionLine", "newline"),

  expression: lookahead.parsers("expression", "object",
    "request", "block", "number", "string", "parentheses", postExpression),

  // Expressions may appear alone on a single line, in which case they become a
  // statement.
  expressionLine:
      lookahead.parsers("expression line", "expression", function(expression) {
    this.newline();
    return expression;
  }),

  request: lookahead.identifier(function(receiver) {
    var first = this.requestPart(false);
    return new ast.Request(receiver || null, first.parameters.length === 0 ?
      [first] : [first].concat(this.any("requestPart", true)));
  }),

  requestPart: lookahead.identifier(function(required) {
    var name, args;

    name = this.identifier();
    args = this[required ? "one" : "lone"]("parentheses", function() {
      return this.commas("expression");
    }) || [];

    return new ast.RequestPart(name, args);
  }),

  block: lookahead.punctuation("{", function() {
    return this.braces(function() {
      var body, parameters;

      body = [];
      parameters = [];

      // This is the hard bit. An identifier here could be an expression or the
      // first parameter of the block. We start by trying a parameter parse.
      this.on("parameter", function(param) {
        var next = this.peek();

        // If the parameter has a pattern, or the following token is a comma or a
        // parameter arrow, then it was a parameter.
        if (param.pattern !== null || next.value === "," ||
            next.value === "->") {
          // Parse the remaining parameters if the next token is not an arrow.
          parameters = next.value === "->" ? [param] :
            [param].concat(this.on("punctuation", ",", function() {
              return this.commas("parameter");
            }) || []);

          // Require a parameter arrow.
          this.symbol("->");
        } else {
          // The expression couldn't have been a parameter, so it must have been a
          // plain identifier. Cast it to a simple Request, perform the
          // post-expression parsing, add it to the body, and end the line.
          body.push(postExpression.call(this, new ast.Request(null,
            [new ast.RequestPart(param.name, [])])));
          this.newline();
        }
      });

      return new ast.Block(parameters, body.concat(this.any("statement")));
    });
  }),

  string: lookahead.punctuation('"', function() {
    var string, tokens;

    string = "";
    tokens = this.tokens;

    this.wrapped('"', '"', function() {
      while (tokens[0].value !== '"') {
        string += tokens.shift();
      }
    });

    return new ast.StringLiteral(string);
  }),

  number: lookahead.number(function() {
    if (this.peek().type !== "number") {
      this.error("number");
    }

    return new ast.NumberLiteral(this.poll().value);
  }),

  statementOrMethod:
    lookahead.parsers("statement or method", "statement", "method", "class"),

  // Expect and consume a certain keyword.
  keyword: lookahead.type("keyword", function(key) {
    var token = this.poll();

    if (token.type !== "keyword" || token.value !== key) {
      this.error("keyword " + key);
    }
  }),

  // Expect and parse the given identifier as a keyword.
  contextualKeyword: lookahead.type("identifier", function(key) {
    var token = this.poll();

    if (token.type !== "identifier" || token.value !== key) {
      this.error("keyword " + key, token);
    }
  }),

  // Expect and consume a certain symbol.
  symbol: lookahead.type("symbol", function(sym) {
    var token = this.poll();

    if (token.type !== "symbol" || token.value !== sym) {
      this.error("symbol " + sym, token);
    }
  }),

  // Expect and consume a certain piece of punctuation.
  punctuation: lookahead.type("punctuation", function(sym) {
    var token = this.poll();

    if (token.type !== "punctuation" || token.value !== sym) {
      this.error("punctuation " + sym, token);
    }
  }),

  // Expect and parse an operator.
  operator: lookahead.value("symbol", function(symbol) {
    // Note that := is considered an operator, for the sake of the parsing in
    // the 'postExpression' function.
    return symbol !== "=" && symbol !== "->";
  }, function() {
    return new ast.Identifier(this.expect("symbol", "operator").value);
  }),

  // Expect and parse an identifier.
  identifier: lookahead.identifier(function() {
    return new ast.Identifier(this.expect("identifier").value);
  }),

  expect: function(type, etype) {
    var token = this.poll();

    if (token.type !== type) {
      this.error(etype || type, token);
    }

    return token;
  },

  // Poll the token queue, removing and returning the first element.
  poll: function() {
    var first;

    if (this.tokens.length === 0) {
      throw "Unexpected end of token stream";
    }

    first = this.tokens[0];
    this.tokens.shift();
    return first;
  },

  // Peek at the token queue, returning the first element.
  peek: function() {
    if (this.tokens.length === 0) {
      return {
        type: "eof",
        value: ""
      };
    }

    return this.tokens[0];
  },

  error: function(type, token) {
    if (token === undefined) {
      token = this.peek();
    }

    throw "Expected " + type + ", but found '" + token + "'";
  },

  test: function(parser) {
    return this[parser].test.apply(this, slice(arguments, 1));
  },

  one: function(parser) {
    return this[parser].apply(this, slice(arguments, 1));
  },

  lone: function(parser) {
    return this.test.apply(this, arguments) ?
      this.one.apply(this, arguments) : null;
  },

  any: function() {
    var result, results;

    results = [];

    while (this.test.apply(this, arguments)) {
      result = this.one.apply(this, arguments);

      if (result !== undefined) {
        results.push(result);
      }
    }

    return results;
  },

  many: function() {
    return [this.one.apply(this, arguments)]
      .concat(this.any.apply(this, arguments));
  },

  on: function() {
    var args, l;

    l = arguments.length - 1;
    args = slice(arguments, 0, l);

    return this.test.apply(this, args) ?
      arguments[l].call(this, this.one.apply(this, args)) : null;
  }

};

// Parsing an expression isn't greedy enough to parse requests with a receiver
// and operators. This function is applied after an expression is parsed to tidy
// up those cases.
function postExpression(expression) {
  function requests() {
    this.on("punctuation", ".", function() {
      expression = this.request(expression);
      requests.call(this);
    });
  }

  function operators() {
    this.on("operator", function(operator) {
      var part, signature;

      if (operator.value === ":=") {
        if (expression.constructor === ast.Identifier) {
          expression.value += " :=";
          expression = ast.Request(null,
            [new ast.RequestPart(expression, [this.expression()])]);
        } else if (expression.constructor === ast.Request &&
            (signature = expression.signature, signature.length === 1 &&
            (part = signature[0], part.parameters.length === 0))) {
          part.name.value += " :=";
          part.parameters = [this.expression()];
        } else {
          throw "Invalid left hand '" + expression + "' in assignment"
        }
      } else {
        expression = new ast.Request(expression,
          [new ast.RequestPart(operator, [this.expression()])]);
        operators.call(this);
      }
    });
  }

  requests.call(this);
  operators.call(this);
  return expression;
}

function slice(ctx, from, to) {
  return Array.prototype.slice.call(ctx, from, to);
}

exports.parse = parse;

