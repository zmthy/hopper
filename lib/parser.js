// Provides the 'parse' function, which transforms a list of lexed tokens into a
// list of Grace AST nodes.

"use strict";

var ast, lexer, lookahead;

ast = require("./ast");
lexer = require("./lexer");

function isMathOperator(op) {
  return op === "^" || op === "/" || op === "*" || op === "+" || op === "-";
}

function precedence(lhs, rhs) {
  var left, right;

  left = lhs.value;
  right = rhs.value;

  if (left === right) {
    return true;
  }

  if (!isMathOperator(left) || !isMathOperator(right)) {
    throw "Mismatched operators " + left + " and " + right;
  }

  return left === "^" || ((left === "/" || left === "*") && right !== "^") ||
    ((left === "+" || left === "-") && (right === "+" || right === "-"));
}

function slice(ctx, from, to) {
  return Array.prototype.slice.call(ctx, from, to);
}

lookahead = {

  keyword: function (value, parser) {
    return this.value("keyword", value, parser);
  },

  symbol: function (value, parser) {
    return this.value("symbol", value, parser);
  },

  punctuation: function (value, parser) {
    return this.value("punctuation", value, parser);
  },

  newline: function (parser) {
    parser.test = function () {
      var token = this.peek("newline");
      return token && (token.type === "newline" || token.value === ";");
    };

    return parser;
  },

  identifier: function (parser) {
    return this.type("identifier", parser);
  },

  operator: function (parser) {
    return this.type("symbol", parser);
  },

  string: function (parser) {
    return this.type("string", parser);
  },

  number: function (parser) {
    return this.type("number", parser);
  },

  value: function (type, value, parser) {
    parser.test = function () {
      var token = this.peek(type);

      return token.type === type &&
        ((typeof value === "string" && token.value === value) ||
          (typeof value === "function" && value(token.value)));
    };

    return parser;
  },

  type: function (type, parser) {
    parser.test = function (value) {
      var token = this.peek(type);

      return token.type === type &&
        (typeof value !== "string" || token.value === value);
    };

    return parser;
  },

  parsers: function (name) {
    var after, i, l, parser, parsers;

    function run(test, failure) {
      return function () {
        var pName, result;

        for (i = 0; i < l; i += 1) {
          pName = parsers[i];
          if (this.test(pName)) {
            if (test) {
              return test;
            }

            result = this.one(pName);
            return after ? after.call(this, result) : result;
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

    parser = run(false, function () { this.error(name); });
    parser.test = run(true, function () { return false; });

    return parser;
  }

};

function Parser(lexer) {
  this.lexer = lexer;
  this.indent = 0;
  this.token = null;
}

Parser.prototype.module = function () {
  var nodes = [];

  this.on("dialect", function (dialect) {
    nodes.push(dialect);
  });

  nodes = nodes.concat(this.any("import"));

  return nodes.concat(this.objectBody());
};

Parser.prototype.newline = lookahead.newline(function () {
  var indent, token;

  token = this.peek("newline");

  // A close brace counts as an implicit newline and may change indentation,
  // otherwise indentation must match.
  if (token.value !== "}") {
    if (token.value === ";") {
      this.poll();
    } else if (token.type !== "eot") {
      indent = this.expect("newline").indent;

      if (indent !== this.indent && this.peek().value !== "}") {
        throw "Indent must match previous line";
      }
    }
  }
});

Parser.prototype.def = lookahead.keyword("def", function () {
  var annotations, ident, pattern, value;

  this.keyword("def");
  ident = this.identifier();

  pattern = this.on("symbol", ":", function () {
    return this.expression();
  });

  annotations = this.lone("annotations") || [];

  this.symbol("=");
  value = this.expression();
  this.newline();

  return new ast.Def(ident, pattern, annotations, value);
});

Parser.prototype["var"] = lookahead.keyword("var", function () {
  var annotations, ident, pattern, value;

  this.keyword("var");
  ident = this.identifier();

  pattern = this.on("symbol", ":", function () {
    return this.expression();
  });

  annotations = this.lone("annotations", true) || [];

  value = this.on("symbol", ":=", function () {
    return this.expression();
  });

  this.newline();

  return new ast.Var(ident, pattern, annotations, value);
});

Parser.prototype.declOrLiteral = lookahead.keyword("type", function () {
  var annotations, generics, name, value;

  this.keyword("type");

  if (this.test("punctuation", "{")) {
    return this.typeBraces();
  }

  name = this.identifier();

  this.on("symbol", "<", function () {
    generics = this.commas("identifier");
    this.symbol(">");
  });

  annotations = this.lone("annotations") || [];

  this.symbol("=");

  if (this.test("punctuation", "{")) {
    value = this.braces(function () {
      return new ast.Type(this.any("typeBody"));
    });
  } else {
    value = this.expression();
  }

  this.newline();

  return new ast.TypeDeclaration(name, generics || [], annotations, value);
});

Parser.prototype.type = lookahead.keyword("type", function () {
  this.keyword("type");
  return this.typeBraces();
});

Parser.prototype.typeBraces = lookahead.punctuation("{", function () {
  return this.braces(function () {
    return new ast.Type(this.any("typeBody"));
  });
});

Parser.prototype.typeBody = lookahead.parsers("signature", "signature",
  function (signature) {
    this.newline();
    return signature;
  });

Parser.prototype.object = lookahead.keyword("object", function () {
  var annotations;

  this.keyword("object");

  annotations = this.lone("annotations", true) || [];

  return this.braces(function () {
    return new ast.ObjectConstructor(annotations, this.objectBody());
  });
});

Parser.prototype.method = lookahead.keyword("method", function () {
  this.keyword("method");
  return this.methodRest("methodBody", function (signature, body) {
    return new ast.Method(signature, body);
  });
});

Parser.prototype["class"] = lookahead.keyword("class", function () {
  this.keyword("class");
  return this.methodRest("objectBody", function (signature, body) {
    return new ast.Method(signature, [new ast.ObjectConstructor([], body)]);
  });
});

Parser.prototype.methodRest = lookahead.identifier(function (parser, make) {
  var signature = this.signature();

  return this.braces(function () {
    return make.call(this, signature, this.one(parser));
  });
});

Parser.prototype.signature = lookahead.identifier(function () {
  var first, signature;

  first = this.one("signaturePart", false);
  signature = first.parameters.length === 0 || first.name.isOperator ?
      [first] : [first].concat(this.any("signaturePart", true));

  signature.pattern = this.on("symbol", "->", function () {
    return this.expression();
  });

  signature.annotations = this.lone("annotations", true) || [];

  return signature;
});

Parser.prototype.signaturePart = lookahead.identifier(function (required) {
  var generics, name, params;

  if (!required) {
    this.on("operator", function (operator) {
      name = operator;
      required = true;
    });
  }

  name = name || this.identifier();

  if (!name.isOperator) {
    this.on("symbol", "<", function () {
      generics = this.commas("identifier");
      this.symbol(">");
    });
  }

  if (!required) {
    if (name.value === "prefix") {
      this.on("operator", function (operator) {
        name = operator;
        name.value = "prefix" + operator.value;
      });

      if (name.isOperator) {
        return new ast.SignaturePart(name, [], []);
      }
    }

    this.on("symbol", ":=", function () {
      name.value += " :=";
      required = true;
    });
  }

  params = this[required ? "one" : "lone"]("parentheses", function () {
    return name.isOperator ? [this.parameter()] : this.commas("parameter");
  }) || [];

  return new ast.SignaturePart(name, generics || [], params);
});

Parser.prototype.parameter =
  lookahead.parsers("parameter", "vararg", "binding");

Parser.prototype.vararg = lookahead.symbol("*", function () {
  this.symbol("*");
  return new ast.Parameter(this.parameterName(), this.parameterType(), true);
});

Parser.prototype.binding =
  lookahead.parsers("parameter", "parameterName", function (name) {
    return new ast.Parameter(name, this.parameterType(), false);
  });

Parser.prototype.parameterName =
  lookahead.parsers("parameter", "identifier", "underscore");

Parser.prototype.parameterType = function () {
  return this.on("symbol", ":", function () {
    return this.expression();
  });
};

// Require one or more of the given parsings, separated by commas.
Parser.prototype.commas = function (parser) {
  var results = [];

  function comma(result) {
    results.push(result);

    this.on("punctuation", ",", function () {
      comma.call(this, this.one(parser));
    });
  }

  comma.call(this, this.one(parser));

  return results;
};

Parser.prototype.braces = lookahead.punctuation("{", function (f) {
  var result, state;

  state = this.indent;

  result = this.wrapped("{", "}", function () {
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

  this.indent = state;

  return result;
});

Parser.prototype.parentheses = lookahead.punctuation("(", function (f) {
  return this.wrapped("(", ")", f || this.expression);
});

Parser.prototype.wrapped = function (o, c, f) {
  var result;

  this.punctuation(o);
  result = f.call(this);
  this.punctuation(c);

  return result;
};

Parser.prototype.dialect = lookahead.keyword("dialect", function () {
  var path;

  this.keyword("dialect");
  path = this.string();
  this.newline();

  return new ast.Dialect(path);
});

Parser.prototype["import"] = lookahead.keyword("import", function () {
  var path, ident;

  this.keyword("import");
  path = this.string();
  this.identifier("as");
  ident = this.identifier();
  this.newline();

  return new ast.Import(path, ident);
});

Parser.prototype.inherits = lookahead.keyword("inherits", function () {
  var request;

  this.keyword("inherits");
  request = this.expression();

  if (request.constructor !== ast.Request) {
    // This error will peek at the next token, which cannot be part of an
    // expression, as expression parsing is always greedy. The error should
    // make sense as a result.
    this.error("request");
  }

  this.newline();

  return new ast.Inherits(request);
});

Parser.prototype["return"] = lookahead.keyword("return", function () {
  var expression;

  this.keyword("return");
  expression = this.lone("expression");
  this.newline();

  return new ast.Return(expression);
});

Parser.prototype.statement = lookahead.parsers("statement",
  "def", "var", "declOrLiteral", "return", "expressionLine", "newline");

Parser.prototype.expression = lookahead.parsers("expression",
  "preBinaryOperator", function (expression) {
    function buildBinary(lhs, op, rhs) {
      return new ast.Request(lhs, [new ast.RequestPart(op, [], [rhs])]);
    }

    // Parse trailing binary operator requests.
    function operators(lhs, lop, rhs) {
      return this.on("operator", function (rop) {
        if (precedence(lop, rop)) {
          return operators.call(this,
            buildBinary(lhs, lop, rhs), rop, this.preBinaryOperator());
        }

        return operators.call(this, lhs, lop,
          buildBinary(rhs, rop, this.preBinaryOperator()));
      }) || buildBinary(lhs, lop, rhs);
    }

    // Avoid consuming generic closing parameters.
    if (this.generics && this.peek().value[0] === ">") {
      return expression;
    }

    return this.on("operator", function (op) {
      return operators.call(this, expression, op, this.preBinaryOperator());
    }) || expression;
  });

// Parse an expression up to a binary operator.
Parser.prototype.preBinaryOperator = lookahead.parsers("expression",
  "object", "type", "unqualifiedRequest", "literal",
  "self", "super", "parentheses", "prefixOperator", function (expression) {
    // Parse trailing dot requests.
    function requests(expression) {
      return this.on("dotRequest", function (signature) {
        return requests.call(this, new ast.Request(expression, signature));
      }) || expression;
    }

    return requests.call(this, expression);
  });

// Expressions may appear alone on a single line, in which case they become a
// statement.
Parser.prototype.expressionLine = lookahead.parsers("expression line",
  "expression", function (expression) {
    this.newline();
    return expression;
  });

Parser.prototype.prefixOperator = lookahead.operator(function () {
  var prefix = this.operator();

  prefix.value = "prefix" + prefix.value;

  return new ast.Request(this.expression(),
    [new ast.RequestPart(prefix, [], [])]);
});

// Parse a request with no receiver.
Parser.prototype.unqualifiedRequest = lookahead.identifier(function () {
  return new ast.Request(null, this.requestSignature());
});

// Parse the signature part of a request, resulting in a list of signature
// parts.
Parser.prototype.request = lookahead.parsers("request signature",
  "dotRequest", "binaryRequestSignature");

// Parse a dot-requested signature.
Parser.prototype.dotRequest = lookahead.punctuation(".", function () {
  this.punctuation(".");
  return this.requestSignature();
});

// Parse a request signature whose parts are identifiers.
Parser.prototype.requestSignature = lookahead.identifier(function () {
  var first = this.requestPart(false);
  return first.parameters.length === 0 ? [first] :
      [first].concat(this.any("requestPart", true));
});

Parser.prototype.requestPart = lookahead.identifier(function (required) {
  var args, generics, name, state;

  name = this.identifier();

  if (this.test("symbol", "<")) {
    state = this.generics;

    generics = this.attempt(function () {
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

      return types;
    });

    this.generics = state;
  }

  this.on(this.strict ? "numberOrString" : "literal", function (arg) {
    args = [arg];

    if (arg.constructor !== ast.Block && this.test("punctuation", ".")) {
      throw "Method requests on literal parameters must be wrapped";
    }
  });

  if (!required && !this.strict && args === undefined) {
    this.on("symbol", ":=", function () {
      name.value += " :=";
      args = [this.expression()];
    });
  }

  args = args || this[required ? "one" : "lone"]("parentheses", function () {
    return this.commas("expression");
  }) || [];

  return new ast.RequestPart(name, generics || [], args);
});

// Parse the signature of a binary operator request.
Parser.prototype.binaryRequestSignature = lookahead.operator(function () {
  return [new ast.RequestPart(this.operator(), [], [this.expression()])];
});

Parser.prototype.self = lookahead.keyword("self", function () {
  this.keyword("self");
  return new ast.Request(null,
    [new ast.RequestPart(new ast.Identifier("self"), [], [])]);
});

Parser.prototype["super"] = lookahead.keyword("super", function () {
  this.keyword("super");
  return new ast.Request(new ast.Super(), this.request());
});

Parser.prototype.block = lookahead.punctuation("{", function () {
  return this.braces(function () {
    var body, parameters;

    body = [];

    parameters = this.attempt(function () {
      var params = this.commas("parameter");
      this.symbol("->");
      return params;
    }) || [];

    return new ast.Block(parameters, body.concat(this.any("statement")));
  });
});

Parser.prototype.annotations = lookahead.keyword("is", function (strict) {
  var state, values;

  this.keyword("is");
  state = this.strict;
  this.strict = strict;
  values = this.commas("expression");
  this.strict = state;

  return values;
});

Parser.prototype.literal =
  lookahead.parsers("literal", "block", "string", "number");

Parser.prototype.numberOrString =
  lookahead.parsers("literal", "string", "number");

Parser.prototype.string = lookahead.string(function () {
  var concat, interpolation, string, token;

  token = this.expect("string");
  string = new ast.StringLiteral(token.value);

  if (token.interpolation) {
    concat = new ast.Identifier("++", true);
    interpolation = new ast.Request(string,
      [new ast.RequestPart(concat, [], [this.expression()])]);

    // The newline allows the string to return to its previous indentation.
    this.lone("newline");
    this.punctuation("}");
    this.token = this.lexer.nextToken(true);

    return new ast.Request(interpolation,
      [new ast.RequestPart(concat, [], [this.string()])]);
  }

  return string;
});

Parser.prototype.number = lookahead.number(function () {
  return new ast.NumberLiteral(this.expect("number").value);
});

Parser.prototype.objectBody = function () {
  var body = [];

  this.on("inherits", function (inherits) {
    body.push(inherits);
  });

  return body.concat(this.any("statementOrMethod"));
};

Parser.prototype.methodBody = function () {
  return this.any("statement");
};

Parser.prototype.statementOrMethod =
  lookahead.parsers("statement or method", "statement", "method", "class");

// Expect and consume a certain keyword.
Parser.prototype.keyword = lookahead.type("keyword", function (key) {
  var token = this.expect("keyword", "keyword " + key);

  if (token.value !== key) {
    this.error("keyword " + key, token);
  }
});

// Expect and parse the given identifier as a keyword.
Parser.prototype.contextualKeyword = lookahead.type("identifier",
  function (key) {
    var token = this.expect("identifier", "keyword " + key);

    if (token.value !== key) {
      this.error("keyword " + key, token);
    }
  });

// Expect and consume a certain symbol.
Parser.prototype.symbol = lookahead.type("symbol", function (sym) {
  var token = this.expect("symbol", "symbol " + sym);

  if (token.value !== sym) {
    this.error("symbol " + sym, token);
  }
});

// Expect and consume a certain piece of punctuation.
Parser.prototype.punctuation = lookahead.type("punctuation", function (sym) {
  var token = this.expect("punctuation", "punctuation " + sym);

  if (token.value !== sym) {
    this.error("punctuation " + sym, token);
  }
});

// Expect and parse an operator.
Parser.prototype.operator = lookahead.value("symbol", function (symbol) {
  return symbol !== "=" && symbol !== "->" && symbol !== ":=";
}, function () {
  return new ast.Identifier(this.expect("symbol", "operator").value, true);
});

// Expect and parse an identifier.
Parser.prototype.identifier = lookahead.identifier(function () {
  return new ast.Identifier(this.expect("identifier").value);
});

Parser.prototype.underscore = lookahead.punctuation("_", function () {
  this.punctuation("_");
  return new ast.Identifier("_");
});

// Expect a certain type of token, throwing away newlines in between. May be
// provided with a second type which will be used instead of the first for
// error reporting.
Parser.prototype.expect = function (type, etype) {
  var token;

  if (type !== "newline") {
    this.trim();
  }

  token = this.poll();

  if (token === null || token.type !== type) {
    this.error(etype || type, token);
  }

  return token;
};

// Trim out leading newlines from the token queue whose indent is greater than
// the current indent.
Parser.prototype.trim = function () {
  var token = this.peek("newline");

  while (token.type === "newline" && token.indent > this.indent) {
    this.poll();
    token = this.peek("newline");
  }
};

// Poll the token queue, removing and returning the first element.
Parser.prototype.poll = function () {
  var token = this.token;

  if (token !== null) {
    if (token.type !== "eot") {
      this.token = null;
    }
  } else {
    token = this.lexer.nextToken();
    this.token = token;
  }

  return token;
};

// Peek at the token queue, returning the first element, skipping over
// newlines whose indent is greater than the current indent. Optionally takes
// the type of the token to search for, to avoid skipping over newlines when
// newlines are being searched for.
Parser.prototype.peek = function (type) {
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
};

Parser.prototype.error = function (type, token) {
  if (token === undefined) {
    token = this.peek();
  }

  throw "Expected " + type + ", but found '" + token + "'";
};

Parser.prototype.test = function (parser) {
  return this[parser].test.apply(this, slice(arguments, 1));
};

Parser.prototype.one = function (parser) {
  return this[parser].apply(this, slice(arguments, 1));
};

Parser.prototype.lone = function () {
  return this.test.apply(this, arguments) ?
      this.one.apply(this, arguments) : null;
};

Parser.prototype.any = function () {
  var result, results;

  results = [];

  while (this.test.apply(this, arguments)) {
    result = this.one.apply(this, arguments);

    if (typeof result === "object") {
      results.push(result);
    }
  }

  return results;
};

Parser.prototype.many = function () {
  return [this.one.apply(this, arguments)]
    .concat(this.any.apply(this, arguments));
};

Parser.prototype.on = function () {
  var args, l;

  l = arguments.length - 1;
  args = slice(arguments, 0, l);

  return this.test.apply(this, args) ?
      arguments[l].call(this, this.one.apply(this, args)) : null;
};

Parser.prototype.attempt = function (f) {
  var lexer, result, token;

  lexer = this.lexer;
  token = this.token;

  this.lexer = lexer.clone();

  try {
    result = f.call(this);
  } catch (error) {
    this.lexer = lexer;
    this.token = token;
  }

  return result;
};

// Parse a token stream.
function parse(code) {
  var module, parser, token;

  parser = new Parser(new lexer.Lexer(code));
  module = parser.module();

  do {
    token = parser.poll();
  } while (token.type !== "eot" && token.type === "newline");

  if (token.type !== "eot") {
    throw "Unexpected leftover token '" + token + "'";
  }

  return module;
}

exports.parse = parse;

