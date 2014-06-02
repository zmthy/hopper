// The core module of the library, exposing an interpreter that takes Grace code
// and executes it. It also exposes the constructor for the underlying
// Interpreter object, which allows for the preservation of state between
// multiple executions.

"use strict";

var interpreter, parser;

interpreter = require("./interpreter");
parser = require("./parser");

function parse(code) {
  return parser.parse(code);
}

function runInterpreter(interpreter, code, callback) {
  try {
    return interpreter.interpret(parse(code), callback);
  } catch (error) {
    if (callback !== undefined) {
      callback(error);
    } else {
      throw error;
    }
  }
}

// interpret(code : String, callback : Function<Error, Object> = null)
//   Interpret Grace code standalone. Leaving off a callback will cause the
//   whole interpreter to run synchronously.
function interpret(code, callback) {
  runInterpreter(interpreter, code, callback);
}

// new Interpreter(asynchronous : Boolean = true)
//   A new interpreter, with internal state preserved between executions.
function Interpreter(asynchronous) {
  this.interpreter = new interpreter.Interpreter(asynchronous);
}

// interpret(code : String, callback : Function<Error, Object>)
//   Interpret Grace code with the existing state of this interpreter. The
//   callback is required if this interpreter is asynchronous.
Interpreter.prototype.interpret = function (code, callback) {
  return runInterpreter(this.interpreter, code, callback);
};

exports.interpret = interpret;
exports.Interpreter = Interpreter;

