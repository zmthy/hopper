// Provides the 'parse' function, which transforms a list of lexed tokens into a
// list of Grace AST nodes.

"use strict";

var Task, ast, error, lexer, lookahead, tokens, util;

Task = require("./task");
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

  return left === "^" || (left === "/" || left === "*") && right !== "^" ||
    (left === "+" || left === "-") && (right === "+" || right === "-");
}

function slice(ctx, from, to) {
  return Array.prototype.slice.call(ctx, from, to);
}

lookahead = {

  "keyword": function (value, parser) {
    return this.value(tokens.Keyword, value, parser);
  },

  "symbol": function (value, parser) {
    return this.value(tokens.Symbol, value, parser);
  },

  "punctuation": function (value, parser) {
    return this.value(tokens.Punctuation, value, parser);
  },

  "newline": function (parser) {
    parser.test = function () {
      var token = this.peek("newline");
      return token &&
        (token.constructor === tokens.Newline || token.value === ";");
    };

    return parser;
  },

  "identifier": function (parser) {
    return this.type(tokens.Identifier, parser);
  },

  "operator": function (parser) {
    return this.type(tokens.Symbol, parser);
  },

  "string": function (parser) {
    return this.type(tokens.StringLiteral, parser);
  },

  "number": function (parser) {
    return this.type(tokens.NumberLiteral, parser);
  },

  "value": function (type, value, parser) {
    parser.test = function () {
      var token = this.peek(type);

      return token.constructor === type &&
        (typeof value === "string" && token.value === value ||
          typeof value === "function" && value(token.value));
    };

    return parser;
  },

  "type": function (type, parser) {
    parser.test = function (value) {
      var token = this.peek(type);

      return token.constructor === type &&
        (typeof value !== "string" || token.value === value);
    };

    return parser;
  },

  "name": function (parser) {
    parser.test = function (value) {
      var token, type;

      token = this.peek();
      type = token.constructor;

      return (type === tokens.Identifier || type === tokens.Symbol) &&
        (typeof value !== "string" || token.value === value);
    };

    return parser;
  },

  "parsers": function (name) {
    var after, i, l, parser, parsers;

    function run(test, failure) {
      return function () {
        var pName;

        function then(result) {
          return after ? after.call(this, result) : result;
        }

        for (i = 0; i < l; i += 1) {
          pName = parsers[i];
          if (this.test(pName)) {
            if (test) {
              return test;
            }

            return this.one(pName).then(then);
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

    parser = run(false, function () {
      this.raise(name);
    });

    parser.test = run(true, function () {
      return false;
    });

    return parser;
  }

};

function Parser(lex) {
  this.lexer = lex;
  this.indent = 0;
  this.token = null;
}

util.inherits(Parser, Task.Async);

Parser.prototype.module = function () {
  return this.lone("dialect").then(function (dialect) {
    return this.any("import").then(function (imports) {
      if (dialect !== null) {
        imports.unshift(dialect);
      }

      return imports;
    });
  }).then(function (head) {
    return this.objectBody().then(function (body) {
      return head.concat(body);
    });
  });
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
  var ident, token;

  token = this.keyword("def");
  ident = this.identifier();

  this.inDef = true;

  return this.on("symbol", ":", function () {
    return this.expression();
  }).then(function (pattern) {
    return this.lone("annotations").then(function (annotations) {
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

      return this.expression().then(function (value) {
        this.newline();

        return new ast.Def(ident, pattern, annotations || [], value, token);
      });
    });
  });
});

Parser.prototype["var"] = lookahead.keyword("var", function () {
  var ident, token;

  token = this.keyword("var");
  ident = this.identifier();

  return this.on("symbol", ":", function () {
    return this.strict(this.expression);
  }).then(function (pattern) {
    return this.lone("annotations", true).then(function (annotations) {
      if (this.test("symbol", "=")) {
        error.raise(this.poll(), "A variable declaration must use " +
          new tokens.Symbol(":=") + " instead of " + new tokens.Symbol("="));
      }

      return this.on("symbol", ":=", function () {
        return this.expression();
      }).then(function (value) {
        this.newline();

        return new ast.Var(ident, pattern, annotations || [], value, token);
      });
    });
  });
});

Parser.prototype.declOrLiteral = lookahead.keyword("type", function () {
  return this.attempt(function () {
    var keyword = this.keyword("type");

    if (this.test("punctuation", "{")) {
      // Whoops, we thought this was a declaration but it's actually a literal.
      // Push the keyword back and reparse as an expression line.
      error.raise("Attempt to parse type literal as type declaration");
    }

    return keyword;
  }).then(function (token) {
    var name;

    if (token === null) {
      return this.expressionLine();
    }

    name = this.identifier();

    this.inDef = true;

    return this.on("symbol", "<", function () {
      return this.commas("identifier").then(function (generics) {
        this.symbol(">");
        return generics;
      });
    }).then(function (generics) {
      return this.lone("annotations").then(function (annotations) {
        this.inDef = false;

        this.symbol("=");

        return this.lone("typeBraces").then(function (type) {
          return type || this.expression();
        }).then(function (value) {
          this.newline();

          return new ast.TypeDeclaration(name,
            generics || [], annotations || [], value, token);
        });
      });
    });
  });
});

Parser.prototype.type = lookahead.keyword("type", function () {
  this.keyword("type");
  return this.typeBraces();
});

Parser.prototype.typeBraces = lookahead.punctuation("{", function () {
  return this.braces(function (token) {
    return this.any("typeBody").then(function (body) {
      return new ast.Type(body, token);
    });
  });
});

Parser.prototype.typeBody = lookahead.parsers("signature", "signature",
  function (signature) {
    this.newline();
    return signature;
  });

Parser.prototype.object = lookahead.keyword("object", function () {
  var token = this.keyword("object");

  return this.lone("annotations", true).then(function (annotations) {
    return this.braces(function () {
      return this.objectBody().then(function (body) {
        return new ast.ObjectConstructor(annotations || [], body, token);
      });
    });
  });
});

Parser.prototype["class"] = lookahead.keyword("class", function () {
  var name, token;

  token = this.keyword("class");
  name = this.identifier();
  this.punctuation(".");

  return this.methodRest("objectBody", function (signature, annotations, body) {
    return new ast.Class(name, signature, annotations, body, token);
  });
});

Parser.prototype.method = lookahead.keyword("method", function () {
  var token = this.keyword("method");

  return this.methodRest("methodBody", function (signature, annotations, body) {
    return new ast.Method(signature, annotations, body, token);
  });
});

Parser.prototype.constructor = lookahead.keyword("constructor", function () {
  var token = this.keyword("constructor");

  return this.methodRest("objectBody", function (signature, annotations, body) {
    return new ast.Method(signature, annotations,
      [new ast.ObjectConstructor([], body, token)], token);
  });
});

Parser.prototype.methodRest = lookahead.name(function (parser, make) {
  return this.signature().then(function (signature) {
    return this.lone("annotations").then(function (annotations) {
      annotations = annotations || [];

      return this.braces(function () {
        return this.one(parser).then(function (result) {
          return make.call(this, signature, annotations, result);
        });
      });
    });
  });
});

Parser.prototype.signature = lookahead.name(function () {
  return this.signaturePartFirst().then(function (first) {
    return this.task(function () {
      if (first.parameters.length === 0 || first.name.isOperator) {
        return [first];
      }

      return this.any("signaturePartRest").then(function (rest) {
        rest.unshift(first);
        return rest;
      });
    }).then(function (parts) {
      return this.on("symbol", "->", function () {
        return this.strict(this.expression);
      }).then(function (pattern) {
        return new ast.Signature(parts, pattern, first);
      });
    });
  });
});

Parser.prototype.signaturePartFirst = lookahead.name(function () {
  return this.lone("operator").then(function (operator) {
    if (operator === null) {
      return this.identifier();
    }

    return operator;
  }).then(function (name) {
    if (!name.isOperator) {
      if (name.value === "prefix") {
        return this.on("operator", function (operator) {
          name.isOperator = true;
          name.value += operator.value;
        }).then(function () {
          return new ast.SignaturePart(name, [], []);
        });
      }

      if (this.test("symbol", ":=")) {
        this.poll();
        name.isOperator = true;
        name.value += " :=";

        return this.parentheses(this.parameter).then(function (parameter) {
          return new ast.SignaturePart(name, [], [parameter]);
        });
      }
    }

    return this.signaturePartPost(name, true);
  });
});

Parser.prototype.signaturePartRest = lookahead.identifier(function () {
  var name = this.identifier();

  return this.signaturePartPost(name, false);
});

Parser.prototype.signaturePartPost = function (name, first) {
  return this.task(function () {
    if (!name.isOperator) {
      return this.on("symbol", "<", function () {
        return this.commas("identifier").then(function (generics) {
          this.symbol(">");
          return generics;
        });
      });
    }
  }).then(function (generics) {
    return this[first ? "lone" : "one"]("parentheses", function () {
      if (name.isOperator) {
        return this.parameter().then(function (parameter) {
          return [parameter];
        });
      }

      return this.commas("parameter");
    }).then(function (parameters) {
      return new ast.SignaturePart(name, generics || [], parameters || []);
    });
  });
};

Parser.prototype.parameter =
  lookahead.parsers("parameter", "vararg", "binding");

Parser.prototype.vararg = lookahead.symbol("*", function () {
  var token = this.symbol("*");

  return this.parameterName().then(function (name) {
    return this.parameterType().then(function (type) {
      return new ast.Parameter(name, type, true, token);
    });
  });
});

Parser.prototype.binding =
  lookahead.parsers("parameter", "parameterName", function (name) {
    return this.parameterType().then(function (type) {
      return new ast.Parameter(name, type, false, name);
    });
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
  function comma(results) {
    return this.on("punctuation", ",", function () {
      return this.one(parser).then(function (result) {
        results.push(result);
        return comma.call(this, results);
      });
    }).then(function (next) {
      return next || results;
    });
  }

  return this.one(parser).then(function (first) {
    return comma.call(this, [first]);
  });
};

Parser.prototype.braces = lookahead.punctuation("{", function (f) {
  var state = this.indent;

  return this.wrapped("{", "}", function (token) {
    this.postBraceIndent();
    return this.resolve(f.call(this, token));
  }).then(function (result) {
    this.indent = state;
    return result;
  });
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
    return this.resolve((f || this.expression).call(this))
      .then(function (expr) {
        return this.lone("newline").then(function () {
          return expr;
        });
      });
  });
});

Parser.prototype.wrapped = function (o, c, f) {
  return this.resolve(f.call(this, this.punctuation(o)))
    .then(function (result) {
      var token;

      if (!this.test("punctuation", c)) {
        token = this.poll();

        error.raise(token, "Unexpected appearance of " + token);
      }

      this.punctuation(c);

      return result;
    });
};

Parser.prototype.dialect = lookahead.keyword("dialect", function () {
  var token = this.keyword("dialect");

  return this.string().then(function (path) {
    this.newline();

    return new ast.Dialect(path, token);
  });
});

Parser.prototype["import"] = lookahead.keyword("import", function () {
  var token = this.keyword("import");

  return this.string().then(function (path) {
    var ident;

    this.contextualKeyword("as");
    ident = this.identifier();
    this.newline();

    return new ast.Import(path, ident, token);
  });
});

Parser.prototype.inherits = lookahead.keyword("inherits", function () {
  var token = this.keyword("inherits");

  return this.expression().then(function (request) {
    if (request.constructor !== ast.UnqualifiedRequest &&
        request.constructor !== ast.QualifiedRequest &&
        request.constructor !== ast.BooleanLiteral) {
      this.raise("request", request);
    }

    this.newline();

    return new ast.Inherits(request, token);
  });
});

Parser.prototype["return"] = lookahead.keyword("return", function () {
  var token = this.keyword("return");

  return this.lone("expression").then(function (expression) {
    this.newline();

    return new ast.Return(expression, token);
  });
});

Parser.prototype.statement = lookahead.parsers("statement",
  "def", "var", "declOrLiteral", "return", "expressionLine", "newline");

Parser.prototype.expression = lookahead.parsers("expression",
  "preBinaryOperator", function (expression) {
    var token, which;

    function buildBinary(lhs, op, rhs) {
      return new ast.QualifiedRequest(lhs,
        [new ast.RequestPart(op, [], [rhs])]);
    }

    // Parse trailing binary operator requests.
    function operators(lhs, lop, rhs) {
      return this.on("operator", function (rop) {
        return this.preBinaryOperator().then(function (pre) {
          if (precedence(lop, rop)) {
            return operators.call(this, buildBinary(lhs, lop, rhs), rop, pre);
          }

          return operators.call(this, lhs, lop, buildBinary(rhs, rop, pre));
        });
      }).then(function (op) {
        return op || buildBinary(lhs, lop, rhs);
      });
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

    // In these cases, the node *must* be a receiver in an operator request,
    // otherwise it's optional.
    which = expression.constructor === ast.Outer ||
      expression.constructor === ast.Super ? "one" : "lone";

    return this[which]("operator").then(function (op) {
      return op && this.preBinaryOperator().then(function (pre) {
        return operators.call(this, expression, op, pre);
      });
    }).then(function (request) {
      return request || expression;
    });
  });

Parser.prototype.receiver = lookahead.parsers("expression",
  "object", "type", "unqualifiedRequest", "literal", "bool",
  "self", "super", "outer", "parentheses", "prefixOperator");

// Parse an expression up to a binary operator.
Parser.prototype.preBinaryOperator = lookahead.parsers("expression", "receiver",
  function (expression) {
    // Parse trailing dot requests.
    function requests(receiver) {
      return this.on("dotRequest", function (signature) {
        return requests.call(this,
          new ast.QualifiedRequest(receiver, signature));
      }).then(function (request) {
        return request || receiver;
      });
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

Parser.prototype.bool = lookahead.parsers("boolean", "true", "false");

Parser.prototype["true"] = lookahead.keyword("true", function () {
  return new ast.BooleanLiteral(true, this.keyword("true"));
});

Parser.prototype["false"] = lookahead.keyword("false", function () {
  return new ast.BooleanLiteral(false, this.keyword("false"));
});

Parser.prototype.prefixOperator = lookahead.operator(function () {
  var prefix = this.operator();

  prefix.value = "prefix" + prefix.value;

  return this.receiver().then(function (receiver) {
    return new ast.QualifiedRequest(receiver,
      [new ast.RequestPart(prefix, [], [])]);
  });
});

// Parse a request with no receiver.
Parser.prototype.unqualifiedRequest = lookahead.identifier(function () {
  return this.requestSignature().then(function (signature) {
    return new ast.UnqualifiedRequest(signature);
  });
});

// Parse the signature part of a request, resulting in a list of signature
// parts.
Parser.prototype.postReceiver = lookahead.parsers("request signature",
  "dotRequest", "binaryRequestSignature");

// Parse a dot-requested signature.
Parser.prototype.dotRequest = lookahead.punctuation(".", function () {
  this.punctuation(".");
  return this.requestSignature();
});

// Parse a request signature whose parts are identifiers.
Parser.prototype.requestSignature = lookahead.identifier(function () {
  return this.requestPart(false).then(function (first) {
    if (first.arguments.length === 0) {
      return [first];
    }

    return this.any("requestPart", true).then(function (parts) {
      parts.unshift(first);
      return parts;
    });
  });
});

Parser.prototype.requestPart = lookahead.identifier(function (required) {
  var name = this.identifier();

  return this.task(function () {
    var state;

    if (this.test("symbol", "<") && !this.peek().spaced) {
      state = this.generics;

      return this.attempt(function () {
        this.symbol("<");
        this.generics = true;

        return this.commas("expression").then(function (types) {
          var after, next;

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
              after.constructor === tokens.Keyword && after.value !== "is" &&
                after.value !== "true" && after.value !== "false") {
            error.raise(after, "Invalid token following generic parameters");
          }

          return types;
        });
      }).then(function (generics) {
        this.generics = state;
        return generics;
      });
    }
  }).then(function (generics) {
    return this.on(this.isStrict ? "strictLiteral" : "literal", function (arg) {
      if (arg.constructor !== ast.Block && this.test("punctuation", ".")) {
        error.raise(this.punctuation("."),
          "Method requests on literal parameters must be wrapped");
      }

      return [arg];
    }).then(function (args) {
      if (!required && !this.isStrict && args === null) {
        return this.on("symbol", ":=", function () {
          name.isOperator = true;
          name.value += " :=";

          return this.expression().then(function (expression) {
            return [expression];
          });
        });
      }

      return args;
    }).then(function (args) {
      if (args === null) {
        return this[required ? "one" : "lone"]("parentheses", function () {
          return this.commas("expression");
        });
      }

      return args;
    }).then(function (args) {
      return new ast.RequestPart(name, generics || [], args || []);
    });
  });
});

// Parse the signature of a binary operator request.
Parser.prototype.binaryRequestSignature = lookahead.operator(function () {
  var operator = this.operator();

  return this.expression().then(function (rhs) {
    return [new ast.RequestPart(operator, [], [rhs])];
  });
});

Parser.prototype.self = lookahead.keyword("self", function () {
  return new ast.Self(this.keyword("self"));
});

Parser.prototype["super"] = lookahead.keyword("super", function () {
  return new ast.Super(this.keyword("super"));
});

Parser.prototype.outer = lookahead.keyword("outer", function () {
  return new ast.Outer(this.keyword("outer"));
});

Parser.prototype.block = lookahead.punctuation("{", function () {
  return this.braces(function (token) {
    return this.attempt(function () {
      return this.task(function () {
        if (!this.test("identifier") && !this.test("punctuation", "_")) {
          return this.expression().then(function (params) {
            return [
              new ast.Parameter(new ast.Identifier("_", false, params),
                params, false, params)
            ];
          });
        }

        return this.commas("parameter");
      }).then(function (params) {
        this.symbol("->");
        this.postBraceIndent();

        return params;
      });
    }).then(function (params) {
      return this.any("statement").then(function (body) {
        return new ast.Block(params || [], body, token);
      });
    });
  });
});

Parser.prototype.annotations = lookahead.keyword("is", function (isStrict) {
  this.keyword("is");

  return this.strict(function () {
    return this.commas("expression");
  }, isStrict);
});

Parser.prototype.literal =
  lookahead.parsers("literal", "strictLiteral", "block");

Parser.prototype.strictLiteral =
  lookahead.parsers("literal", "bool", "string", "number");

Parser.prototype.string = lookahead.string(function () {
  var concat, string, token;

  token = this.expect(tokens.StringLiteral);
  string = new ast.StringLiteral(token.value, token);

  if (token.interpolation) {
    concat = new ast.Identifier("++", true, token);

    return this.expression().then(function (expression) {
      var interpolation = new ast.QualifiedRequest(string,
        [new ast.RequestPart(concat, [], [expression])]);

      // The newline allows the string to return to its previous indentation.
      this.lone("newline");
      this.punctuation("}");
      this.token = this.lexer.nextToken(true);

      return this.string().then(function (rest) {
        return new ast.QualifiedRequest(interpolation,
          [new ast.RequestPart(concat, [], [rest])]);
      });
    });
  }

  return this.resolve(string);
});

Parser.prototype.number = lookahead.number(function () {
  var base, token, value, x;

  token = this.expect(tokens.NumberLiteral);
  value = token.value;

  x = value.match(/[xX]/);

  if (x !== null) {
    base = Number(value.substring(0, x.index));

    if (base > 1 && base < 37) {
      value = parseInt(value.substring(x.index + 1), base);
    }
  }

  return new ast.NumberLiteral(value, token);
});

Parser.prototype.objectBody = function () {
  return this.lone("inherits").then(function (inherits) {
    return this.any("statementOrMethod").then(function (body) {
      if (inherits !== null) {
        body.unshift(inherits);
      }

      return body;
    });
  });
};

Parser.prototype.methodBody = function () {
  return this.any("statement");
};

Parser.prototype.statementOrMethod =
  lookahead.parsers("statement", "method", "class", "constructor", "statement");

// Expect and consume a certain keyword.
Parser.prototype.keyword = lookahead.type(tokens.Keyword, function (key) {
  var token = this.expect(tokens.Keyword, key);

  if (token.value !== key) {
    this.raise("keyword " + key, token);
  }

  return token;
});

// Expect and parse the given identifier as a keyword.
Parser.prototype.contextualKeyword = lookahead.type(tokens.Identifier,
  function (key) {
    var token = this.expect(tokens.Identifier, key);

    if (token.value !== key) {
      this.raise("keyword " + key, token);
    }

    return token;
  });

// Expect and consume a certain symbol.
Parser.prototype.symbol = lookahead.type(tokens.Symbol, function (sym) {
  var token = this.expect(tokens.Symbol, sym);

  if (token.value !== sym) {
    this.raise("symbol " + sym, token);
  }

  return token;
});

// Expect and consume a certain piece of punctuation.
Parser.prototype.punctuation = lookahead.type(tokens.Punctuation,
  function (sym) {
    var token = this.expect(tokens.Punctuation, sym);

    if (token.value !== sym) {
      this.raise(new tokens.Punctuation(sym, null), token);
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

    this.raise(etype || Type, token);
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
  var lex, token;

  token = this.token;

  if (token !== null) {
    return this.token;
  }

  lex = this.lexer;
  token = lex.nextToken();

  if (type !== "newline") {
    while (token.constructor === tokens.Newline && token.indent > this.indent) {
      token = lex.nextToken();
    }
  }

  this.token = token;
  return token;
};

Parser.prototype.raise = function (type, token) {
  if (token === undefined) {
    token = this.peek();
  }

  error.raise(token, "Expected " + type + ", but found " + token);
};

Parser.prototype.test = function (parser) {
  return this[parser].test.apply(this, slice(arguments, 1));
};

Parser.prototype.one = function (parser) {
  return this.resolve(this[parser].apply(this, slice(arguments, 1)));
};

Parser.prototype.lone = function () {
  return this.test.apply(this, arguments) ?
      this.one.apply(this, arguments) : this.resolve(null);
};

Parser.prototype.any = function () {
  var args = arguments;

  function any(results) {
    if (this.test.apply(this, args)) {
      return this.one.apply(this, args).then(function (result) {
        if (typeof result === "object") {
          results.push(result);
        }

        return any.call(this, results);
      });
    }

    return this.resolve(results);
  }

  return any.call(this, []);
};

Parser.prototype.many = function () {
  return this.one.apply(this, arguments).then(function (result) {
    return this.any.apply(this, arguments).then(function (results) {
      results.unshift(result);
      return results;
    });
  });
};

Parser.prototype.on = function () {
  var args, l;

  l = arguments.length - 1;
  args = slice(arguments, 0, l);

  if (this.test.apply(this, args)) {
    return this.one.apply(this, args).then(arguments[l]);
  }

  return this.resolve(null);
};

Parser.prototype.attempt = function (f) {
  var lex, token;

  lex = this.lexer;
  token = this.token;

  this.lexer = lex.clone();

  return this.task(function () {
    return f.call(this);
  }).then(null, function () {
    this.lexer = lex;
    this.token = token;
    return null;
  });
};

Parser.prototype.strict = function (func, isStrict) {
  var state = this.isStrict;

  this.isStrict = isStrict === false ? false : true;

  return this.resolve(func.call(this)).then(function (result) {
    this.isStrict = state;

    return result;
  });
};

// Parse a token stream.
function runParser(code) {
  var parser, token;

  try {
    parser = new Parser(new lexer.Lexer(code));

    while (parser.peek().constructor === tokens.Newline) {
      parser.poll();
    }

    return parser.module().then(function (module) {
      do {
        token = parser.poll();
      } while (token.constructor !== tokens.EndOfInput &&
        token.constructor === tokens.Newline);

      if (token.constructor !== tokens.EndOfInput) {
        error.raise(token, "Unexpected appearance of " + token);
      }

      return module;
    }).bind(null);
  } catch (reason) {
    return Task.reject(reason);
  }
}

// Parse the code at the given path.
function parse(code, path) {
  return runParser(code).then(null, function (reason) {
    reason.module = path;
    throw reason;
  });
}

exports.parse = parse;
exports.ParseError = error.ParseError;
exports.isSymbol = lexer.isSymbol;
