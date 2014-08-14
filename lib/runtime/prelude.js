// Importing this module concurrently loads the system prelude.

"use strict";

var Task, defs, fs, loader, hopper, path, prelude, rt, util;

fs = require("fs");
path = require("path");

Task = require("../task");
defs = require("./definitions");
hopper = require("../hopper");
loader = require("../loader");
rt = require("../runtime");
util = require("../util");

// Set up the built-in prelude values.
prelude = defs.object();

function newVar(name, value) {
  return rt.method(name, 0, function () {
    return value;
  });
}

function newType(name, value) {
  var generics = value.object ? value.object.generics : 0;

  return rt.method(name, [[generics, 0]], function () {
    return rt.withGenerics
      .apply(null, [name, value].concat(util.slice(arguments)));
  });
}

prelude.done = newVar("done", rt.done);

util.extend(prelude, require("./methods"));

util.forProperties(require("./types"), function (name, value) {
  prelude[name] = newType(name, value);
});

function addProperties(list) {
  util.forProperties(list, function (name, value) {
    prelude[name] = newVar(name, value);
  });
}

addProperties(require("./exceptions"));
addProperties(require("./publicity"));

// The exported prelude is a task, so other actions can wait for it to be ready
// before proceeding with evaluation.
module.exports = new Task(function (resolve, reject) {
  // The prelude file is read manually so that brfs can statically deposit the
  // code into this file when rendering the script for the browser.
  /*jslint nomen: true*/
  fs.readFile(__dirname + "/../../src/prelude.grace", "utf8",
    function (error, code) {
      if (error !== null) {
        return reject(error);
      }

      Task.taskify(hopper.interpret)
        .call(hopper, "prelude", code.toString(), prelude).then(function () {
          resolve(prelude);
        }, function (reason) {
          reject(reason);
        });
    });
  /*jslint nomen: false*/
});

