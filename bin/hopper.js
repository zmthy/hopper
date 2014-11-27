#!/usr/bin/env node

// The entry point for the Node.js command line application.

"use strict";

var fname, hopper, interactive, interpreter,
  loader, options, optparse, path, repl, root, sys, write;

path = require("path");
sys = require("sys");

optparse = require("optparse");

hopper = require("../lib/hopper");
repl = require("./repl");
write = require("./write");

process.on("uncaughtException", function (error) {
  write.writeError(error);
});

fname = null;
interactive = false;
root = null;

options = new optparse.OptionParser([
  [ "-h", "--help", "Display this help text" ],
  [ "-i", "--interactive", "Run in interactive mode" ],
  [ "-r", "--root DIR", "Set the root of the module hierarchy" ],
  [ "-a", "--auto-root", "Use the main module as the root" ]
]);

options.on("help", function () {
  sys.puts(options.toString());
  process.exit(0);
});

options.on("interactive", function () {
  interactive = true;
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
  write.writeError("Option parse error: no such option " + option);
  process.exit(2);
});

options.parse(process.argv);

if (root === true) {
  if (!fname) {
    write
      .writeError("Option parse error: automatic module root without a module");
    process.exit(3);
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
} else {
  interactive = true;
}

if (interactive) {
  interpreter = new hopper.Interpreter(loader);

  if (fname !== null) {
    interpreter.interpret('dialect "' + fname + '"', function (error) {
      if (error !== null) {
        write.writeError(error).then(function () {
          process.exit(1);
        });
      } else {
        repl(interpreter);
      }
    });
  } else {
    repl(interpreter);
  }
} else {
  fname = path.dirname(fname) + path.sep + path.basename(fname, ".grace");
  hopper.load(fname, function (error) {
    if (error !== null) {
      write.writeError(error).then(function () {
        process.exit(1);
      });
    }
  });
}
