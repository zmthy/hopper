#!/usr/bin/env node

// The entry point for the Node.js command line application.

"use strict";

var async, argv, fname, fs, hopper, offset, stderr, undefined;

function writeError(error) {
  stderr.write("\x1b[0;31;48m" + error + "\x1b[0m\n");
}

argv = process.argv;
stderr = process.stderr;

offset = argv[0] === "node" ? 1 : 0;
fname = argv[1 + offset];

if (fname[0] === "-") {
  if (fname === "-a" || fname === "--async") {
    async = true;
    fname = argv[2 + offset];
  } else {
    throw "Unrecognised flag " + fname;
  }
}

if (fname === undefined) {
  require("./repl");
} else {
  fs = require("fs");
  hopper = require("../lib/hopper");

  fs.readFile(fname, { encoding: "utf8" }, function(error, code) {
    if (error !== null) {
      writeError(error.message);
    } else {
      if (async) {
        hopper.interpret(code, function(error) {
          if (error !== null) {
            writeError(error);
          }
        });
      } else {
        try {
          hopper.interpret(code);
        } catch(error) {
          writeError(error);
        }
      }
    }
  });
}

