"use strict";

var Task, rt, sys;

sys = require("sys");

Task = require("../lib/task");
rt = require("../lib/runtime");

function toString(value) {
  return rt.apply(value, value.asString, [[]]).then(function (value) {
    return rt.apply(value, value.asPrimitiveString, [[]]);
  });
}

function writeGreen(value) {
  sys.puts("\x1b[0;32;48m" + value + "\x1b[0m");
}

function writeRed(value) {
  sys.error("\x1b[0;31;48m" + value + "\x1b[0m");
}

function writeError(error) {
  if (rt.isGraceObject(error)) {
    return toString(error).then(function (string) {
      writeRed(string);
    }).then(null, function () {
      writeRed("Internal Error: Failed to render exception");
    });
  }

  writeRed("Internal Error: " + (error.message || error));
  return Task.resolve();
}

function writeValue(value) {
  if (rt.isGraceObject(value)) {
    return toString(value).then(writeGreen).then(null, writeError);
  }

  writeGreen(value.toString());
  return Task.resolve();
}

exports.writeError = writeError;
exports.writeValue = writeValue;

