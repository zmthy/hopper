// The core runtime object definitions.

"use strict";

var Pattern, Unknown, done;

function Object() {}

extend(Object, function() {}, {
  constructor: Object,

  "==": function(b) {
    if (arguments.length < 1) {
      throw "Not enough arguments for method '=='";
    } else if (arguments.length > 1) {
      throw "Too many arguments for method '=='";
    }

    return PBoolean(this === b);
  },

  "!=": function(b) {
    if (arguments.length < 1) {
      throw "Not enough arguments for method '!='";
    } else if (arguments.length > 1) {
      throw "Too many arguments for method '!='";
    }

    return (this['=='] || Object.prototype["=="]).call(this, b)["prefix!"]();
  },

  asString: function() {
    var k, method, methods;

    if (arguments.length > 0) {
      throw "Too many arguments for method 'asString'";
    }

    methods = [];
    for (k in this) {
      method = this[k];
      if (typeof method === "function" && k[0] !== "_"
          && method !== Object.prototype[k]) {
        methods.push("method " + k);
      }
    }

    return PString("object {" + (methods.length === 0 ? "" :
      methods.length == 1 ? " " + methods[0] + " " :
      "\n  " + methods.join("\n  ") + "\n") + "}");
  },

  toString: function() {
    // TODO Support non-primitive strings.
    return (typeof this.asString === "function" ?
      this.asString()._value : Object.prototype.asString.call(this)._value);
  },
});

Object.prototype.toString.internal = true;

done = new Object();
done.asString = function() {
  return PString("done");
};

function Primitive(value) {
  this._value = value;
}

extend(Primitive, Object, {
  "==": function(b) {
    if (b instanceof Primitive) {
      return PBoolean(this._value === b._value);
    }

    return PBoolean["false"];
  },

  asString: function() {
    return new PString(this._value.toString());
  }
});

function PBoolean(value) {
  value = !!value;

  if (PBoolean.hasOwnProperty(value.toString())) {
    return PBoolean[value];
  }

  Primitive.call(this, value);
}

extend(PBoolean, Primitive, {
  "prefix!": function() {
    return PBoolean[!this._value];
  },

  "&&": function(rhs) {
    return this._value ? rhs : this;
  },

  "||": function(rhs) {
    return this._value ? this : rhs;
  },

  "andAlso orElse": async(function(and, or, callback) {
    (this._value ? and[0] : or[0]).apply(callback);
  }),

  andAlso: async(function(block, callback) {
    if (this._value) {
      block.apply(callback);
    } else {
      callback(null, done);
    }
  }),

  orElse: async(function(block, callback) {
    if (this._value) {
      callback(null, done);
    } else {
      block.apply(callback);
    }
  })
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

extend(PNumber, Primitive, {
  "+": function(rhs) {
    if (!(rhs instanceof PNumber)) {
      // TODO Support non-primitive numbers.
      throw "Cannot add a non-number";
    }

    return PNumber(this._value + rhs._value);
  },

  "-": function(rhs) {
    if (!(rhs instanceof PNumber)) {
      // TODO Support non-primitive numbers.
      throw "Cannot subtract a non-number";
    }

    return PNumber(this._value - rhs._value);
  },

  "*": function(rhs) {
    if (!(rhs instanceof PNumber)) {
      // TODO Support non-primitive numbers.
      throw "Cannot multiply a non-number";
    }

    return PNumber(this._value * rhs._value);
  },

  "/": function(rhs) {
    if (!(rhs instanceof PNumber)) {
      // TODO Support non-primitive numbers.
      throw "Cannot divide with a non-number";
    }

    return PNumber(this._value / rhs._value);
  },

  "^": function(rhs) {
    if (!(rhs instanceof PNumber)) {
      // TODO Support non-primitive numbers.
      throw "Cannot take a power to a non-number";
    }

    return PNumber(Math.pow(this._value, rhs._value));
  }
});

function PString(value) {
  value = String(value);

  if (this instanceof PString) {
    Primitive.call(this, value);
  } else {
    return new PString(value);
  }
}

extend(PString, Primitive, {
  asString: function() {
    return this;
  },

  "++": function(rhs) {
    rhs = Object.prototype.toString.call(rhs);

    if (typeof rhs !== "string") {
      // TODO Support non-primitive strings.
      throw "Cannot concatenate with a non-string";
    }

    return PString(this._value + rhs);
  }
});

function AbstractPattern() {}

extend(AbstractPattern, Object, {
  "&": async(function() {
    // TODO
  }),

  "|": async(function() {
    // TODO
  })
});

function Type(signatures) {
  this._signatures = signatures;
}

extend(Type, AbstractPattern, {
  match: function(object) {
    var i, l, signatures;

    signatures = this._signatures;

    for (i = 0, l = signatures.length; i < l; i++) {
      if (typeof object[signatures[i].name()] !== "function") {
        return PBoolean(false);
      }
    }

    return PBoolean(true);
  },

  asString: function() {
    var header, headers, i, j, k, l, signature, signatures;

    signatures = this._signatures;
    l = signatures.length;

    return PString("type {" + (l === 0 ? "" :
      l === 1 ? " " + signatures[0] + " " :
      "\n  " + headers.join("\n") + "\n") + "}");
  }
});

function Signature(parts, pattern) {
  this.parts = parts;
  this.pattern = pattern;
}

Signature.prototype = {
  name: function() {
    var i, l, names, parts;

    names = [];
    parts = this.parts;

    for (i = 0, l = parts.length; i < l; i++) {
      names.push(parts[i].name);
    }

    return names.join(" ");
  },

  toString: function() {
    var pattern = this.pattern;

    return this.parts.join(" ") + (pattern === Unknown ? "" : " -> " + pattern);
  }
};

function SignaturePart(name, parameters) {
  this.name = name;
  this.parameters = parameters;
}

SignaturePart.prototype = {
  toString: function() {
    var parameters = this.parameters;

    return this.name + (parameters.length === 0 ? "" :
      "(" + parameters.join(", ") + ")");
  }
};

// TODO Implement in Grace instead of here.
function NamedPattern(name, pattern) {
  this._name = name;
  this._pattern = pattern;
}

extend(NamedPattern, AbstractPattern, {
  name: function() {
    return PString(this._name);
  },

  match: async(function(object, callback) {
    var pattern = this._pattern;

    if (pattern.asynchronous) {
      pattern.match(object, callback);
    } else {
      try {
        callback(null, pattern.match(object));
      } catch(error) {
        callback(error);
      }
    }
  }),

  asString: function() {
    var pattern = this._pattern;

    return PString(this._name + (pattern === Unknown ? "" : " : " + pattern));
  }
});

Unknown = new AbstractPattern();

Unknown.match = function() {
  return PBoolean(true);
};

Unknown.asString = function() {
  return PString("Unknown");
}

Pattern = new Type([
  new Signature([new SignaturePart("match", [Unknown])]),
  new Signature([new SignaturePart("&", [Pattern])]),
  new Signature([new SignaturePart("|", [Pattern])]),
], Unknown);

Pattern.asString = function() {
  return PString("Pattern");
}

// extend(constructor : Function, object : Object)
//   Extends the prototype of the given constructor with the properties in the
//   given object.
function extend(constructor, parent, object) {
  var key, proto;

  function temp() {}
  temp.prototype = parent.prototype;

  proto = new temp();
  for (key in object) {
    proto[key] = object[key];
  }

  constructor.prototype = proto;
}

function async(func) {
  func.asynchronous = true;
  return func;
}

exports.Object = Object;
exports.done = done;
exports.Boolean = PBoolean;
exports.Number = PNumber;
exports.String = PString;
exports.Type = Type;
exports.Signature = Signature;
exports.SignaturePart = SignaturePart;
exports.NamedPattern = NamedPattern;
exports.Unknown = Unknown;
exports.Pattern = Pattern;

