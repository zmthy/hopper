// Handles locating and loading imported Grace modules in Node.js. Browsers
// should override the loading mechanism when using the external interpreter
// API.

"use strict";

var Task, fs, path, readFile, rt;

fs = require("fs");
path = require("path");

Task = require("./task");
rt = require("./runtime");

readFile = fs.readFile;
readFile = Task.taskify(readFile);

function loadGrace(interpreter, name) {
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

  loadGrace(interpreter, name).then(null, function (graceError) {
    var local;

    if (rt.isGraceExceptionPacket(graceError)) {
      throw graceError;
    }

    local = path.join(process.cwd(), name);

    return loadJavaScript(local).then(null, function (jsError) {
      if (jsError.code !== "MODULE_NOT_FOUND") {
        return rt.InternalError.raiseFromPrimitiveError(jsError);
      }

      return loadJavaScript(name);
    }).then(null, function (jsError) {
      if (jsError.code !== "MODULE_NOT_FOUND") {
        return rt.InternalError.raiseFromPrimitiveError(jsError);
      }

      return rt.UnresolvedModule
        .raiseForPath(rt.string(name)).then(null, callback);
    });
  }).callback(callback);
};
