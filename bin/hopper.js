#!/usr/bin/env node

// The entry point for the Node.js command line application.

"use strict";

var check, compile, fname, fs, hopper, interactive,
  interpreter, loader, options, optparse, path, repl, root, write;

fs = require("fs");
path = require("path");

optparse = require("optparse");

hopper = require("../lib/hopper");
repl = require("./repl");
write = require("./write");

process.on("uncaughtException", function (error) {
  write.writeError(error);
});

fname = null;
check = false;
compile = false;
interactive = false;
root = null;

options = new optparse.OptionParser([
  ["-h", "--help", "Display this help text"],
  ["-t", "--check", "Check the program without running it"],
  ["-c", "--compile", "Compile the program without running it"],
  ["-i", "--interactive", "Run in interactive mode"],
  ["-r", "--root DIR", "Set the root of the module hierarchy"],
  ["-a", "--auto-root", "Use the main module as the root"]
]);

options.on("help", function () {
  console.log(options.toString());
  process.exit(0);
});

options.on("check", function () {
  check = true;
});

options.on("compile", function () {
  compile = true;
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

  loader = function (terp, file, callback) {
    hopper.defaultLoader(terp, path.join(root, file), callback);
  };
} else {
  loader = hopper.defaultLoader;
}

if (fname !== null) {
  fname = path.dirname(fname) + path.sep + path.basename(fname, ".grace");
} else {
  interactive = true;
}

function writeAndExit(reason) {
  write.writeError(reason).then(function () {
    process.exit(1);
  });
}

function writeAndExitOnError(callback) {
  return function (reason, result) {
    if (reason !== null) {
      writeAndExitOnError(reason);
    } else {
      callback && callback(result);
    }
  };
}

if (check) {
  interpreter = new hopper.Interpreter(loader);

  fs.readFile(fname + ".grace", writeAndExitOnError(function (code) {
    fname = path.basename(fname, ".grace");
    hopper.check(fname, code.toString(), writeAndExitOnError(function (result) {
      if (!result.isSuccess) {
        writeAndExit(result);
      }
    }));
  }));
} else if (compile) {
  fs.readFile(fname + ".grace", writeAndExitOnError(function (code) {
    hopper.compile(fname, code.toString(), writeAndExitOnError(function (text) {
      console.log(text);
    }));
  }));
} else if (interactive) {
  interpreter = new hopper.Interpreter(loader);

  if (fname !== null) {
    interpreter.interpret('dialect "' + fname + '"', writeAndExitOnError(function () {
      repl(interpreter);
    }));
  } else {
    repl(interpreter);
  }
} else {
  fname = path.dirname(fname) + path.sep + path.basename(fname, ".grace");
  hopper.load(fname, writeAndExitOnError());
}
