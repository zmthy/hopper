// Importing this module concurrently loads the system prelude.

"use strict";

var Task, fs, loader, hopper, path, prelude, rt, util;

fs = require("fs");
path = require("path");

Task = require("./task");
hopper = require("./hopper");
loader = require("./loader");
rt = require("./runtime");
util = require("./util");

// Set up the built-in prelude values.
prelude = rt.object();

function newVar(name, value) {
  return rt.method(name, 0, function () {
    return value;
  });
}

function newType(name, value) {
  return rt.method(name, [[value.object.generics, 0]], function () {
    return rt.withGenerics
      .apply(null, [name, value].concat(util.slice(arguments)));
  });
}

prelude.done = newVar("done", rt.done);

util.extend(prelude, require("./runtime/methods"));

util.forProperties(require("./runtime/types"), function (name, value) {
  prelude[name] = newType(name, value);
});

function addProperties(list) {
  util.forProperties(list, function (name, value) {
    prelude[name] = newVar(name, value);
  });
}

addProperties(require("./runtime/exceptions"));
addProperties(require("./runtime/publicity"));

// The exported prelude is a task, so other actions can wait for it to be ready
// before proceeding with evaluation.
module.exports = new Task(function (resolve, reject) {
  // The prelude file is read manually so that brfs can statically deposit the
  // code into this file when rendering the script for the browser.
  /*jslint nomen: true*/
  fs.readFile(__dirname + "/../src/prelude.grace", "utf8",
    function (error, code) {
      if (error !== null) {
        return reject(error);
      }

      Task.taskify(hopper.interpret).call(hopper, code.toString(), prelude)
        .then(function () {
          resolve(prelude);
        }, function (reason) {
          reject(reason);
        });
    });
  /*jslint nomen: false*/
});
