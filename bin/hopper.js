#!/usr/bin/env node

// The entry point for the Node.js command line application.

"use strict";

var fname, hopper, interactive, interpreter,
  loader, options, optparse, path, repl, root, sys;

path = require("path");
sys = require("sys");

optparse = require("optparse");

hopper = require("../lib/hopper");
repl = require("./repl");

function writeError(error) {
  sys.error("\x1b[0;31;48m" + error + "\x1b[0m");
}

process.on('uncaughtException', function (error) {
  writeError(error);
});

fname = null;
interactive = false;
root = null;

options = new optparse.OptionParser([
  ["-h", "--help", "Display this help text"],
  ["-r", "--root DIR", "Set the root of the module hierarchy"],
  ["-a", "--auto-root", "Use the main module as the root"]
]);

options.on("help", function () {
  sys.puts(options.toString());
  process.exit(0);
});

options.on("root", function (dir) {
  root = dir;
});

options.on("auto-root", function () {
  root = true;
});

options.on(2, function (file) {
  fname = file;
});

options.on(function (option) {
  writeError("Option parse error: no such option " + option);
  process.exit(1);
});

options.parse(process.argv);

if (root === true) {
  if (!fname) {
    writeError("Option parse error: automatic module root without a module");
    process.exit(2);
  }

  root = path.dirname(fname);
}

if (root !== null) {
  if (fname !== null) {
    fname = path.relative(root, fname);
  }

  loader = function (interpreter, file, callback) {
    hopper.defaultLoader(interpreter, path.join(root, file), callback);
  };
} else {
  loader = hopper.defaultLoader;
}

if (fname !== null) {
  fname = path.dirname(fname) + path.sep + path.basename(fname, ".grace");
  hopper.load(fname, loader, function (error) {
    if (error !== null) {
      writeError(error);
    }
  });
} else {
  repl();
}

