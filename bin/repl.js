// The Node.js REPL. Reads in lines of input and spits out the result.

"use strict";

var hopper, stderr, stdin, stdout, runtime, undefined;

function asString(object) {
  if (object.toString === Object.prototype.toString) {
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

hopper = require("../lib/hopper");
runtime = require("../lib/runtime");

stderr = process.stderr;
stdin = process.stdin;
stdout = process.stdout;

stdin.setEncoding("utf8");

module.exports = function(async) {
  var interpreter = new hopper.Interpreter(async);

  stdout.write("> ");

  function loop() {
    var chunk, line, result;

    if ((chunk = stdin.read()) === null) {
      return;
    }

    line = "";

    while (chunk !== null) {
      line += chunk;

      chunk = stdin.read();
    }

    if (line.replace(/\s/g, "") !== "") {
      if (async) {
        interpreter.interpret(line, function(error, result) {
          if (error !== null) {
            writeError(error);
          } else {
            writeValue(result);
          }

          stdout.write("> ");
        });
      } else {
        try {
          writeValue(interpreter.interpret(line));
        } catch(error) {
          writeError(error);
        }
      }
    }

    if (!async) {
      stdout.write("> ");
    }
  }

  stdin.on("readable", loop);

  return function () {
    stdin.removeListener("readable", loop);
  };
};

