#!/usr/bin/env node

// A simple test harness. Currently consists of ensuring that a set of simple
// examples compile and run without error.

"use strict";

var fs, hopper, path, stderr, stdout;

function writeError(error) {
  stderr.write("\x1b[0;31;48m" + error + "\x1b[0m\n");
}

fs = require("fs");
path = require("path");
hopper = require("../lib/hopper");

stderr = process.stderr;
stdout = process.stdout;

stdout.write("Executing tests...\n");

fs.readdir("test", function(error, files) {
  var file, i, l;

  if (error !== null) {
    writeError(error.message);
  } else {
    for (i = 0, l = files.length; i < l; i++) {
      (function(file) {
        if (path.extname(file) === ".grace") {
          fs.readFile(path.join("test", file), function(error, code) {
            if (error !== null) {
              writeError(error.message);
            } else {
              stdout.write("Test " + path.basename(file, ".grace") + ": ");
              try {
                hopper.interpret(code.toString());
                stdout.write("\x1b[0;32;48mPassed\x1b[0m\n");
              } catch (error) {
                writeError("Failed (" + error + ")")
              }
            }
          });
        }
      })(files[i]);
    }
  }
});

