// The Node.js REPL. Reads in lines of input and spits out the result.

"use strict";

var hopper, readline, unicode, write;

readline = require("readline");

hopper = require("../lib/hopper");
unicode = require("../lib/unicode");
write = require("./write");

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
          write.writeError(error).callback(function () {
            rl.prompt();
          });
        } else {
          write.writeValue(result).callback(function () {
            rl.prompt();
          });
        }
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

