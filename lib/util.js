// Common utility definitions.

"use strict";

var hasOwnProperty, proto, slice;

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
  return name.replace(/\(\)/g, "").replace(/ /g, "_");
};

hasOwnProperty = proto.hasOwnProperty;

// Ensures the correct hasOwnProperty is used.
function owns(object, name) {
  return hasOwnProperty.call(object, name);
}

exports.owns = owns;

// Run a function for every iterable property in an object.
function forAllProperties(from, func) {
  var key;

  /*jslint forin: true*/
  for (key in from) {
    func(key, from[key]);
  }
  /*jslint forin: false*/
}

exports.forAllProperties = forAllProperties;

// Run a function for every iterable property directly in an object.
function forProperties(from, func) {
  return forAllProperties(from, function (key, value) {
    if (owns(from, key)) {
      func(key, value);
    }
  });
}

exports.forProperties = forProperties;

// Simple object key copier.
function extend(into, from) {
  forProperties(from, function (key, value) {
    if (!owns(into, key)) {
      into[key] = value;
    }
  });
}

exports.extend = extend;

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

function makeCloneable(self) {
  var l, properties;

  properties = slice.call(arguments, 1);
  l = properties.length;

  function Clone() {
    makeCloneable.apply(null, [this].concat(properties));
  }

  Clone.prototype = self;

  self.clone = function () {
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

