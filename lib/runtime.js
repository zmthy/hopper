// The core runtime object definitions.

"use strict";

var Pattern, Unknown, done, help, util;

util = require("./util");
util.extend(util, require("util"));

function async(func) {
  func.asynchronous = true;
  return func;
}

function lookup(receiver, pretty) {
  var l, method, name, ours;

  name = util.uglify(pretty);
  method = receiver[name];
  ours = receiver instanceof PObject;

  // This is a normal object, so it needs to mimic a Grace object.
  // Function properties are considered the same as methods, and cannot
  // be assigned to.
  if (!ours && typeof method !== "function") {
    if (name === "asString") {
      method = receiver.toString;

      if (method === Object.prototype.toString) {
        method = PObject.prototype.asString;
      }
    } else {
      l = name.length - 3;
      if (name.substring(l) === " :=") {
        name = name.substring(0, l);

        if (typeof receiver[name] !== "function") {
          method = function (args) {
            receiver[name] = args[0];
          };
        }
      } else {
        method = receiver[name];

        if (method !== "undefined") {
          if (typeof method !== "function") {
            method = function () {
              return receiver[name];
            };
          }
        } else {
          method = PObject.prototype[name];
        }
      }
    }
  }

  if (typeof method !== "function" ||
      (ours && method === Object.prototype[name]) ||
          (typeof method === "function" && method.internal)) {
    throw "No such method '" + pretty + "' in " + receiver;
  }

  return method;
}

function PObject() {
  return this;
}

PObject.prototype["=="] = function (b) {
  if (arguments.length < 1) {
    throw "Not enough arguments for method '=='";
  }

  if (arguments.length > 1) {
    throw "Too many arguments for method '=='";
  }

  return PBoolean(this === b);
};

PObject.prototype["!="] = function (b) {
  if (arguments.length < 1) {
    throw "Not enough arguments for method '!='";
  }

  if (arguments.length > 1) {
    throw "Too many arguments for method '!='";
  }

  return (this['=='] || PObject.prototype["=="]).call(this, b)["prefix!"]();
};

PObject.prototype.asString = function () {
  var method, methods;

  if (arguments.length > 0) {
    throw "Too many arguments for method 'asString'";
  }

  methods = [];
  util.forProperties(this, function (key, method) {
    if (typeof method === "function" && key[0] !== "_"
        && method !== PObject.prototype[key]) {
      methods.push("method " + key);
    }
  });

  return PString("object {" + (methods.length === 0 ? "" :
      methods.length === 1 ? " " + methods[0] + " " :
          "\n  " + methods.join("\n  ") + "\n") + "}");
};

PObject.prototype.toString = function () {
  // TODO Support non-primitive strings.
  return (typeof this.asString === "function" ?
      this.asString()._value : PObject.prototype.asString.call(this)._value);
};

PObject.prototype.toString.internal = true;

done = new PObject();
done.asString = function () {
  return PString("done");
};

function Primitive(value) {
  this._value = value;
}

util.inherits(Primitive, PObject);

Primitive.prototype["=="] = function (b) {
  if (b instanceof Primitive) {
    return PBoolean(this._value === b._value);
  }

  return PBoolean["false"];
};

Primitive.prototype.asString = function () {
  return new PString(this._value.toString());
};

function PBoolean(value) {
  value = !!value;

  if (PBoolean.hasOwnProperty(value.toString())) {
    return PBoolean[value];
  }

  Primitive.call(this, value);
}

util.inherits(PBoolean, Primitive);

PBoolean.prototype["prefix!"] = function () {
  return PBoolean[!this._value];
};

PBoolean.prototype["&&"] = function (rhs) {
  return this._value ? rhs : this;
};

PBoolean.prototype["||"] = function (rhs) {
  return this._value ? this : rhs;
};

PBoolean.prototype["andAlso orElse"] = async(function (and, or, callback) {
  (this._value ? and[0] : or[0]).apply(callback);
});

PBoolean.prototype.andAlso = async(function (block, callback) {
  if (this._value) {
    block.apply(callback);
  } else {
    callback(null, done);
  }
});

PBoolean.prototype.orElse = async(function (block, callback) {
  if (this._value) {
    callback(null, done);
  } else {
    block.apply(callback);
  }
});

PBoolean["true"] = new PBoolean(true);
PBoolean["false"] = new PBoolean(false);

// TODO Implement arbitrary size.
function PNumber(value) {
  value = Number(value);

  if (this instanceof PNumber) {
    Primitive.call(this, value);
  } else {
    return new PNumber(value);
  }
}

util.inherits(PNumber, Primitive);

PNumber.prototype["+"] = function (rhs) {
  if (!(rhs instanceof PNumber)) {
    // TODO Support non-primitive numbers.
    throw "Cannot add a non-number";
  }

  return PNumber(this._value + rhs._value);
};

PNumber.prototype["-"] = function (rhs) {
  if (!(rhs instanceof PNumber)) {
    // TODO Support non-primitive numbers.
    throw "Cannot subtract a non-number";
  }

  return PNumber(this._value - rhs._value);
};

PNumber.prototype["*"] = function (rhs) {
  if (!(rhs instanceof PNumber)) {
    // TODO Support non-primitive numbers.
    throw "Cannot multiply a non-number";
  }

  return PNumber(this._value * rhs._value);
};

PNumber.prototype["/"] = function (rhs) {
  if (!(rhs instanceof PNumber)) {
    // TODO Support non-primitive numbers.
    throw "Cannot divide with a non-number";
  }

  return PNumber(this._value / rhs._value);
};

PNumber.prototype["^"] = function (rhs) {
  if (!(rhs instanceof PNumber)) {
    // TODO Support non-primitive numbers.
    throw "Cannot take a power to a non-number";
  }

  return PNumber(Math.pow(this._value, rhs._value));
};

function PString(value) {
  value = String(value);

  if (this instanceof PString) {
    Primitive.call(this, value);
  } else {
    return new PString(value);
  }
}

util.inherits(PString, Primitive);

PString.prototype.asString = function () {
  return this;
};

PString.prototype["++"] = function (rhs) {
  rhs = PObject.prototype.toString.call(rhs);

  if (typeof rhs !== "string") {
    // TODO Support non-primitive strings.
    throw "Cannot concatenate with a non-string";
  }

  return PString(this._value + rhs);
};

function AbstractPattern() {
  return this;
}

util.inherits(AbstractPattern, PObject);

AbstractPattern.prototype["&"] = async(function () {
  // TODO
  return done;
});

AbstractPattern.prototype["|"] = async(function () {
  // TODO
  return done;
});

function Type(names) {
  this._names = names;
}

util.inherits(Type, AbstractPattern);

Type.prototype.match = function (object) {
  var i, l, names;

  names = this._names;

  for (i = 0, l = names.length; i < l; i += 1) {
    if (typeof object[names[i]] !== "function") {
      return PBoolean(false);
    }
  }

  return PBoolean(true);
};

Type.prototype.asString = function () {
  var l, names, sep;

  names = this._names;
  l = names.length;
  sep = l === 0 ? "" : l === 1 ? " " : "\n  ";

  return PString("type {" + sep + names.join("\n  ") + sep + "}");
};

// A proxy for hoisted type declarations that will be filled out with the values
// of a real type once the actual value is built. As such, the proxy can be
// combined with other patterns and be tested for equality, but it cannot be
// matched or stringified.
function TypeProxy() {
  return this;
}

util.inherits(TypeProxy, AbstractPattern);

TypeProxy.prototype.match = function () {
  throw "PObject not yet instantiated";
};

TypeProxy.prototype.asString = function () {
  throw "PObject not yet instantiated";
};

// TODO Implement in Grace instead of here.
function NamedPattern(name, pattern) {
  this._name = name;
  this._pattern = pattern;
}

util.inherits(NamedPattern, AbstractPattern);

NamedPattern.prototype.name = function () {
  return PString(this._name);
};

NamedPattern.prototype.pattern = function () {
  return this._pattern;
};

NamedPattern.prototype.match = async(function (object, callback) {
  var pattern = this._pattern;

  if (pattern.asynchronous) {
    pattern.match(object, callback);
  } else {
    try {
      callback(null, pattern.match(object));
    } catch (error) {
      callback(error);
    }
  }
});

NamedPattern.prototype.asString = function () {
  var pattern = this._pattern;

  return PString(this._name + (pattern === Unknown ? "" : " : " + pattern));
};

Unknown = new AbstractPattern();

Unknown.match = function () {
  return PBoolean(true);
};

Unknown.asString = function () {
  return PString("Unknown");
};

Pattern = new Type(["match", "&", "|"]);

Pattern.asString = function () {
  return PString("Pattern");
};

exports.Object = PObject;
exports.done = done;
exports.Boolean = PBoolean;
exports.Number = PNumber;
exports.String = PString;
exports.Type = Type;
exports.NamedPattern = NamedPattern;
exports.Unknown = Unknown;
exports.Pattern = Pattern;
exports.TypeProxy = TypeProxy;

exports.lookup = lookup;

