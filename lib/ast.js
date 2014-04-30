// The abstract syntax tree of Grace. Consists primarily of constructors.

"use strict";

var lexer, undefined;

lexer = require("./lexer");

// new Dialect(path : String)
//   A dialect directive.
function Dialect(path) {
  this.path = path;
}

extend(Dialect, {
  toString: function() {
    return "dialect " + this.path;
  }
});

// new Import(path : String, ident : Identifier)
//   An import directive.
function Import(path, ident) {
  this.path = path;
  this.identifier = ident;
}

extend(Import, {
  toString: function() {
    return "import " + this.path + " as " + this.identifier;
  }
});

// new StringLiteral(value : String)
//   An object wrapping a string literal.
function StringLiteral(value) {
  this.value = value;
}

extend(StringLiteral, {
  toString: function() {
    return '"' + this.value.replace(/"/g/*"*/, '\\"') + '"'
  }
});

// new Identifier(value : String)
//   An identifier.
function Identifier(value) {
  this.value = value;
}

extend(Identifier, {
  toString: function() {
    return this.value;
  }
});

// new Request(receiver : Expression, signature : List<RequestPart>)
//   A method request or variable lookup.
function Request(receiver, signature) {
  this.receiver = receiver;
  this.signature = signature;
}

extend(Request, {
  name: name,

  toString: function() {
    var receiver = this.receiver;
    return (receiver === null ? "" : receiver + ".") + this.signature.join(" ");
  }
});

// new RequestPart(name : String, parameters : List<Expression>)
//   A part of a request's signature.
function RequestPart(name, parameters) {
  this.name = name;
  this.parameters = parameters;
}

extend(RequestPart, {
  toString: function() {
    var args = this.parameters;
    return this.name + (args.length === 0 ? "" : "(" + args.join(", ") + ")");
  }
});

// new NumberLiteral(value : String)
//   A number literal, from the value to parse.
function NumberLiteral(value) {
  this.value = value;
}

extend(NumberLiteral, {
  toString: function() {
    return this.value;
  }
});

// new Def(name : Identifier, value : Expression)
//   A definition declaration.
function Def(name, value) {
  this.name = name;
  this.value = value;
}

extend(Def, {
  toString: function() {
    return "def " + this.name + " = " + this.value;
  }
});

// new Var(name : Identifier, value : Expression)
//   A variable declaration.
function Var(name, value) {
  this.name = name;
  this.value = value;
}

extend(Var, {
  toString: function() {
    var value = this.value;
    return "var " + this.name + (value === null ? "" : " := " + value);
  }
});

// new ObjectConstructor(body : List<Statement | Method>)
//   An object constructor.
function ObjectConstructor(body) {
  this.body = body;
}

extend(ObjectConstructor, {
  toString: function() {
    var body = this.body;

    return "object {" + (body.length === 0 ? "" :
      "\n  " + body.join("\n  ") + "\n") + "}";
  }
});

// new Method(signature : List<SignaturePart>, pattern : Expression,
//     body: List<Statement>)
//   A method.
function Method(signature, pattern, body) {
  this.signature = signature;
  this.pattern = pattern;
  this.body = body;
}

extend(Method, {
  name: name,

  toString: function() {
    var body, braceSep, pattern;

    body = this.body;
    pattern = this.pattern;
    braceSep = body.length > 1 ? "\n" : "";

    return "method " + this.signature.join(" ") +
      (rtype === null ? "" : " -> " + pattern) + " {" + braceSep +
      body.join("\n") + braceSep + "}";
  }
});

// new SignaturePart(name : Identifier, parameters : List<Parameter>)
//   A part of a method's signature.
function SignaturePart(name, parameters) {
  this.name = name;
  this.parameters = parameters;
}

extend(SignaturePart, {
  toString: function() {
    var params = this.parameters;
    return this.name + (params.length > 0 ? "(" + params.join(", ") + ")" : "");
  }
});

// new Parameter(name : Identifier, pattern : Expression)
//   A parameter in a method signature.
function Parameter(name, pattern) {
  this.name = name;
  this.pattern = pattern;
}

extend(Parameter, {
  toString: function() {
    var pattern = this.pattern;
    return this.name + (pattern === null ? "" : " : " + pattern);
  }
});

// new Block(parameters : List<Parameter>, body : List<Statement>)
//   A block literal.
function Block(parameters, body) {
  this.parameters = parameters;
  this.body = body;
}

extend(Block, {
  toString: function() {
    var body, braceSep, newline, params;

    body = this.body;
    newline = body.length > 1;
    braceSep = body.length === 0 ? "" : newline ? "\n" : " ";
    params = this.parameters;

    return "{" + (params.length === 0 ? "" : params.join(", ") + " ->") +
      braceSep + body.join("\n") + braceSep + "}";
  }
});

// extend(constructor : Function, object : Object)
//   Extends the prototype of the given constructor with the properties in the
//   given object.
function extend(constructor, object) {
  var key, name, proto;

  name = constructor.name;
  constructor.toString = function() { return name; };

  proto = constructor.prototype;
  for (key in object) {
    proto[key] = object[key];
  }
}

// (this : Request | Method).name(pretty : Boolean = false) : String
//   Builds a name from the signature of a Request or Method.
function name(pretty) {
  var i, l, name, part, parts, signature;

  signature = this.signature;

  if (signature.length === 1) {
    part = signature[0];
    name = part.name.value;

    if (part.parameters.length === 0 || lexer.isSymbol(name[name.length - 1])) {
      return name;
    }
  }

  parts = [];

  for (i = 0, l = signature.length; i < l; i++) {
    parts.push(signature[i].name + (pretty ? "()" : ""));
  }

  return parts.join(" ");
}

exports.Dialect = Dialect;
exports.Identifier = Identifier;
exports.Import = Import;
exports.Request = Request;
exports.RequestPart = RequestPart;
exports.StringLiteral = StringLiteral;
exports.NumberLiteral = NumberLiteral;
exports.Def = Def;
exports.Var = Var;
exports.ObjectConstructor = ObjectConstructor;
exports.SignaturePart = SignaturePart;
exports.Method = Method;
exports.Parameter = Parameter;
exports.Block = Block;

