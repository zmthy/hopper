// Provides the 'parse' function, which transforms a list of lexed tokens into a
// list of Grace AST nodes.

"use strict";

var ast, error, lexer, lookahead, tokens, util;

ast = require("./ast");
error = require("./parser/error");
lexer = require("./parser/lexer");
tokens = require("./parser/tokens");
util = require("./util");

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
    error.raise(lhs, "Mismatched operators " + left + " and " + right);
  }

  return left === "^" || ((left === "/" || left === "*") && right !== "^") ||
    ((left === "+" || left === "-") && (right === "+" || right === "-"));
}

function slice(ctx, from, to) {
  return Array.prototype.slice.call(ctx, from, to);
}

lookahead = {

  keyword: function (value, parser) {
    return this.value(tokens.Keyword, value, parser);
  },

  symbol: function (value, parser) {
    return this.value(tokens.Symbol, value, parser);
  },

  punctuation: function (value, parser) {
    return this.value(tokens.Punctuation, value, parser);
  },

  newline: function (parser) {
    parser.test = function () {
      var token = this.peek("newline");
      return token &&
        (token.constructor === tokens.Newline || token.value === ";");
    };

    return parser;
  },

  identifier: function (parser) {
    return this.type(tokens.Identifier, parser);
  },

  operator: function (parser) {
    return this.type(tokens.Symbol, parser);
  },

  string: function (parser) {
    return this.type(tokens.StringLiteral, parser);
  },

  number: function (parser) {
    return this.type(tokens.NumberLiteral, parser);
  },

  value: function (type, value, parser) {
    parser.test = function () {
      var token = this.peek(type);

      return token.constructor === type &&
        ((typeof value === "string" && token.value === value) ||
          (typeof value === "function" && value(token.value)));
    };

    return parser;
  },

  type: function (type, parser) {
    parser.test = function (value) {
      var token = this.peek(type);

      return token.constructor === type &&
        (typeof value !== "string" || token.value === value);
    };

    return parser;
  },

  name: function (parser) {
    parser.test = function (value) {
      var token, type;

      token = this.peek();
      type = token.constructor;

      return (type === tokens.Identifier || type === tokens.Symbol) &&
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
    } else if (token.constructor !== tokens.EndOfInput) {
      token = this.poll();

      if (token.constructor !== tokens.Newline) {
        error.raise(token, "Unexpected appearance of " + token);
      }

      indent = token.indent;

      if (indent !== this.indent && this.peek().value !== "}") {
        error.raise(token, "Indent must match previous line");
      }
    }
  }
});

Parser.prototype.def = lookahead.keyword("def", function () {
  var annotations, ident, pattern, token, value;

  token = this.keyword("def");
  ident = this.identifier();

  this.inDef = true;

  pattern = this.on("symbol", ":", function () {
    return this.expression();
  });

  annotations = this.lone("annotations") || [];

  this.inDef = false;

  if (this.test("symbol", ":=")) {
    error.raise(this.poll(), "A constant declaration must use " +
      new tokens.Symbol("=") + " instead of " + new tokens.Symbol(":="));
  }

  if (!this.test("symbol", "=")) {
    error.raise(this.poll(), "A constant declaration must have " +
      new tokens.Symbol("=") + " and a value");
  }

  this.symbol("=");
  value = this.expression();
  this.newline();

  return new ast.Def(ident, pattern, annotations, value, token);
});

Parser.prototype["var"] = lookahead.keyword("var", function () {
  var annotations, ident, pattern, token, value;

  token = this.keyword("var");
  ident = this.identifier();

  pattern = this.on("symbol", ":", function () {
    var type;

    this.strict = true;
    type = this.expression();
    this.strict = false;

    return type;
  });

  annotations = this.lone("annotations", true) || [];

  if (this.test("symbol", "=")) {
    error.raise(this.poll(), "A variable declaration must use " +
      new tokens.Symbol(":=") + " instead of " + new tokens.Symbol("="));
  }

  value = this.on("symbol", ":=", function () {
    return this.expression();
  });

  this.newline();

  return new ast.Var(ident, pattern, annotations, value, token);
});

Parser.prototype.declOrLiteral = lookahead.keyword("type", function () {
  var annotations, generics, name, token, value;

  token = this.attempt(function () {
    var keyword = this.keyword("type");

    if (this.test("punctuation", "{")) {
      // Whoops, we thought this was a declaration but it's actually a literal.
      // Push the keyword back and reparse as an expression line.
      error.raise("Attempt to parse type literal as type declaration");
    }

    return keyword;
  });

  if (token === null) {
    return this.expressionLine();
  }

  name = this.identifier();

  this.inDef = true;

  this.on("symbol", "<", function () {
    generics = this.commas("identifier");
    this.symbol(">");
  });

  annotations = this.lone("annotations") || [];

  this.inDef = false;

  this.symbol("=");

  value = this.lone("typeBraces") || this.expression();

  this.newline();

  return new ast
    .TypeDeclaration(name, generics || [], annotations, value, token);
});

Parser.prototype.type = lookahead.keyword("type", function () {
  this.keyword("type");
  return this.typeBraces();
});

Parser.prototype.typeBraces = lookahead.punctuation("{", function () {
  return this.braces(function (token) {
    return new ast.Type(this.any("typeBody"), token);
  });
});

Parser.prototype.typeBody = lookahead.parsers("signature", "signature",
  function (signature) {
    this.newline();
    return signature;
  });

Parser.prototype.object = lookahead.keyword("object", function () {
  var annotations, token;

  token = this.keyword("object");

  annotations = this.lone("annotations", true) || [];

  return this.braces(function () {
    return new ast.ObjectConstructor(annotations, this.objectBody(), token);
  });
});

Parser.prototype["class"] = lookahead.keyword("class", function () {
  var name, token;

  token = this.keyword("class");
  name = this.identifier();
  this.punctuation(".");

  return this.methodRest("objectBody", function (signature, body) {
    return new ast.Def(name, null, [], new ast.ObjectConstructor([],
      [new ast.Method(signature, [new ast.ObjectConstructor([],
        body, token)], token)], token), token);
  });
});

Parser.prototype.method = lookahead.keyword("method", function () {
  var token = this.keyword("method");
  return this.methodRest("methodBody", function (signature, body) {
    return new ast.Method(signature, body, token);
  });
});

Parser.prototype.constructor = lookahead.keyword("constructor", function () {
  var token = this.keyword("constructor");
  return this.methodRest("objectBody", function (signature, body) {
    return new ast.Method(signature,
      [new ast.ObjectConstructor([], body, token)], token);
  });
});

Parser.prototype.methodRest = lookahead.name(function (parser, make) {
  var signature = this.signature();

  return this.braces(function () {
    return make.call(this, signature, this.one(parser));
  });
});

Parser.prototype.signature = lookahead.name(function () {
  var first, signature;

  first = this.signaturePartFirst();
  signature = first.parameters.length === 0 || first.name.isOperator ?
      [first] : [first].concat(this.any("signaturePartRest"));

  signature.pattern = this.on("symbol", "->", function () {
    var pattern;

    this.strict = true;
    pattern = this.expression();
    this.strict = false;

    return pattern;
  });

  signature.annotations = this.lone("annotations", true) || [];

  return signature;
});

Parser.prototype.signaturePartFirst = lookahead.name(function () {
  var name = this.lone("operator") || this.identifier();

  if (!name.isOperator) {
    if (name.value === "prefix") {
      this.on("operator", function (operator) {
        name.isOperator = true;
        name.value += operator.value;
      });

      return new ast.SignaturePart(name, [], []);
    }

    if (this.test("symbol", ":=")) {
      this.poll();
      name.isOperator = true;
      name.value += " :=";

      return new ast.SignaturePart(name, [],
        [this.parentheses(this.parameter)]);
    }
  }

  return this.signaturePartPost(name, true);
});

Parser.prototype.signaturePartRest = lookahead.identifier(function () {
  return this.signaturePartPost(this.identifier(), false);
});

Parser.prototype.signaturePartPost = function (name, first) {
  var generics, params;

  if (!name.isOperator) {
    this.on("symbol", "<", function () {
      generics = this.commas("identifier");
      this.symbol(">");
    });
  }

  params = this[first ? "lone" : "one"]("parentheses", function () {
    return name.isOperator ? [this.parameter()] : this.commas("parameter");
  }) || [];

  return new ast.SignaturePart(name, generics || [], params);
};

Parser.prototype.parameter =
  lookahead.parsers("parameter", "vararg", "binding");

Parser.prototype.vararg = lookahead.symbol("*", function () {
  var token = this.symbol("*");
  return new ast
    .Parameter(this.parameterName(), this.parameterType(), true, token);
});

Parser.prototype.binding =
  lookahead.parsers("parameter", "parameterName", function (name) {
    return new ast
      .Parameter(name, this.parameterType(), false, name);
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

  result = this.wrapped("{", "}", function (token) {
    this.postBraceIndent();
    return f.call(this, token);
  });

  this.indent = state;

  return result;
});

Parser.prototype.postBraceIndent = function () {
  var indent, next;

  next = this.peek("newline");

  if (next.constructor === tokens.Newline) {
    next = this.poll();
    indent = next.indent;

    if (indent < this.indent && this.peek().value !== "}") {
      error.raise(next, "Invalid indent following opening brace");
    }

    this.indent = indent;
  }
};

Parser.prototype.parentheses = lookahead.punctuation("(", function (f) {
  return this.wrapped("(", ")", function () {
    var expr = (f || this.expression).call(this);
    this.lone("newline");
    return expr;
  });
});

Parser.prototype.wrapped = function (o, c, f) {
  var result, token;

  result = f.call(this, this.punctuation(o));

  if (!this.test("punctuation", c)) {
    token = this.poll();

    error.raise(token, "Unexpected appearance of " + token);
  }

  this.punctuation(c);

  return result;
};

Parser.prototype.dialect = lookahead.keyword("dialect", function () {
  var path, token;

  token = this.keyword("dialect");
  path = this.string();
  this.newline();

  return new ast.Dialect(path, token);
});

Parser.prototype["import"] = lookahead.keyword("import", function () {
  var ident, path, token;

  token = this.keyword("import");
  path = this.string();
  this.identifier("as");
  ident = this.identifier();
  this.newline();

  return new ast.Import(path, ident, token);
});

Parser.prototype.inherits = lookahead.keyword("inherits", function () {
  var request, token;

  token = this.keyword("inherits");
  request = this.expression();

  if (request.constructor !== ast.Request) {
    // This error will peek at the next token, which cannot be part of an
    // expression, as expression parsing is always greedy. The error should
    // make sense as a result.
    this.error("request");
  }

  this.newline();

  return new ast.Inherits(request, token);
});

Parser.prototype["return"] = lookahead.keyword("return", function () {
  var expression, token;

  token = this.keyword("return");
  expression = this.lone("expression");
  this.newline();

  return new ast.Return(expression, token);
});

Parser.prototype.statement = lookahead.parsers("statement",
  "def", "var", "declOrLiteral", "return", "expressionLine", "newline");

Parser.prototype.expression = lookahead.parsers("expression",
  "preBinaryOperator", function (expression) {
    var token;

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

    if (!this.inDef && this.test("symbol", "=")) {
      token = this.poll();

      error.raise(token, "Assignment must use " +
        new tokens.Symbol(":=") + ", not " + token);
    }

    return this.on("operator", function (op) {
      return operators.call(this, expression, op, this.preBinaryOperator());
    }) || expression;
  });

// Parse an expression up to a binary operator.
Parser.prototype.preBinaryOperator = lookahead.parsers("expression",
  "object", "type", "unqualifiedRequest", "literal", "boolean", "outer",
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

Parser.prototype.boolean = lookahead.parsers("boolean", "true", "false");

Parser.prototype["true"] = lookahead.keyword("true", function () {
  return new ast.Request(null,
    [new ast.RequestPart(new ast.Identifier("true",
      false, this.keyword("true")), [], [])]);
});

Parser.prototype["false"] = lookahead.keyword("false", function () {
  return new ast.Request(null,
    [new ast.RequestPart(new ast.Identifier("false",
      false, this.keyword("false")), [], [])]);
});

Parser.prototype.outer = lookahead.keyword("outer", function () {
  var token = this.peek();

  return new ast.Outer(this.nextOuter(), token);
});

Parser.prototype.nextOuter = function () {
  this.keyword("outer");

  return this.attempt(function () {
    this.punctuation(".");
    return this.nextOuter() + 1;
  }) || 0;
};

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

  if (this.test("symbol", "<") && !this.peek().spaced) {
    state = this.generics;

    generics = this.attempt(function () {
      var after, next, types;

      this.symbol("<");
      this.generics = true;
      types = this.commas("expression");

      next = this.peek();
      if (next.value[0] === ">" && next.value.length > 1) {
        // The lexer got confused and attached the closing chevron to some
        // following symbols. Rip out the chevron and leave the symbols.
        next.value = next.value.substring(1);
      } else {
        this.symbol(">");
      }

      after = this.peek();

      if (after.constructor === tokens.Identifier ||
          (after.constructor === tokens.Keyword && after.value !== "is" &&
            after.value !== "true" && after.value !== "false")) {
        error.raise(after, "Invalid token following generic parameters");
      }

      return types;
    });

    this.generics = state;
  }

  this.on(this.strict ? "strictLiteral" : "literal", function (arg) {
    args = [arg];

    if (arg.constructor !== ast.Block && this.test("punctuation", ".")) {
      error.raise(this.punctuation("."),
        "Method requests on literal parameters must be wrapped");
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
  var operator = this.operator();
  return [new ast.RequestPart(operator, [], [this.expression()])];
});

Parser.prototype.self = lookahead.keyword("self", function () {
  var token = this.keyword("self");

  return new ast.Request(null,
    [new ast.RequestPart(new ast.Identifier("self", false, token), [], [])]);
});

Parser.prototype["super"] = lookahead.keyword("super", function () {
  return new ast.Request(new ast.Super(this.keyword("super")), this.request());
});

Parser.prototype.block = lookahead.punctuation("{", function () {
  return this.braces(function (token) {
    var body, parameters;

    body = [];

    parameters = this.attempt(function () {
      var params = this.commas("parameter");
      this.symbol("->");
      this.postBraceIndent();
      return params;
    }) || [];

    return new ast.Block(parameters, body.concat(this.any("statement")), token);
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
  lookahead.parsers("literal", "strictLiteral", "block");

Parser.prototype.strictLiteral =
  lookahead.parsers("literal", "boolean", "string", "number");

Parser.prototype.string = lookahead.string(function () {
  var concat, interpolation, string, token;

  token = this.expect(tokens.StringLiteral);
  string = new ast.StringLiteral(token.value, token);

  if (token.interpolation) {
    concat = new ast.Identifier("++", true, token);
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
  var token = this.expect(tokens.NumberLiteral);

  return new ast.NumberLiteral(token.value, token);
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
  lookahead.parsers("statement", "statement", "method", "class", "constructor");

// Expect and consume a certain keyword.
Parser.prototype.keyword = lookahead.type(tokens.Keyword, function (key) {
  var token = this.expect(tokens.Keyword, key);

  if (token.value !== key) {
    this.error("keyword " + key, token);
  }

  return token;
});

// Expect and parse the given identifier as a keyword.
Parser.prototype.contextualKeyword = lookahead.type(tokens.Identifier,
  function (key) {
    var token = this.expect(tokens.Identifier, key);

    if (token.value !== key) {
      this.error("keyword " + key, token);
    }

    return token;
  });

// Expect and consume a certain symbol.
Parser.prototype.symbol = lookahead.type(tokens.Symbol, function (sym) {
  var token = this.expect(tokens.Symbol, sym);

  if (token.value !== sym) {
    this.error("symbol " + sym, token);
  }

  return token;
});

// Expect and consume a certain piece of punctuation.
Parser.prototype.punctuation = lookahead.type(tokens.Punctuation,
  function (sym) {
    var token = this.expect(tokens.Punctuation, sym);

    if (token.value !== sym) {
      this.error(new tokens.Punctuation(sym, null), token);
    }

    return token;
  });

// Expect and parse an operator.
Parser.prototype.operator = lookahead.value(tokens.Symbol, function (symbol) {
  return symbol !== "=" && symbol !== "->" && symbol !== ":=" && symbol !== ":";
}, function () {
  var token = this.expect(tokens.Symbol, "operator");

  return new ast.Identifier(token.value, true, token);
});

// Expect and parse an identifier.
Parser.prototype.identifier = lookahead.identifier(function () {
  var token = this.expect(tokens.Identifier);

  return new ast.Identifier(token.value, false, token);
});

Parser.prototype.underscore = lookahead.punctuation("_", function () {
  var token = this.punctuation("_");

  return new ast.Identifier("_", false, token);
});

// Expect a certain type of token, throwing away newlines in between. May be
// provided with a second type which will be used instead of the first for
// error reporting.
Parser.prototype.expect = function (Type, etype) {
  var token;

  if (Type !== tokens.Newline) {
    this.trim();
  }

  token = this.poll();

  if (token === null || token.constructor !== Type) {
    if (typeof etype === "string") {
      etype = new Type(etype, token.location);
    }

    this.error(etype || Type, token);
  }

  return token;
};

// Trim out leading newlines from the token queue whose indent is greater than
// the current indent.
Parser.prototype.trim = function () {
  var token = this.peek("newline");

  while (token.constructor === tokens.Newline && token.indent > this.indent) {
    this.poll();
    token = this.peek("newline");
  }
};

// Poll the token queue, removing and returning the first element.
Parser.prototype.poll = function () {
  var token = this.token;

  if (token !== null) {
    if (token.constructor !== tokens.EndOfInput) {
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
    while (token.constructor === tokens.Newline && token.indent > this.indent) {
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

  error.raise(token, "Expected " + type + ", but found " + token);
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
  } catch (reason) {
    this.lexer = lexer;
    this.token = token;
    result = null;
  }

  return result;
};

// Parse a token stream.
function parse(code) {
  var module, parser, token;

  parser = new Parser(new lexer.Lexer(code));

  while (parser.peek().constructor === tokens.Newline) {
    parser.poll();
  }

  module = parser.module();

  do {
    token = parser.poll();
  } while (token.constructor !== tokens.EndOfInput &&
    token.constructor === tokens.Newline);

  if (token.constructor !== tokens.EndOfInput) {
    error.raise(token, "Unexpected appearance of " + token);
  }

  return module;
}

exports.parse = parse;
exports.ParseError = error.ParseError;
exports.isSymbol = lexer.isSymbol;

