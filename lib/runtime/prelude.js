// Importing this module concurrently loads the system prelude.

"use strict";

var Task, defs, fs, hopper, prelude, rt, util;

fs = require("fs");

Task = require("../task");
defs = require("./definitions");
hopper = require("../hopper");
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

prelude.LessThan = newVar("LessThan", defs.LessThan);
prelude.EqualTo = newVar("EqualTo", defs.EqualTo);
prelude.GreaterThan = newVar("GreaterThan", defs.GreaterThan);

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

prelude.mirrors = newVar("mirrors", require("./mirrors"));

// The exported prelude is a task, so other actions can wait for it to be ready
// before proceeding with evaluation. Note that it's safe to stop tasks which
// depend on this one, because there is no explicit dependency between this task
// and the internal interpreter.
module.exports = new Task(function (resolve, reject) {
  // The prelude file is read manually so that brfs can statically deposit the
  // code into this file when rendering the script for the browser.
  fs.readFile(__dirname + "/../../src/prelude.grace", "utf8",
    function (readError, code) {
      if (readError !== null) {
        return reject(readError);
      }

      hopper.interpret("prelude",
        code.toString(), prelude, function (runError) {
          if (runError !== null) {
            reject(runError);
          } else {
            resolve(prelude);
          }
        });
    });
});
