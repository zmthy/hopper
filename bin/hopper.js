#!/usr/bin/env node

// The entry point for the Node.js command line application.

"use strict";

var argv, fname, fs, hopper, stderr;

function writeError(error) {
  stderr.write("\x1b[0;31;48m" + error + "\x1b[0m\n");
}

argv = process.argv;
stderr = process.stderr;

fname = argv[argv[0] == "node" ? 2 : 1];

if (fname === undefined) {
  require("./repl");
} else {
  fs = require("fs");
  hopper = require("../lib/hopper");

  fs.readFile(fname, { encoding: "utf8" }, function(error, code) {
    if (error !== null) {
      writeError(error.message);
    } else {
      hopper.interpret(code, function(error) {
        if (error !== null) {
          writeError(error);
        }
      });
    }
  });
}

