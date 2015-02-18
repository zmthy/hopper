// The abstract syntax tree of Grace. Consists primarily of constructors.

"use strict";

var util = require("./util");

// (this : Request | Signature).name() : String
//   Builds a name from the signature of a Request or Method.
function buildName() {
  var i, l, part, parts, signature, value;

  signature = this.parts;

  if (signature.length === 1) {
    part = signature[0];
    value = part.name;

    if (value.isOperator || part.parameters.length === 0) {
      return value.value;
    }
  }

  parts = [];

  for (i = 0, l = signature.length; i < l; i += 1) {
    parts.push(signature[i].name + "()");
  }

  return parts.join(" ");
}

// commas(left : String, list : [Object], right : String) : String
//   Build a comma separated list separated by the given arguments, or an empty
//   string if there is nothing in the list.
function commas(left, list, right) {
  return list.length === 0 ? "" : left + list.join(", ") + right;
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

Request.prototype.toString = function () {
  return this.parts.join(" ");
};

// new UnqualifiedRequest(signature : [RequestPart])
//   A variable lookup or method request without a receiver.
function UnqualifiedRequest(signature) {
  Request.call(this, signature, signature[0]);
}

util.inherits(UnqualifiedRequest, Request);

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

// new RequestPart(name : String,
//     generics : [Expression], parameters : [Expression])
//   A part of a request's signature.
function RequestPart(name, generics, parameters) {
  Node.call(this, name);

  this.name = name;
  this.generics = generics;
  this.parameters = parameters;
}

util.inherits(RequestPart, Node);

RequestPart.prototype.toString = function () {
  var name, param, params;

  name = this.name;
  params = this.parameters;

  if (name.isOperator) {
    // This can't come up unless toString is called directly on the part.
    if (name.value.substring(0, 6) === "prefix") {
      return name.value;
    }

    param = params[0];

    if (param.constructor === Request && param.isBinaryOperator()) {
      params = " (" + params + ")";
    } else {
      params = " " + param;
    }
  } else {
    params = commas("(", params, ")");
  }

  return name + commas("<", this.generics, ">") + params;
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

BooleanLiteral.prototype.toString = function () {
  return this.value.toString();
};

// new NumberLiteral(value : Number)
//   A number literal from a JavaScript number.
function NumberLiteral(value, token) {
  Node.call(this, token);

  this.value = value;
}

util.inherits(NumberLiteral, Expression);

NumberLiteral.prototype.toString = function () {
  return this.value.toString();
};

// new StringLiteral(value : String)
//   An object wrapping a string literal.
function StringLiteral(value, token) {
  Node.call(this, token);

  this.value = value;
}

util.inherits(StringLiteral, Expression);

StringLiteral.prototype.toString = function () {
  return '"' + this.value.replace(new RegExp('"', "g"), '\\"') + '"';
};

// new Def(name : Identifier, pattern : Expression,
//     annotations : [Expression], value : Expression)
//   A definition declaration.
function Def(name, pattern, annotations, value, token) {
  Node.call(this, token);

  this.name = name;
  this.pattern = pattern;
  this.annotations = annotations;
  this.value = value;
}

util.inherits(Def, Node);

Def.prototype.toString = function () {
  var pattern = this.pattern;

  return "def " + this.name + (pattern === null ? "" : " : " + pattern) +
    commas(" is ", this.annotations, "") + " = " + this.value;
};

// new Var(name : Identifier, pattern : Expression,
//     annotations : [Expression], value : Expression)
//   A variable declaration.
function Var(name, pattern, annotations, value, token) {
  Node.call(this, token);

  this.name = name;
  this.pattern = pattern;
  this.annotations = annotations;
  this.value = value;
}

util.inherits(Var, Node);

Var.prototype.toString = function () {
  var pattern, value;

  pattern = this.pattern;
  value = this.value;

  return "var " + this.name + (pattern === null ? "" : " : " + pattern) +
    commas(" is ", this.annotations, "") +
    (value === null ? "" : " := " + value);
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

ObjectConstructor.prototype.toString = function () {
  var body = this.body;

  return "object" + commas(" is ", this.annotations, "") +
    " {" + (body.length === 0 ? "" : "\n  " + body.join("\n  ") + "\n") + "}";
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

Method.prototype.toString = function () {
  var body, braceSep;

  body = this.body;
  braceSep = body.length > 0 ? "\n" : "";

  return "method " + this.signature + commas(" is ", this.annotations, "") +
    " {" + braceSep + body.join("\n") + braceSep + "}";
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

Class.prototype.toString = function () {
  var body, braceSep;

  body = this.body;
  braceSep = body.length > 0 ? "\n" : "";

  return "class " + this.name + "." + this.signature +
    commas(" is ", this.annotations, "") +
    " {" + braceSep + body.join("\n") + braceSep + "}";
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

Signature.prototype.toString = function () {
  var pattern = this.pattern;

  return this.parts.join(" ") + (pattern ? " -> " + pattern : "");
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

TypeDeclaration.prototype.toString = function () {
  return "type " + this.name + commas("<", this.generics, ">") +
    commas(" is ", this.annotations, "") + " = " + this.value;
};

// new Self()
//   A reference to the local self value.
function Self(token) {
  Node.call(this, token);
}

util.inherits(Self, Expression);

Self.prototype.toString = function () {
  return "self";
};

// new Super()
//   The receiver of a request on super. Only appropriate in that context: this
//   is not an expression.
function Super(token) {
  Node.call(this, token);
}

util.inherits(Super, Node);

Super.prototype.toString = function () {
  return "super";
};

// new Outer()
//   The receiver of a request on outer. Only appropriate in that context: this
//   is not as expression.
function Outer(token) {
  Node.call(this, token);
}

util.inherits(Outer, Node);

Outer.prototype.toString = function () {
  return "outer";
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
