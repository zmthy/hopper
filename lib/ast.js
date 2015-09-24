// The abstract syntax tree of Grace. Consists primarily of constructors.

"use strict";

var Task, js, util;

js = require("ast-types").builders;

Task = require("./task");
util = require("./util");

// nullToJS(value : Node) : Task<js.Node>
//   Compile a value to a JavaScript node, compiling to a null node if the value
//   is null.
function nullToJS(value) {
  return value === null ?
    Task.resolve(js.literal(null)) : value.toJavaScript();
}

// allToJS(values : [Node]) : Task<[js.Node]>
//   Compile a list of values into JavaScript nodes.
function allToJS(values) {
  return Task.each(values, function (value) {
    return value.toJavaScript();
  });
}

// (this : Request | Signature).name() : String
//   Builds a name from the signature of a Request or Method.
function buildName() {
  var i, l, part, parts, signature, value;

  signature = this.parts;

  if (signature.length === 1) {
    part = signature[0];
    value = part.name;

    if (value.isOperator ||
        (part.parameters || part.arguments).length === 0) {
      return value.value;
    }
  }

  parts = [];

  for (i = 0, l = signature.length; i < l; i += 1) {
    parts.push(signature[i].name + "()");
  }

  return parts.join(" ");
}

// (this : Request | Signature).uglyName() : String
//   Builds an ugly name from the signature of a Request or Method.
function buildUglyName() {
  var i, l, part, parts, signature, value;

  signature = this.parts;

  if (signature.length === 1) {
    part = signature[0];
    value = part.name;

    if (value.isOperator ||
        (part.parameters || part.arguments).length === 0) {
      return value.value;
    }
  }

  parts = [];

  for (i = 0, l = signature.length; i < l; i += 1) {
    parts.push(signature[i].name);
  }

  return parts.join("_");
}

// commas(left : String, list : [Object], right : String) : String
//   Build a comma separated list separated by the given arguments, or an empty
//   string if there is nothing in the list.
function commas(left, list, right) {
  return list.length === 0 ? "" : left + list.join(", ") + right;
}

// acceptAll(nodes : [Node], visitor : Visitor) : Task
//   Call the accept method on all of the nodes with the given visitor.
function acceptAll(nodes, visitor) {
  return Task.each(nodes, function (node) {
    return node.accept(visitor);
  });
}

// Top-level Node type, used as a type in Grace.
function Node(token) {
  this.location = token.location;
}

// Abstract expression constructor, used as a type in Grace.
function Expression(token) {
  Node.call(this, token);
}

util.inherits(Expression, Node);

// new Dialect(path : String)
//   A dialect directive.
function Dialect(path, token) {
  Node.call(this, token);

  this.path = path;
}

util.inherits(Dialect, Node);

Dialect.prototype.accept = function (visitor) {
  return visitor.visitDialect(this);
};

Dialect.prototype.toString = function () {
  return "dialect " + this.path;
};

// new Import(path : String, ident : Identifier)
//   An import directive.
function Import(path, ident, token) {
  Node.call(this, token);

  this.path = path;
  this.identifier = ident;
}

util.inherits(Import, Node);

Import.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitImport(this).then(function () {
    return self.identifier.accept(visitor);
  });
};

Import.prototype.toString = function () {
  return "import " + this.path + " as " + this.identifier;
};

// new Identifier(value : String, isOperator : Boolean = false)
//   An identifier.
function Identifier(value, isOperator, token) {
  Node.call(this, token);

  this.value = value;
  this.isOperator = isOperator === true;
}

util.inherits(Identifier, Node);

Identifier.prototype.accept = function (visitor) {
  return visitor.visitIdentifier(this);
};

Identifier.prototype.toString = function () {
  return this.value;
};

// An abstract Request constructor, used as a type in Grace.
function Request(signature, node) {
  Expression.call(this, node);

  this.parts = signature;
}

util.inherits(Request, Expression);

Request.prototype.name = buildName;
Request.prototype.uglyName = buildUglyName;

Request.prototype.toString = function () {
  return this.parts.join(" ");
};

// new UnqualifiedRequest(signature : [RequestPart])
//   A variable lookup or method request without a receiver.
function UnqualifiedRequest(signature) {
  Request.call(this, signature, signature[0]);
}

util.inherits(UnqualifiedRequest, Request);

UnqualifiedRequest.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitUnqualifiedRequest(this).then(function () {
    return acceptAll(self.parts, visitor);
  });
};

UnqualifiedRequest.runtimeName = js.identifier("unqualifiedRequest");

UnqualifiedRequest.prototype.toJavaScript = function () {
  var self = this;

  return allToJS(self.parts).then(function (parts) {
    return js.callExpression(UnqualifiedRequest.runtimeName,
      [js.literal(self.uglyName()), js.arrayExpression(parts)]);
  });
};

// new Request(receiver : Expression, signature : [RequestPart])
//   A method request or variable lookup.
function QualifiedRequest(receiver, signature) {
  Request.call(this, signature, receiver);

  this.receiver = receiver;
}

util.inherits(QualifiedRequest, Request);

QualifiedRequest.prototype.isBinaryOperator = function () {
  var name = this.parts[0].name;

  return name.isOperator && name.value.substring(0, 6) !== "prefix";
};

QualifiedRequest.prototype.isPrefixOperator = function () {
  var name = this.parts[0].name;

  return name.isOperator && name.value.substring(0, 6) === "prefix";
};

QualifiedRequest.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitQualifiedRequest(this).then(function () {
    return self.receiver.accept(visitor);
  }).then(function () {
    return acceptAll(self.parts, visitor);
  });
};

QualifiedRequest.prototype.toString = function () {
  var parts, receiver;

  receiver = this.receiver;
  parts = this.parts;

  if (this.isBinaryOperator()) {
    return (receiver.constructor === Request && receiver.isBinaryOperator() ?
      "(" + receiver + ")" : receiver) + " " + parts[0];
  }

  if (this.isPrefixOperator()) {
    return parts[0].name.value.substring(6) +
      (receiver.constructor === Request && receiver.isPrefixOperator() ?
        "(" + receiver + ")" : receiver);
  }

  return (receiver === null ? "" : receiver + ".") + parts.join(" ");
};

QualifiedRequest.runtimeName = js.identifier("qualifiedRequest");

QualifiedRequest.prototype.toJavaScript = function () {
  var self = this;

  return self.receiver.toJavaScript().then(function (receiver) {
    return allToJS(self.parts).then(function (parts) {
      return js.callExpression(QualifiedRequest.runtimeName,
        [receiver, self.uglyName(), js.arrayExpression(parts)]);
    });
  });
};

// new RequestPart(name : String,
//     generics : [Expression], arguments : [Expression])
//   A part of a request's signature.
function RequestPart(name, generics, args) {
  Node.call(this, name);

  this.name = name;
  this.generics = generics;
  this.arguments = args;
}

util.inherits(RequestPart, Node);

RequestPart.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitRequestPart(this).then(function () {
    return acceptAll(self.generics, visitor);
  }).then(function () {
    return acceptAll(self.arguments, visitor);
  });
};

RequestPart.prototype.toString = function () {
  var arg, args, name;

  name = this.name;
  args = this.arguments;

  if (name.isOperator) {
    // This can't come up unless toString is called directly on the part.
    if (name.value.substring(0, 6) === "prefix") {
      return name.value;
    }

    arg = args[0];

    if (arg.constructor === Request && arg.isBinaryOperator()) {
      args = " (" + args + ")";
    } else {
      args = " " + arg;
    }
  } else {
    args = commas("(", args, ")");
  }

  return name + commas("<", this.generics, ">") + args;
};

RequestPart.prototype.toJavaScript = function () {
  return allToJS(this.arguments).then(function (args) {
    args = js.arrayExpression(args);

    if (this.generics.length > 0) {
      return allToJS(this.generics).then(function (generics) {
        return js.arrayExpression([js.arrayExpression(generics), args]);
      });
    }

    return args;
  });
};

// new BooleanLiteral(value : Boolean)
//   A boolean literal, from a JavaScript boolean.
function BooleanLiteral(value, token) {
  Node.call(this, token);

  this.value = value;
}

util.inherits(BooleanLiteral, Expression);

BooleanLiteral.prototype.name = function () {
  return this.value.toString();
};

BooleanLiteral.prototype.accept = function (visitor) {
  return visitor.visitBooleanLiteral(this);
};

BooleanLiteral.prototype.toString = function () {
  return this.value.toString();
};

BooleanLiteral.runtimeName = js.identifier("booleanLiteral");

BooleanLiteral.prototype.toJavaScript = function () {
  return Task.resolve(js
    .callExpression(BooleanLiteral.runtimeName, [js.literal(this.value)]));
};

// new NumberLiteral(value : Number)
//   A number literal from a JavaScript number.
function NumberLiteral(value, token) {
  Node.call(this, token);

  this.value = value;
}

util.inherits(NumberLiteral, Expression);

NumberLiteral.prototype.accept = function (visitor) {
  return visitor.visitNumberLiteral(this);
};

NumberLiteral.prototype.toString = function () {
  return this.value.toString();
};

NumberLiteral.runtimeName = js.identifier("numberLiteral");

NumberLiteral.prototype.toJavaScript = function () {
  return Task.resolve(js
    .callExpression(NumberLiteral.runtimeName, [js.literal(this.value)]));
};

// new StringLiteral(value : String)
//   An object wrapping a string literal.
function StringLiteral(value, token) {
  Node.call(this, token);

  this.value = value;
}

util.inherits(StringLiteral, Expression);

StringLiteral.prototype.accept = function (visitor) {
  return visitor.visitStringLiteral(this);
};

StringLiteral.prototype.toString = function () {
  return '"' + this.value.replace(new RegExp('"', "g"), '\\"') + '"';
};

StringLiteral.runtimeName = js.identifier("stringLiteral");

StringLiteral.prototype.toJavaScript = function () {
  return Task.resolve(js
    .callExpression(StringLiteral.runtimeName, [js.literal(this.value)]));
};

// An abstract constructor for variable declarations.
function Declaration(token) {
  Node.call(this, token);
}

util.inherits(Declaration, Node);

Declaration.prototype.patternOrIfAbsent = function (onAbsent) {
  if (this.pattern === null) {
    return onAbsent.apply();
  }

  return this.pattern;
};

Declaration.prototype.accept = function (visitor) {
  var self = this;

  return self.name.accept(visitor).then(function () {
    return self.pattern !== null ? self.pattern.accept(visitor) : undefined;
  }).then(function () {
    return acceptAll(self.annotations, visitor);
  }).then(function () {
    return self.value.accept(visitor);
  });
};

// new Def(name : Identifier, pattern : Expression,
//     annotations : [Expression], value : Expression)
//   A definition declaration.
function Def(name, pattern, annotations, value, token) {
  Declaration.call(this, token);

  this.name = name;
  this.pattern = pattern;
  this.annotations = annotations;
  this.value = value;
}

util.inherits(Def, Declaration);

Def.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitDef(self).then(function () {
    return Declaration.prototype.accept.call(self, visitor);
  });
};

Def.prototype.toString = function () {
  var pattern = this.pattern;

  return "def " + this.name + (pattern === null ? "" : " : " + pattern) +
    commas(" is ", this.annotations, "") + " = " + this.value;
};

Def.runtimeName = js.identifier("defineDef");

Def.prototype.toJavaScript = function () {
  var self = this;

  return nullToJS(self.pattern).then(function (pattern) {
    return allToJS(self.annotations).then(function (annotations) {
      return self.value.toJavaScript().then(function (value) {
        return js.callExpression(Def.runtimeName, [js.literal(self.name),
          pattern, js.arrayExpression(annotations), value]);
      });
    });
  });
};

// new Var(name : Identifier, pattern : Expression,
//     annotations : [Expression], value : Expression)
//   A variable declaration.
function Var(name, pattern, annotations, value, token) {
  Declaration.call(this, token);

  this.name = name;
  this.pattern = pattern;
  this.annotations = annotations;
  this.value = value;
}

util.inherits(Var, Declaration);

Var.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitVar(self).then(function () {
    return Declaration.prototype.accept.call(self, visitor);
  });
};

Var.prototype.toString = function () {
  var pattern, value;

  pattern = this.pattern;
  value = this.value;

  return "var " + this.name + (pattern === null ? "" : " : " + pattern) +
    commas(" is ", this.annotations, "") +
    (value === null ? "" : " := " + value);
};

Var.runtimeName = js.identifier("defineVar");

Var.prototype.toJavaScript = function () {
  var self = this;

  return nullToJS(self.pattern).then(function (pattern) {
    return allToJS(self.annotations).then(function (annotations) {
      return nullToJS(self.value).then(function (value) {
        return js.callExpression(Def.runtimeName, [js.literal(self.name),
          pattern, js.arrayExpression(annotations), value]);
      });
    });
  });
};

// new ObjectConstructor(annotations : [Expression],
//     body : [Statement | Method])
//   An object constructor.
function ObjectConstructor(annotations, body, token) {
  Node.call(this, token);

  this.annotations = annotations;
  this.body = body;
}

util.inherits(ObjectConstructor, Expression);

ObjectConstructor.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitObjectConstructor(self).then(function () {
    return acceptAll(self.body, visitor);
  });
};

ObjectConstructor.prototype.toString = function () {
  var body = this.body;

  return "object" + commas(" is ", this.annotations, "") +
    " {" + (body.length === 0 ? "" : "\n  " + body.join("\n  ") + "\n") + "}";
};

ObjectConstructor.runtimeName = js.identifier("makeObject");

ObjectConstructor.prototype.toJavaScript = function () {
  var self = this;

  return allToJS(self.annotations).then(function (annotations) {
    return allToJS(this.body).then(function (body) {
      body = js.blockStatement(body);
      return js.callExpression(ObjectConstructor.runtimeName,
        [js.arrayExpression(annotations),
          js.functionExpression(null, [js.identifier("self")], body)]);
    });
  });
};

// new Method(signature : Signature,
//     annotations : [Expression], body: [Statement])
function Method(signature, annotations, body, token) {
  Node.call(this, token);

  this.signature = signature;
  this.annotations = annotations;
  this.body = body;
}

util.inherits(Method, Node);

Method.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitMethod(self).then(function () {
    return self.signature.accept(visitor);
  }).then(function () {
    return acceptAll(self.annotations, visitor);
  }).then(function () {
    return acceptAll(self.body, visitor);
  });
};

Method.prototype.toString = function () {
  var body, braceSep;

  body = this.body;
  braceSep = body.length > 0 ? "\n" : "";

  return "method " + this.signature + commas(" is ", this.annotations, "") +
    " {" + braceSep + body.join("\n") + braceSep + "}";
};

Method.runtimeName = js.identifier("makeMethod");

Method.prototype.toJavaScript = function () {
  var self = this;

  return allToJS(self.signature).then(function (signature) {
    return allToJS(self.annotations).then(function (annotations) {
      return allToJS(self.body).then(function (body) {
        return js.callExpression(Method.runtimeName,
          [signature, annotations, body]);
      });
    });
  });
};

// new Class(name : Identifier, signature : Signature,
//     annotations : [Expression], body : [Statement])
function Class(name, signature, annotations, body, token) {
  Node.call(this, token);

  this.name = name;
  this.signature = signature;
  this.annotations = annotations;
  this.body = body;
}

util.inherits(Class, Node);

Class.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitClass(self).then(function () {
    return self.name.accept(visitor);
  }).then(function () {
    return self.signature.accept(visitor);
  }).then(function () {
    return acceptAll(self.annotations, visitor);
  }).then(function () {
    return acceptAll(self.body, visitor);
  });
};

Class.prototype.toString = function () {
  var body, braceSep;

  body = this.body;
  braceSep = body.length > 0 ? "\n" : "";

  return "class " + this.name + "." + this.signature +
    commas(" is ", this.annotations, "") +
    " {" + braceSep + body.join("\n") + braceSep + "}";
};

Class.runtimeName = js.identifier("makeClass");

Class.prototype.toJavaScript = function () {
  var self = this;

  return allToJS(self.signature).then(function (signature) {
    return allToJS(self.annotations).then(function (annotations) {
      return allToJS(self.body).then(function (body) {
        return js.callExpression(Class.runtimeName,
          [js.literal(self.name), signature, annotations, body]);
      });
    });
  });
};

// new Signature(parts : [SignaturePart], pattern : Expression)
//   A list of signature parts combined with an optional return pattern.
function Signature(parts, pattern, token) {
  Node.call(this, token);

  this.parts = parts;
  this.pattern = pattern;
}

util.inherits(Signature, Node);

Signature.prototype.name = buildName;
Signature.prototype.name = buildUglyName;

Signature.prototype.patternOrIfAbsent = function (onAbsent) {
  if (this.pattern === null) {
    return onAbsent.apply();
  }

  return this.pattern;
};

Signature.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitSignature(self).then(function () {
    return acceptAll(self.parts, visitor);
  }).then(function () {
    return self.pattern !== null ? self.pattern.accept(visitor) : undefined;
  });
};

Signature.prototype.toString = function () {
  var pattern = this.pattern;

  return this.parts.join(" ") + (pattern ? " -> " + pattern : "");
};

Signature.prototype.toJavaScript = function () {
  
};

// new SignaturePart(name : Identifier,
//     generics : [Identifier], parameters : [Parameter])
//   A part of a method's signature.
function SignaturePart(name, generics, parameters) {
  Node.call(this, name);

  this.name = name;
  this.generics = generics;
  this.parameters = parameters;
}

util.inherits(SignaturePart, Node);

SignaturePart.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitSignaturePart(self).then(function () {
    return self.name.accept(visitor);
  }).then(function () {
    return acceptAll(self.generics, visitor);
  }).then(function () {
    return acceptAll(self.parameters, visitor);
  });
};

SignaturePart.prototype.toString = function () {
  return this.name + commas("<", this.generics, ">") +
    commas("(", this.parameters, ")");
};

// new Parameter(name : Identifier, pattern : Expression, isVarArg : Boolean)
//   A parameter in a method signature.
function Parameter(name, pattern, isVarArg, token) {
  Node.call(this, token);

  this.name = name;
  this.pattern = pattern;
  this.isVarArg = isVarArg;
}

util.inherits(Parameter, Node);

Parameter.prototype.patternOrIfAbsent = function (onAbsent) {
  if (this.pattern === null) {
    return onAbsent.apply();
  }

  return this.pattern;
};

Parameter.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitParameter(self).then(function () {
    return self.name.accept(visitor);
  }).then(function () {
    return self.pattern !== null ? self.pattern.accept(visitor) : undefined;
  });
};

Parameter.prototype.toString = function () {
  var pattern = this.pattern;

  return (this.isVarArg ? "*" : "") + this.name +
    (pattern === null ? "" : " : " + pattern);
};

// new Block(parameters : [Parameter], body : [Statement])
//   A block literal.
function Block(parameters, body, token) {
  Node.call(this, token);

  this.parameters = parameters;
  this.body = body;
}

util.inherits(Block, Expression);

Block.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitBlock(self).then(function () {
    return acceptAll(self.parameters, visitor);
  }).then(function () {
    return acceptAll(self.body, visitor);
  });
};

Block.prototype.toString = function () {
  var body, braceSep, newline;

  body = this.body;
  newline = body.length > 1;
  braceSep = body.length === 0 ? "" : newline ? "\n" : " ";

  return "{" + commas("", this.parameters, " ->") +
    braceSep + body.join("\n") + braceSep + "}";
};

// new Return(expression : Expression)
//   A return statement with an optional expression.
function Return(expression, token) {
  Node.call(this, token);

  this.expression = expression;
}

util.inherits(Return, Node);

Return.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitReturn(self).then(function () {
    return self.expression.accept(visitor);
  });
};

Return.prototype.toString = function () {
  var expression = this.expression;
  return "return" + (expression === null ? "" : " " + expression);
};

// new Inherits(request : Request)
//   An inherits statement with a required super-object request.
function Inherits(request, token) {
  Node.call(this, token);

  this.request = request;
}

util.inherits(Inherits, Node);

Inherits.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitInherits(self).then(function () {
    return self.request.accept(visitor);
  });
};

Inherits.prototype.toString = function () {
  return "inherits " + this.request;
};

// new Type(signatures : [Signature])
//   A type literal of method signatures.
function Type(signatures, token) {
  Node.call(this, token);

  this.signatures = signatures;
}

util.inherits(Type, Expression);

Type.prototype.nameOf = function (i) {
  return buildName.call(this.signatures[i]);
};

Type.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitType(self).then(function () {
    return acceptAll(self.signatures, visitor);
  });
};

Type.prototype.toString = function () {
  var sep, signatures;

  signatures = this.signatures;
  sep = signatures.length === 0 ? "" : " ";

  return "type {" + sep + signatures.join("; ") + sep + "}";
};

// new TypeDeclaration(name : Identifier, generics : [Type],
//     annotations : [Expression], value : Type)
//   A new type declaration.
function TypeDeclaration(name, generics, annotations, value, token) {
  Node.call(this, token);

  this.name = name;
  this.generics = generics;
  this.annotations = annotations;
  this.value = value;
}

util.inherits(TypeDeclaration, Node);

TypeDeclaration.prototype.accept = function (visitor) {
  var self = this;

  return visitor.visitTypeDeclaration(self).then(function () {
    return self.name.accept(visitor);
  }).then(function () {
    return acceptAll(self.generics, visitor);
  }).then(function () {
    return acceptAll(self.annotations, visitor);
  }).then(function () {
    return self.value.accept(visitor);
  });
};

TypeDeclaration.prototype.toString = function () {
  return "type " + this.name + commas("<", this.generics, ">") +
    commas(" is ", this.annotations, "") + " = " + this.value;
};

TypeDeclaration.runtimeName = js.identifier("makeType");

TypeDeclaration.prototype.toJavaScript = function () {
  return js.callExpression(TypeDeclaration.runtimeName, [js.arrayExpression()]);
};

// new Self()
//   A reference to the local self value.
function Self(token) {
  Node.call(this, token);
}

util.inherits(Self, Expression);

Self.prototype.accept = function (visitor) {
  return visitor.visitSelf(this);
};

Self.prototype.toString = function () {
  return "self";
};

Self.prototype.runtimeName = js.identifier("getSelf");

Self.prototype.toJavaScript = function () {
  return js.callExpression(Self.runtimeName, []);
};

// new Super()
//   The receiver of a request on super. Only appropriate in that context: this
//   is not an expression.
function Super(token) {
  Node.call(this, token);
}

util.inherits(Super, Node);

Super.prototype.accept = function (visitor) {
  return visitor.visitSuper(this);
};

Super.prototype.toString = function () {
  return "super";
};

Outer.runtimeName = js.identifier("getSuper");

Outer.prototype.toJavaScript = function () {
  return js.callExpression(Super.runtimeName, []);
};

// new Outer()
//   The receiver of a request on outer. Only appropriate in that context: this
//   is not as expression.
function Outer(token) {
  Node.call(this, token);
}

util.inherits(Outer, Node);

Outer.prototype.accept = function (visitor) {
  return visitor.visitOuter(this);
};

Outer.prototype.toString = function () {
  return "outer";
};

Outer.runtimeName = js.identifier("getOuter");

Outer.prototype.toJavaScript = function () {
  return js.callExpression(Outer.runtimeName, []);
};

exports.Node = Node;
exports.Expression = Expression;
exports.Dialect = Dialect;
exports.Identifier = Identifier;
exports.Import = Import;
exports.Request = Request;
exports.UnqualifiedRequest = UnqualifiedRequest;
exports.QualifiedRequest = QualifiedRequest;
exports.RequestPart = RequestPart;
exports.BooleanLiteral = BooleanLiteral;
exports.NumberLiteral = NumberLiteral;
exports.StringLiteral = StringLiteral;
exports.Def = Def;
exports.Var = Var;
exports.ObjectConstructor = ObjectConstructor;
exports.Signature = Signature;
exports.SignaturePart = SignaturePart;
exports.Method = Method;
exports.Class = Class;
exports.Parameter = Parameter;
exports.Block = Block;
exports.Return = Return;
exports.Inherits = Inherits;
exports.Type = Type;
exports.TypeDeclaration = TypeDeclaration;
exports.Self = Self;
exports.Super = Super;
exports.Outer = Outer;
