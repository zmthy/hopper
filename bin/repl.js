// The Node.js REPL. Reads in lines of input and spits out the result.

"use strict";

var hopper, readline, rt, write;

readline = require("readline");

hopper = require("../lib/hopper");
write = require("./write");

rt = hopper.runtime;

module.exports = function (interpreter) {
  var rl;

  interpreter = interpreter || new hopper.Interpreter();
  interpreter.enter(function (error, result) {
    if (error !== null) {
      write.writeError(error);
    } else {
      result.asString = hopper.runtime.method("asString", 0, function () {
        return rt.string("repl");
      });
    }
  });

  process.stdin.setEncoding("utf8");
  rl = readline.createInterface({
    "input": process.stdin,
    "output": process.stdout
  });

  rl.setPrompt("> ", 2);

  rl.on("line", function (line) {
    if (line.replace(/\s/g, "") !== "") {
      interpreter.interpret("repl", line, function (error, result) {
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
