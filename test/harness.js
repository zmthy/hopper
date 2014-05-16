#!/usr/bin/env node

// The test harness that tests both synchronous and asynchronous behaviour.
// Grace source files in the 'run' directory must complete without error, while
// files in the 'fail' directory must produce an interpreter error (not a
// standard JavaScript error, which indicates a bug in the interpreter) instead
// of completing.

"use strict";

var async, fail, fs, hopper, pass, path, stdout, summary, undefined;

function writeTest(file) {
  stdout.write("Test " + file + ": ");
}

function writeSuccess(message) {
  stdout.write("\x1b[0;32;48m" + message + "\x1b[0m\n");
}

function writePass() {
  pass++;
  writeSuccess("Passed");
}

function writeError(error) {
  stdout.write("\x1b[0;31;48m" + error + "\x1b[0m\n");
}

function writeFailure(reason) {
  fail++;
  writeError(reason);
}

function runSync(code, callback) {
  try {
    hopper.interpret(code);
    callback(null);
  } catch(error) {
    if (error instanceof Error) {
      writeFailure(error);
    } else {
      callback(error);
    }
  }
}

function runAsync(code, callback) {
  try {
    hopper.interpret(code, callback);
  } catch(error) {
    writeFailure(error);
  }
}

function runTest(file, callback, completion) {
  return function(error, code) {
    if (error !== null) {
      writeError(error.message);
    } else {
      code = code.toString();
      file = path.basename(file, ".grace");
      writeTest(file + " (sync)");
      runSync(code, callback);
      writeTest(file + " (async)");
      async = completion;
      runAsync(code, function(error) {
        async = undefined;
        callback(error);
        completion();
      });
    }
  }
}

function runTests(dir, callback, completion) {
  fs.readdir("test/" + dir, function(error, files) {
    var i, l;

    function run() {
      var file;

      do {
        if (i === l) {
          if (typeof completion === "function") {
            completion();
          }

          return;
        }

        file = files[i++];
      } while(path.extname(file) !== ".grace");

      fs.readFile(path.join("test/" + dir, file), runTest(file, callback, run));
    }

    if (error !== null) {
      writeFailure(error.message);
    } else {
      i = 0;
      l = files.length;
      run(0);
    }
  });
}

function summarise() {
  var i, l, tests;

  stdout.write("\n");
  for (i = 0, l = summary.length; i < l; i++) {
    tests = summary[i];
    (tests[1] === 0 ? writeSuccess : writeError)
      (tests[0] + " / " + (tests[0] + tests[1]) + " tests " + tests[2]);
  }
}

fs = require("fs");
path = require("path");
hopper = require("../lib/hopper");

stdout = process.stdout;

process.on("uncaughtException", function(error) {
  writeFailure(error);
  async();
});

stdout.write("Executing tests...\n");

summary = [];
pass = 0;
fail = 0;

runTests("run", function(error) {
  if (error !== null) {
    writeFailure(error);
  } else {
    writePass();
  }
}, function() {
  summary.push([pass, fail, "passed as required"]);
  pass = 0;
  fail = 0;

  runTests("fail", function(error) {
    if (error !== null) {
      writePass();
    } else {
      writeFailure("Failed (completed without error)");
    }
  }, function() {
    summary.push([pass, fail, "failed as required"]);
    summarise();
  });
});

