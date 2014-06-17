// The Node.js REPL. Reads in lines of input and spits out the result.

"use strict";

var hopper, readline, runtime, sys, unicode;

readline = require("readline");
sys = require("sys");

hopper = require("../lib/hopper");
runtime = require("../lib/runtime");
unicode = require("../lib/unicode");

function writeError(error) {
  sys.error("\x1b[0;31;48m" + (typeof error === "string" ?
      error : "Internal error: " + error.message) + "\x1b[0m");
}

function writeValue(value) {
  try {
    sys.puts("\x1b[0;32;48m" + value + "\x1b[0m");
  } catch (error) {
    writeError(error);
  }
}

module.exports = function (interpreter) {
  var rl;

  interpreter = interpreter || new hopper.Interpreter();
  interpreter.enter();

  process.stdin.setEncoding("utf8");
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.setPrompt("> ", 2);

  rl.on("line", function (line) {
    if (line.replace(/\s/g, "") !== "") {
      interpreter.interpret(line, function (error, result) {
        if (error !== null) {
          writeError(error);
        } else {
          writeValue(result);
        }

        rl.prompt();
      });
    } else {
      rl.prompt();
    }
  });

  rl.prompt();

  return function () {
    rl.close();
  };
};

