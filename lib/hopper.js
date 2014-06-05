// The core module of the library, exposing an interpreter that takes Grace code
// and executes it. It also exposes the constructor for the underlying
// Interpreter object, which allows for the preservation of state between
// multiple executions.
//
// Note that running the interpreter in synchronous mode still requires the
// asynchronous interface, and turning off the asynchronous behaviour is exposed
// mostly for testing purposes.

"use strict";

var fs, interpreter, parser;

interpreter = require("./interpreter");
parser = require("./parser");

function slice(list, from, to) {
  return Array.prototype.slice.call(list, from, to);
}

function parse(text, onError, onResult) {
  var exception, result;

  exception = null;

  try {
    result = parser.parse(text);
  } catch (error) {
    exception = error;
  } finally {
    if (exception !== null) {
      onError(exception);
    } else {
      onResult(result);
    }
  }
}

function defaultLoader(interpreter, path, callback) {
  var relative = "./" + path;

  fs = fs || require("fs");

  fs.readFile(relative + ".grace", function (exists, code) {
    var error, result;

    if (exists === null) {
      interpreter.module(path, code.toString(), callback);
    } else {
      error = null;

      try {
        result = require(relative);
      } catch (problem) {
        error = "Cannot locate module at " + path;
      } finally {
        if (error !== null) {
          callback(error);
        } else {
          callback(null, result);
        }
      }
    }
  });
}

// new Interpreter(asynchronous : Boolean = true,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>)
//   A new interpreter, with internal state preserved between executions.
function Interpreter(asynchronous, moduleLoader) {
  var self = this;

  if (typeof moduleLoader !== "function" &&
      typeof asynchronous === "function") {
    moduleLoader = asynchronous;
    asynchronous = true;
  } else {
    if (asynchronous === undefined) {
      asynchronous = true;
    }

    moduleLoader = moduleLoader || defaultLoader;
  }

  this.interpreter = new interpreter.Interpreter(asynchronous,
    function (path, callback) {
      moduleLoader.apply(null, [self, path, callback]);
    });
}

// interpret(code : String, callback : Callback<Object>)
//   Interpret Grace code with the existing state of this interpreter, returning
//   the result of the final expression.
Interpreter.prototype.interpret = function (code, callback) {
  var terp = this.interpreter;

  parse(code, callback, function (ast) {
    terp.interpret(ast, function () {
      callback.apply(null, arguments);
    });
  });
};

// module(path : Path, code : String, callback : Callback<Object>)
//   Interpret Grace code as a module body and cache it based on the given path
//   so a request for the same module does not occur again.
Interpreter.prototype.module = function (path, code, callback) {
  var terp = this.interpreter;

  parse(code, callback, function (ast) {
    terp.module(path, ast, function () {
      callback.apply(null, arguments);
    });
  });
};

// load(path : Path, callback : Callback<Object>)
//   Run the interpreter module loader on the given path.
Interpreter.prototype.load = function (path, callback) {
  this.interpreter.load(path, function () {
    callback.apply(null, arguments);
  });
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

// interpret(code : String, asynchronous : Boolean = true,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Interpret Grace code standalone.
function interpret() {
  buildAndApply("interpret", arguments, 1);
}

// module(path : Path, code : String, asynchronous : Boolean = true,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Interpret Grace code standalone as a module body and cache it based on the
//   given path so a request for the same module does not occur again.
function module() {
  buildAndApply("module", arguments, 2);
}

// load(path : Path, asynchronous : Boolean = true,
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

