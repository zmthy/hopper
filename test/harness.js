#!/usr/bin/env node

// The test harness that tests both synchronous and asynchronous behaviour.
// Grace source files in the 'run' directory must complete without error, while
// files in the 'fail' directory must produce an interpreter error (not a
// standard JavaScript error, which indicates a bug in the interpreter) instead
// of completing.

"use strict";

var async, fail, fs, hopper, pass, path, rt, stdout, summary;

fs = require("fs");
path = require("path");

hopper = require("../lib/hopper");
rt = require("../lib/runtime");

stdout = process.stdout;

function writeTest(file) {
  stdout.write("Test " + file + ": ");
}

function writeSuccess(message) {
  stdout.write("\x1b[0;32;48m" + message + "\x1b[0m\n");
}

function writePass() {
  pass += 1;
  writeSuccess("Passed");
}

function writeError(error) {
  stdout.write("\x1b[0;31;48m" + error + "\x1b[0m\n");
}

function writeFailure(reason) {
  fail += 1;
  writeError(reason);
}

function makeLoader(prefix) {
  return function (interpreter, file, callback) {
    hopper.defaultLoader(interpreter,
      path.join("test", prefix, file), callback);
  };
}

function runTest(file, loader, callback) {
  file = path.basename(file, ".grace");

  async = function (error) {
    async = undefined;
    callback(error);
  };

  writeTest(file);
  hopper.load(file, loader, async);
}

function runTests(dir, callback, completion) {
  fs.readdir(path.join("test", dir), function (error, files) {
    var i, l, loader;

    function run() {
      var file;

      do {
        if (i === l) {
          if (typeof completion === "function") {
            completion();
          }

          return;
        }

        file = files[i];
        i += 1;
      } while (path.extname(file) !== ".grace");

      runTest(file, loader, function () {
        try {
          callback.apply(this, arguments);
        } catch (reason) {
          writeError(reason);
        }

        run();
      });
    }

    if (error !== null) {
      writeFailure(error.message);
    } else {
      i = 0;
      l = files.length;

      loader = makeLoader(dir);

      run();
    }
  });
}

function summarise() {
  var i, l, tests;

  stdout.write("\n");
  for (i = 0, l = summary.length; i < l; i += 1) {
    tests = summary[i];
    (tests[1] === 0 ? writeSuccess : writeError)(tests[0] +
      " / " + (tests[0] + tests[1]) + " tests " + tests[2]);
  }
}

process.on("uncaughtException", function (error) {
  async(error);
});

process.on("exit", function () {
  var i, l;

  for (i = 0, l = summary.length; i < l; i += 1) {
    if (summary[i][1] > 0) {
      process.exit(1);
    }
  }
});

stdout.write("Executing tests...\n");

summary = [];
pass = 0;
fail = 0;

function pushSummary(value) {
  summary.push(value);
  pass = 0;
  fail = 0;
}

runTests("run", function (error) {
  if (error !== null) {
    writeFailure(error);
  } else {
    writePass();
  }
}, function () {
  pushSummary([pass, fail, "passed as required"]);

  runTests("fail", function (error) {
    if (error !== null) {
      if (rt.isInternalError(error) || rt.isParseError(error)) {
        writeFailure(error);
      } else {
        writePass();
      }
    } else {
      writeFailure("Failed (completed without error)");
    }
  }, function () {
    pushSummary([pass, fail, "failed as required"]);

    runTests("parse-fail", function (error) {
      if (error !== null) {
        if (rt.isParseError(error)) {
          writePass();
        } else {
          writeFailure(error);
        }
      } else {
        writeFailure("Failed (parsed without error)");
      }
    }, function () {
      summary.push([pass, fail, "failed parsing as required"]);
      summarise();
    });
  });
});
