// The core runtime object definitions.

"use strict";

var done;

function Object() {}

extend(Object, function() {}, {
  constructor: Object,

  "==": function(b) {
    return PBoolean(this === b);
  },

  "!=": function(b) {
    return (this['=='] || Object.prototype["=="]).call(this, b)["prefix!"]();
  },

  asString: function() {
    var k, method, methods;

    methods = [];
    for (k in this) {
      method = this[k];
      if (k[0] !== "_" && method !== Object.prototype[k]) {
        methods.push("method " + k);
      }
    }

    return PString(methods.length === 0 ? "object {}" :
      methods.length == 1 ? "object { " + methods[0] + " }" :
      "object {\n" + methods.join("\n") + "\n}");
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

  "andAlso orElse": async(function(and, callback) {
    return function(or) {
      (this._value ? and : or).apply(callback);
    };
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

// extend(constructor : Function, object : Object)
//   Extends the prototype of the given constructor with the properties in the
//   given object.
function extend(constructor, parent, object) {
  var key, proto;

  function temp() {}
  temp.prototype = parent.prototype;

  proto = new temp();
  proto.constructor = constructor;
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

