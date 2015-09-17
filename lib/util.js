// Common utility definitions.

"use strict";

var hasOwnProp, proto, slice, unicode;

unicode = require("./unicode");

proto = Object.prototype;

// Simple identity function.
exports.id = function (x) {
  return x;
};

slice = Array.prototype.slice;

// Standard not-quite-array slicer.
exports.slice = function (list, from, to) {
  return slice.call(list, from, to);
};

exports.contains = function (list, value) {
  var i, l;

  for (i = 0, l = list.length; i < l; i += 1) {
    if (list[i] === value) {
      return true;
    }
  }

  return false;
};

// Strip the parentheses from Grace method names.
exports.uglify = function (name) {
  return name.replace(/\(\)/g, "").replace(/ :=/, ":=").replace(/ /g, "_");
};

hasOwnProp = proto.hasOwnProperty;

// Ensures the correct hasOwnProperty is used.
function owns(object, name) {
  return hasOwnProp.call(object, name);
}

exports.owns = owns;

// Run a function for every iterable property directly in an object.
function forProperties(from, func) {
  var key;

  for (key in from) {
    if (owns(from, key)) {
      func(key, from[key]);
    }
  }
}

exports.forProperties = forProperties;

// Simple object key copier.
function extend(into, from) {
  var key;

  for (key in from) {
    if (owns(from, key) && !owns(into, key)) {
      into[key] = from[key];
    }
  }
}

exports.extend = extend;

exports.extendAll = function (into, from) {
  var key;

  for (key in from) {
    if (!owns(into, key)) {
      into[key] = from[key];
    }
  }
};

exports.map = function (list, func) {
  var i, l, newList;

  newList = [];

  for (i = 0, l = list.length; i < l; i += 1) {
    newList.push(func(list[i]));
  }

  return newList;
};

function pad(str) {
  while (str.length < 4) {
    str = "0" + str;
  }

  return str;
}

// Escape quotes, backslashes, and control characters in a string, making it
// safe to render inside quotes.
exports.escape = function (str) {
  var c, i, l, string;

  string = "";
  for (i = 0, l = str.length; i < l; i += 1) {
    c = str[i];

    if (unicode.isControl(c)) {
      string += "\\" + (c === "\b" ? "b" : c === "\n" ? "n" : c === "\r" ? "r" :
          c === "\t" ? "t" : c === "\f" ? "f" : c === "\v" ? "v" :
              c === "\u0000" ? "0" : "u" + pad(c.charCodeAt(0).toString(16)));
    } else if (c === '"') {
      string += '\\"';
    } else if (c === "\\") {
      string += "\\\\";
    } else {
      string += c;
    }
  }

  return string;
};

exports.newApply = function (Constructor, args) {
  function Temp() {
    Constructor.apply(this, args);
  }

  Temp.prototype = Constructor.prototype;

  return new Temp();
};

// Test if a value is an array.
exports.isArray = Array.isArray || function (value) {
  return proto.toString.call(value) === "[object Array]";
};

// Replicate a value in a list the given number of times.
exports.replicate = function (count, value) {
  var i, list;

  list = [];

  for (i = 0; i < count; i += 1) {
    list.push(value);
  }

  return list;
};

// Repeat the contents of a list the given number of times.
exports.repeat = function (count, elements) {
  var i, list;

  list = [];

  for (i = 0; i < count; i += 1) {
    list = list.concat(elements);
  }

  return list;
};

// A memoising function that also bans any recursion.
exports.once = function (func) {
  var hasFailed, hasFinished, isRunning, result;

  isRunning = false;
  hasFailed = false;
  hasFinished = false;

  return function () {
    if (hasFailed) {
      throw result;
    }

    if (hasFinished) {
      return result;
    }

    if (isRunning) {
      throw new Error("Memoised function called itself");
    }

    isRunning = true;

    try {
      result = func.apply(this, arguments);
    } catch (error) {
      hasFailed = true;
      result = error;
      throw error;
    } finally {
      isRunning = false;
    }

    hasFinished = true;
    return result;
  };
};

function makeCloneable(value) {
  var l, properties;

  properties = slice.call(arguments, 1);
  l = properties.length;

  function Clone() {
    makeCloneable.apply(null, [this].concat(properties));
  }

  Clone.prototype = value;

  value.clone = function () {
    var clone, i, property;

    clone = new Clone();

    for (i = 0; i < l; i += 1) {
      property = properties[i];
      clone[property] = this[property];
    }

    return clone;
  };
}

exports.makeCloneable = makeCloneable;

// Include the system utilities too.
extend(exports, require("util"));
