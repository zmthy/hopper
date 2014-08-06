// Handles locating and loading imported Grace modules in Node.js. Browsers
// should override the loading mechanism when using the external interpreter
// API.

"use strict";

var Task, path, prelude, readFile, rt, terp;

path = require("path");

Task = require("./task");
rt = require("./runtime");

function loadGrace(interpreter, name) {
  readFile = readFile || Task.taskify(require("fs").readFile);

  return readFile(name + ".grace").then(function (code) {
    code = code.toString();

    // Ignore hashbang.
    if (code[0] === "#" && code[1] === "!") {
      while (code[0] === "#") {
        code = code.substring(code.indexOf("\n") + 1 || code.length);
      }
    }

    return Task.taskify(interpreter.module).call(interpreter, name, code);
  });
}

exports.loadGrace = loadGrace;

function loadJavaScript(name) {
  try {
    return Task.resolve(require(name));
  } catch (reason) {
    return Task.reject(reason);
  }
}

exports.defaultLoader = function (interpreter, name, callback) {
  name = path.join(path.dirname(name), path.basename(name, ".grace"));

  loadGrace(interpreter, name).then(null, function (reason) {
    var local;

    if (rt.isGraceExceptionPacket(reason)) {
      throw reason;
    }

    local = path.join(process.cwd(), name);

    return loadJavaScript(local).then(null, function (reason) {
      if (reason.code !== "MODULE_NOT_FOUND") {
        return rt.InternalError.raiseFromPrimitiveError(reason);
      }

      return loadJavaScript(name);
    }).then(null, function (reason) {
      if (reason.code !== "MODULE_NOT_FOUND") {
        return rt.InternalError.raiseFromPrimitiveError(reason);
      }

      return rt.UnresolvedModule
        .raiseForPath(rt.string(name)).then(null, callback);
    });
  }).callback(callback);
};

