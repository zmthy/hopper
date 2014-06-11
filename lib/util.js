// Common utility definitions.

"use strict";

var forProperties, hasOwnProperty, slice;

// Simple identity function.
exports.id = function (x) {
  return x;
};

slice = Array.prototype.slice;

// Standard not-quite-array slicer.
exports.slice = function (list, from, to) {
  return slice.call(list, from, to);
};

// Strip the parentheses from Grace method names.
exports.uglify = function (name) {
  return name.replace(/\(\)/g, "");
};

hasOwnProperty = Object.prototype.hasOwnProperty;

// Ensures the correct hasOwnProperty is used.
function owns(object, name) {
  return hasOwnProperty.call(object, name);
}

exports.owns = owns;

forProperties = function (from, func) {
  var key;

  for (key in from) {
    if (owns(from, key)) {
      func(key, from[key]);
    }
  }
};

exports.forProperties = forProperties;

// Simple object key copier.
exports.extend = function (into, from) {
  forProperties(from, function (key, value) {
    into[key] = value;
  });
};

