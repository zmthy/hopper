// The core runtime object definitions.

"use strict";

function Object() {}

Object.prototype = {
  '==': function(b) {
    return this === b[0];
  },

  '!=': function(b) {
    return !this['=='](b);
  },

  asString: function() {
    var k, method, methods;

    methods = [];
    for (k in this) {
      method = this[k];
      if (method !== Object.prototype[k]) {
        methods.push("method " + k);
      }
    }

    if (methods.length === 0) {
      return "object {}";
    } else if (methods.length == 1) {
      return "object { " + methods[0] + " }"
    } else {
      return "object {\n" + methods.join("\n") + "\n}";
    }
  },

  toString: function() {
    return this.asString();
  },
};

exports.Object = Object;

