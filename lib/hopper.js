// The core module of the library, exposing an interpreter that takes Grace code
// and executes it. It also exposes the constructor for the underlying
// Interpreter object, which allows for the preservation of state between
// multiple executions.
//
// Note that running the interpreter in synchronous mode still requires the
// asynchronous interface, and turning off the asynchronous behaviour is exposed
// mostly for testing purposes.

"use strict";

var Task, fs, interpreter, parser, rt;

Task = require("./task");
interpreter = require("./interpreter");
parser = require("./parser");
rt = require("./runtime");

function slice(list, from, to) {
  return Array.prototype.slice.call(list, from, to);
}

function parse(text, onError, onResult) {
  var result;

  try {
    result = parser.parse(text);
  } catch (error) {
    if (typeof error === "string") {
      rt.ParseError.raiseMessage(rt.string(error)).then(null, onError);
    } else {
      onError(error);
    }

    return;
  }

  onResult(result);
}

function defaultLoader(interpreter, path, callback) {
  var relative = "./" + path;

  fs = fs || require("fs");

  fs.readFile(relative + ".grace", function (exists, code) {
    var result;

    if (exists === null) {
      interpreter.module(path, code.toString(), callback);
    } else {
      try {
        result = require(relative);
      } catch (problem) {
        rt.UnresolvedModule.raiseForPath(rt.string(path)).then(null, callback);
        return;
      }

      callback(null, result);
    }
  });
}

// new Interpreter
//     (moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>)
//   A new interpreter, with internal state preserved between executions.
function Interpreter(moduleLoader) {
  var self = this;

  moduleLoader = moduleLoader || defaultLoader;

  this.interpreter = new interpreter.Interpreter(function (path, callback) {
    moduleLoader.apply(null, [self, path, callback]);
  });
}

// interpret(code : String, callback : Callback<Object>)
//   Interpret Grace code with the existing state of this interpreter, returning
//   the result of the final expression.
Interpreter.prototype.interpret = function (code, callback) {
  var terp = this.interpreter;

  parse(code, callback, function (ast) {
    return terp.interpret(ast).callback(callback);
  });
};

// module(path : Path, code : String, callback : Callback<Object>)
//   Interpret Grace code as a module body and cache it based on the given path
//   so a request for the same module does not occur again.
Interpreter.prototype.module = function (path, code, callback) {
  var terp = this.interpreter;

  parse(code, callback, function (ast) {
    return terp.module(path, ast).callback(callback);
  });
};

// load(path : Path, callback : Callback<Object>)
//   Run the interpreter module loader on the given path.
Interpreter.prototype.load = function (path, callback) {
  this.interpreter.load(path).callback(callback);
};

// enter() : Object
//   Enter into an object scope and stay in that state, returning the newly
//   created self value. This is useful for an interactive mode.
Interpreter.prototype.enter = function () {
  this.interpreter.enter();
};

function buildAndApply(method, args, required) {
  var built, len;

  function Build() {
    Interpreter.apply(this, slice(args, required, len));
  }

  Build.prototype = Interpreter.prototype;

  len = args.length - 1;
  built = new Build();
  built[method].apply(built, slice(args, 0, required).concat([args[len]]));
}

// interpret(code : String,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Interpret Grace code standalone.
function interpret() {
  buildAndApply("interpret", arguments, 1);
}

// module(path : Path, code : String,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Interpret Grace code standalone as a module body and cache it based on the
//   given path so a request for the same module does not occur again.
function module() {
  buildAndApply("module", arguments, 2);
}

// load(path : Path,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Run a new interpreter with a module loader on the given path.
function load() {
  buildAndApply("load", arguments, 1);
}

exports.Interpreter = Interpreter;

exports.interpret = interpret;
exports.module = module;
exports.load = load;

exports.defaultLoader = defaultLoader;

