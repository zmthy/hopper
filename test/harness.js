#!/usr/bin/env node

// The test harness that tests both synchronous and asynchronous behaviour.
// Grace source files in the 'run' directory must complete without error, while
// files in the 'fail' directory must produce an interpreter error (not a
// standard JavaScript error, which indicates a bug in the interpreter) instead
// of completing.

"use strict";

var async, fs, hopper, path, stderr, stdout, undefined;

function writeTest(file) {
  stdout.write("Test " + file + ": ");
}

function writeSuccess() {
  stdout.write("\x1b[0;32;48mPassed\x1b[0m\n");
}

function writeError(error) {
  stderr.write("\x1b[0;31;48m" + error + "\x1b[0m\n");
}

function runSync(code, callback) {
  try {
    hopper.interpret(code);
    callback(null);
  } catch(error) {
    if (error instanceof Error) {
      writeError(error);
    } else {
      callback(error);
    }
  }
}

function runAsync(code, callback) {
  try {
    hopper.interpret(code, callback);
  } catch(error) {
    writeError(error);
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

      if (i === l) {
        if (typeof completion === "function") {
          completion();
        }

        return;
      }

      file = files[i++];

      if (path.extname(file) === ".grace") {
        fs.readFile(path.join("test/" + dir, file), runTest(file, callback, run));
      }
    }

    if (error !== null) {
      writeError(error.message);
    } else {
      i = 0;
      l = files.length;
      run(0);
    }
  });
}

fs = require("fs");
path = require("path");
hopper = require("../lib/hopper");

stderr = process.stderr;
stdout = process.stdout;

process.on("uncaughtException", function(error) {
  writeError(error);
  async();
});

stdout.write("Executing tests...\n");

runTests("run", function(error) {
  if (error !== null) {
    writeError(error);
  } else {
    writeSuccess();
  }
}, function() {
  runTests("fail", function(error) {
    if (error !== null) {
      writeSuccess();
    } else {
      writeError("Failed (completed without error)");
    }
  });
});

