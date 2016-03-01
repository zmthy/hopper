// Handles locating and loading imported Grace modules in Node.js. Browsers
// should override the loading mechanism when using the external interpreter
// API.

"use strict";

var fs, path, readFile, rt, task;

fs = require("fs");
path = require("path");

task = require("./task");
rt = require("./runtime");

readFile = fs.readFile;
readFile = task.taskify(readFile);

function loadGrace(interpreter, name) {
  return readFile(name + ".grace").then((code) => {
    code = code.toString();

    // Ignore hashbang.
    if (code[0] === "#" && code[1] === "!") {
      while (code[0] === "#") {
        code = code.substring(code.indexOf("\n") + 1 || code.length);
      }
    }

    return task.taskify(interpreter.module).call(interpreter, name, code);
  });
}

exports.loadGrace = loadGrace;

function loadJavaScript(name) {
  try {
    return Promise.resolve(require(name));
  } catch (reason) {
    return Promise.reject(reason);
  }
}

exports.defaultLoader = function (interpreter, name, callback) {
  name = path.join(path.dirname(name), path.basename(name, ".grace"));

  task.callback(loadGrace(interpreter, name).then(null, (graceError) => {
    var local;

    if (rt.isGraceExceptionPacket(graceError)) {
      throw graceError;
    }

    local = path.join(process.cwd(), name);

    return loadJavaScript(local).then(null, (jsError) => {
      if (jsError.code !== "MODULE_NOT_FOUND") {
        return rt.InternalError.raiseFromPrimitiveError(jsError);
      }

      return loadJavaScript(name);
    }).then(null, (jsError) => {
      if (jsError.code !== "MODULE_NOT_FOUND") {
        return rt.InternalError.raiseFromPrimitiveError(jsError);
      }

      return rt.UnresolvedModule
        .raiseForPath(rt.string(name)).then(null, callback);
    });
  }), callback);
};
