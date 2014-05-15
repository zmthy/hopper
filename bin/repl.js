// The Node.js REPL. Reads in lines of input and spits out the result.

"use strict";

var hopper, stderr, stdin, stdout, readline, runtime, unicode, undefined;

readline = require("readline");

hopper = require("../lib/hopper");
runtime = require("../lib/runtime");
unicode = require("../lib/unicode");

function asString(object) {
  if (object instanceof runtime.String) {
    return "\"" + unicode.escape(object.toString()) + "\"";
  } else if (object.toString === Object.prototype.toString) {
    return runtime.Object.prototype.toString.call(object);
  } else {
    return object.toString();
  }
}

function writeValue(value) {
  stdout.write("\x1b[0;32;48m" + asString(value) + "\x1b[0m\n");
}

function writeError(error) {
  stderr.write("\x1b[0;31;48m" + (typeof error === "string" ?
    error : "Internal error: " + error.message) + "\x1b[0m\n");
}

stderr = process.stderr;
stdin = process.stdin;
stdout = process.stdout;

stdin.setEncoding("utf8");

module.exports = function(async) {
  var interpreter, rl;

  interpreter = new hopper.Interpreter(async);

  rl = readline.createInterface({
    input: stdin,
    output: stdout,
  });

  rl.setPrompt("> ", 2);

  rl.on("line", function(line) {
    if (line.replace(/\s/g, "") !== "") {
      if (async) {
        interpreter.interpret(line, function(error, result) {
          if (error !== null) {
            writeError(error);
          } else {
            writeValue(result);
          }

          rl.prompt();
        });
      } else {
        try {
          writeValue(interpreter.interpret(line));
        } catch(error) {
          writeError(error);
        } finally {
          rl.prompt();
        }
      }
    } else {
      rl.prompt();
    }
  });

  rl.prompt();

  return function() {
    rl.close();
  };
};

