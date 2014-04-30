// The Node.js REPL. Reads in lines of input and spits out the result.

"use strict";

var hopper, runtime;

hopper = require("../lib/hopper");
runtime = require("../lib/runtime");

var interpreter, stderr, stdin, stdout, undefined;

stderr = process.stderr;
stdin = process.stdin;
stdout = process.stdout;

interpreter = new hopper.Interpreter();

stdin.setEncoding("utf8");
stdout.write("> ");

stdin.on("readable", function() {
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
    interpreter.interpret(line, function(error, result) {
      if (error !== null) {
        stderr.write("\x1b[0;31;48m" + (typeof error === "string" ?
          error : "Internal error: " + error.message) + "\x1b[0m\n");
      } else if (result !== runtime.done) {
        stdout.write("\x1b[0;32;48m" + result.toString() + "\x1b[0m\n");
      }

      stdout.write("> ");
    });
  } else {
    stdout.write("> ");
  }
});

