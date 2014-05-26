// Provides the 'parse' function, which transforms a list of lexed tokens into a
// list of Grace AST nodes.

"use strict";

var ast, lexer, lookahead, undefined;

ast = require("./ast");
lexer = require("./lexer");

// Parse a token stream.
function parse(code) {
  var module, parser, token;

  parser = new Parser(new lexer.Lexer(code));
  module = parser.module();

  do {
    token = parser.poll();
  } while (token !== null && token.type === "newline");

  if (token !== null) {
    throw "Unexpected leftover token '" + token + "'";
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
    parser.test = function(value) {
      var token = this.peek("newline");

      return token && (token.type === "newline" || token.value === ";");
    };

    return parser;
  },

  identifier: function(parser) {
    return this.type("identifier", parser);
  },

  operator: function(parser) {
    return this.type("symbol", parser);
  },

  string: function(parser) {
    return this.type("string", parser);
  },

  number: function(parser) {
    return this.type("number", parser);
  },

  value: function(type, value, parser) {
    parser.test = function() {
      var token = this.peek(type);

      return token.type === type &&
        (typeof value === "string" && token.value === value ||
          typeof value === "function" && value(token.value));
    };

    return parser;
  },

  type: function(type, parser) {
    parser.test = function(value) {
      var token = this.peek(type);

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

function Parser(lexer) {
  this.lexer = lexer;
  this.indent = 0;
  this.token = null;
}

Parser.prototype = {

  module: function() {
    var nodes = [];

    this.on("dialect", function(dialect) {
      nodes.push(dialect);
    });

    nodes = nodes.concat(this.any("import"));

    return nodes.concat(this.objectBody());
  },

  newline: lookahead.newline(function() {
    var indent, token;

    token = this.peek("newline");

    // A close brace counts as an implicit newline and may change indentation,
    // otherwise indentation must match.
    if (token.value !== "}") {
      if (token.value === ";") {
        this.poll();
      } else {
        indent = this.expect("newline").indent;

        if (indent !== this.indent && this.peek().value !== "}") {
          throw "Indent must match previous line"
        }
      }
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

  declOrLiteral: lookahead.keyword("type", function() {
    var generics, name, value;

    this.keyword("type");

    if (this.test("punctuation", "{")) {
      return this.typeBraces();
    }

    name = this.identifier();

    this.on("symbol", "<", function() {
      generics = this.commas("identifier");
      this.symbol(">");
    });

    this.symbol("=");

    if (this.test("punctuation", "{")) {
      value = this.braces(function() {
        return new ast.Type(this.any("typeBody"));
      });
    } else {
      value = this.expression();
    }

    this.newline();

    return new ast.TypeDeclaration(name, generics || [], value);
  }),

  type: lookahead.keyword("type", function() {
    this.keyword("type");
    return this.typeBraces();
  }),

  typeBraces: lookahead.punctuation("{", function() {
    return this.braces(function() {
      return new ast.Type(this.any("typeBody"));
    });
  }),

  typeBody: lookahead.parsers("signature", "signature", function(signature) {
    this.newline();
    return signature;
  }),

  object: lookahead.keyword("object", function() {
    this.keyword("object");
    return this.braces(function() {
      return new ast.ObjectConstructor(this.objectBody());
    });
  }),

  method: lookahead.keyword("method", function() {
    this.keyword("method");
    return this.methodRest("methodBody", function(signature, body) {
      return new ast.Method(signature, body);
    })
  }),

  "class": lookahead.keyword("class", function() {
    this.keyword("class");
    return this.methodRest("objectBody", function(signature, body) {
      return new ast.Method(signature, [new ast.ObjectConstructor(body)]);
    });
  }),

  methodRest: lookahead.identifier(function(parser, make) {
    var signature = this.signature();

    return this.braces(function() {
      return make.call(this, signature, this.one(parser));
    });
  }),

  signature: lookahead.identifier(function() {
    var first, signature;

    first = this.one("signaturePart", false);
    signature = first.parameters.length === 0 || first.name.isOperator ?
      [first] : [first].concat(this.any("signaturePart", true));

    signature.pattern = this.on("symbol", "->", function() {
      return this.expression();
    });

    return signature;
  }),

  signaturePart: lookahead.identifier(function(required) {
    var generics, name, params;

    if (!required) {
      this.on("operator", function(operator) {
        name = operator;
        required = true;
      });
    }

    name = name || this.identifier();

    if (!name.isOperator) {
      this.on("symbol", "<", function() {
        generics = this.commas("identifier");
        this.symbol(">");
      });
    }

    if (!required) {
      if (name.value === "prefix") {
        this.on("operator", function(operator) {
          name = operator;
          name.value = "prefix" + operator.value;
        });

        if (name.isOperator) {
          return new ast.SignaturePart(name, [], []);
        }
      }

      this.on("symbol", ":=", function() {
        name.value += " :=";
        required = true;
      });
    }

    params = this[required ? "one" : "lone"]("parentheses", function() {
      return name.isOperator ? [this.parameter()] : this.commas("parameter");
    }) || [];

    return new ast.SignaturePart(name, generics || [], params);
  }),

  parameter: lookahead.parsers("parameter",
      "identifier", "underscore", function(name) {
    return new ast.Parameter(name, this.on("symbol", ":", function() {
      return this.expression();
    }));
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
    var indent, result;

    indent = this.indent;

    result = this.wrapped("{", "}", function() {
      var indent, next;

      next = this.peek("newline");

      if (next.type === "newline") {
        next = this.poll();
        indent = next.indent;

        if (indent <= this.indent && this.peek().value !== "}") {
          throw "Invalid indent following opening brace";
        }

        this.indent = indent;
      }

      return f.call(this);
    });

    this.indent = indent;

    return result;
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

  inherits: lookahead.keyword("inherits", function() {
    var request;

    this.keyword("inherits");
    request = this.request();
    this.newline();

    return new ast.Inherits(request);
  }),

  "return": lookahead.keyword("return", function() {
    var expression;

    this.keyword("return");
    expression = this.lone("expression");
    this.newline();

    return new ast.Return(expression);
  }),

  statement: lookahead.parsers("statement",
    "def", "var", "declOrLiteral", "return", "expressionLine", "newline"),

  expression: lookahead.parsers("expression", "object", "type",
    "request", "literal", "parentheses", "prefix", postExpression),

  // Expressions may appear alone on a single line, in which case they become a
  // statement.
  expressionLine:
      lookahead.parsers("expression line", "expression", function(expression) {
    this.newline();
    return expression;
  }),

  prefix: lookahead.operator(function() {
    var prefix = this.operator();

    prefix.value = "prefix" + prefix.value;

    return new ast.Request(this.expression(),
      [new ast.RequestPart(prefix, [], [])]);
  }),

  request: lookahead.identifier(function(receiver) {
    var first = this.requestPart(false);

    // Performing the post-expression cleanup is already handled by the
    // expression parsing, but using it here as well ensures that this parse is
    // greedy enough to parse the current outermost request when a request parse
    // is called outside of a normal expression parse.
    return postExpression.call(this,
      new ast.Request(receiver || null,
        first.parameters.length === 0 || first.name.isOperator ?
        [first] : [first].concat(this.any("requestPart", true))));
  }),

  requestPart: lookahead.identifier(function(required) {
    var args, generics, name, state;

    name = name || this.identifier();

    if (this.test("symbol", "<")) {
      state = this.generics;
      this.attempt(function() {
        var next, types;
        this.symbol("<");
        this.generics = true;
        types = this.commas("expression");

        next = this.peek();
        if (next.value[0] === ">") {
          if (next.value.length === 1) {
            this.symbol(">");
          } else {
            // The lexer got confused and attached the closing chevron to some
            // following symbols. Rip out the chevron and leave the symbols.
            next.value = next.value.substring(1);
          }
        }

        generics = types;
      });
      this.generics = state;
    }

    this.on("literal", function(arg) {
      args = [arg];

      if (arg.constructor !== ast.Block && this.test("punctuation", ".")) {
        throw "Method requests on literal parameters must be wrapped";
      }
    });

    args = args || this[required ? "one" : "lone"]("parentheses", function() {
      return this.commas("expression");
    }) || [];

    return new ast.RequestPart(name, generics || [], args);
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
            [new ast.RequestPart(param.name, [], [])])));
          this.newline();
        }
      });

      return new ast.Block(parameters, body.concat(this.any("statement")));
    });
  }),

  literal: lookahead.parsers("literal", "block", "string", "number"),

  string: lookahead.string(function() {
    var concat, interpolation, string, token;

    token = this.expect("string");
    string = new ast.StringLiteral(token.value);

    if (token.interpolation) {
      concat = new ast.Identifier("++", true);
      interpolation = new ast.Request(string,
        [new ast.RequestPart(concat, [], [this.expression()])]);

      // The newline allows the string to return to it's previous indentation.
      this.lone("newline");
      this.punctuation("}");
      this.token = this.lexer.nextToken(true);

      return new ast.Request(interpolation,
        [new ast.RequestPart(concat, [], [this.string()])]);
    }

    return string;
  }),

  number: lookahead.number(function() {
    return new ast.NumberLiteral(this.expect("number").value);
  }),

  objectBody: function() {
    var body = [];

    this.on("inherits", function(inherits) {
      body.push(inherits);
    });

    return body.concat(this.any("statementOrMethod"));
  },

  methodBody: function() {
    return this.any("statement");
  },

  statementOrMethod:
    lookahead.parsers("statement or method", "statement", "method", "class"),

  // Expect and consume a certain keyword.
  keyword: lookahead.type("keyword", function(key) {
    var token = this.expect("keyword", "keyword " + key);

    if (token.value !== key) {
      this.error("keyword " + key, token);
    }
  }),

  // Expect and parse the given identifier as a keyword.
  contextualKeyword: lookahead.type("identifier", function(key) {
    var token = this.expect("identifier", "keyword " + key);

    if (token.value !== key) {
      this.error("keyword " + key, token);
    }
  }),

  // Expect and consume a certain symbol.
  symbol: lookahead.type("symbol", function(sym) {
    var token = this.expect("symbol", "symbol " + sym);

    if (token.value !== sym) {
      this.error("symbol " + sym, token);
    }
  }),

  // Expect and consume a certain piece of punctuation.
  punctuation: lookahead.type("punctuation", function(sym) {
    var token = this.expect("punctuation", "punctuation " + sym);

    if (token.value !== sym) {
      this.error("punctuation " + sym, token);
    }
  }),

  // Expect and parse an operator.
  operator: lookahead.value("symbol", function(symbol) {
    // Note that := is considered an operator, for the sake of the parsing in
    // the 'postExpression' function.
    return symbol !== "=" && symbol !== "->";
  }, function() {
    return new ast.Identifier(this.expect("symbol", "operator").value, true);
  }),

  // Expect and parse an identifier.
  identifier: lookahead.identifier(function() {
    return new ast.Identifier(this.expect("identifier").value);
  }),

  underscore: lookahead.punctuation("_", function() {
    this.punctuation("_");
    return new ast.Identifier("_");
  }),

  // Expect a certain type of token, throwing away newlines in between. May be
  // provided with a second type which will be used instead of the first for
  // error reporting.
  expect: function(type, etype) {
    var token;

    if (type !== "newline") {
      this.trim();
    }

    token = this.poll();

    if (token === null || token.type !== type) {
      this.error(etype || type, token);
    }

    return token;
  },

  // Trim out leading newlines from the token queue whose indent is greater than
  // the current indent.
  trim: function() {
    var token;

    while ((token = this.peek("newline")).type === "newline" &&
        token.indent > this.indent) {
      this.poll();
    }
  },

  // Poll the token queue, removing and returning the first element.
  poll: function() {
    var token = this.token;

    if (token !== null) {
      if (token.type === "eot") {
        return null;
      }

      this.token = null;
    } else {
      token = this.lexer.nextToken();

      if (token.type === "eot") {
        this.token = token;
      }
    }

    return token;
  },

  // Peek at the token queue, returning the first element, skipping over
  // newlines whose indent is greater than the current indent. Optionally takes
  // the type of the token to search for, to avoid skipping over newlines when
  // newlines are being searched for.
  peek: function(type) {
    var lexer, token;

    token = this.token;

    if (token !== null) {
      return this.token;
    }

    lexer = this.lexer;
    token = lexer.nextToken();

    if (type !== "newline") {
      while (token.type === "newline" && token.indent > this.indent) {
        token = lexer.nextToken();
      }
    }

    this.token = token;
    return token;
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

      if (typeof result === "object") {
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
  },

  attempt: function(f) {
    var lexer, token;

    lexer = this.lexer;
    token = this.token;

    this.lexer = lexer.clone();

    try {
      f.call(this);
    } catch(error) {
      this.lexer = lexer;
      this.token = token;
    }
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

  requests.call(this);

  if (this.generics && this.peek().value[0] === ">") {
    return expression;
  }

  return this.on("operator", function(operator) {
    var name, part, rhs, signature, value;

    value = operator.value;

    if (value === ":=") {
      if (expression.constructor === ast.Identifier) {
        expression.value += " :=";
        return new ast.Request(null,
          [new ast.RequestPart(expression, [], [this.expression()])]);
      } else if (expression.constructor === ast.Request &&
          (signature = expression.signature, signature.length === 1 &&
          (part = signature[0], part.parameters.length === 0))) {
        part.name.value += " :=";
        part.parameters = [this.expression()];
        return expression;
      } else {
        throw "Invalid left hand '" + expression + "' in assignment";
      }
    } else {
      rhs = this.expression();

      if (rhs.constructor === ast.Request) {
        name = rhs.signature[0].name;

        if (name.isOperator &&
            (name.value == value || precedence(value, name.value))) {
          // This operator has precedence.
          rhs.receiver = new ast.Request(expression,
            [new ast.RequestPart(operator, [], [rhs.receiver])]);
          return rhs;
        }
      }

      return new ast.Request(expression,
        [new ast.RequestPart(operator, [], [rhs])]);
    }
  }) || expression;
}

function isMathOperator(op) {
  return op === "^" || op === "/" || op === "*" || op === "+" || op === "-";
}

function precedence(left, right) {
  if (!isMathOperator(left) || !isMathOperator(right)) {
    throw "Mismatched operators " + left + " and " + right;
  }

  return left === "^" || (left === "/" || left === "*") && right !== "^" ||
    (left === "+" || left === "-") && (right === "+" || right === "-");
}

function slice(ctx, from, to) {
  return Array.prototype.slice.call(ctx, from, to);
}

exports.parse = parse;

