// The core module of the library, exposing an interpreter that takes Grace code
// and executes it. It also exposes the constructor for the underlying
// Interpreter object, which allows for the preservation of state between
// multiple executions.

"use strict";

var Task, loader, fs, interpreter, parser, rt, util;

Task = require("./task");
util = require("./util");

function slice(list, from, to) {
  return Array.prototype.slice.call(list, from, to);
}

function parse(path, text) {
  return parser.parse(text).then(null, function (error) {
    if (error instanceof parser.ParseError) {
      return rt.ParseError.raise(rt.string(error.message))
        .then(null, function (packet) {
          packet.object.stackTrace.push(rt.trace(null, null, {
            module: path,
            line: error.line,
            column: error.column
          }));

          throw packet;
        });
    }

    return rt.InternalError.raiseFromPrimitiveError(error);
  });
}

// new Interpreter(prelude : Object = <sys>,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>)
//   A new interpreter, with internal state preserved between executions.
function Interpreter(prelude, moduleLoader) {
  var self = this;

  if (arguments.length < 2 && typeof prelude === "function") {
    moduleLoader = prelude;
    prelude = rt.prelude;
  }

  this.prelude = Task.resolve(prelude || rt.prelude);
  moduleLoader = moduleLoader || loader.defaultLoader;

  self.prelude.then(function (prelude) {
    self.interpreter = new interpreter.Interpreter(prelude,
      function (path, callback) {
        moduleLoader.apply(null, [self, path, callback]);
      });
  });
}

// interpret(path : Path = undefined,
//     code : String, callback : Callback<Object>) -> Function<Boolean>
//   Interpret Grace code with the existing state of this interpreter, returning
//   the result of the final expression. Takes an optional module path that will
//   be used to report problems. Returns a function that will attempt to stop
//   the execution when called.
Interpreter.prototype.interpret = function (path, code, callback) {
  var self = this;

  if (typeof code === "function") {
    callback = code;
    code = path;
    path = null;
  }

  return parse(path, code).then(function (ast) {
    return self.prelude.then(function () {
      delete self.interpreter.modulePath;

      if (path !== null) {
        self.interpreter.modulePath = path;
      }

      return self.interpreter.interpret(ast);
    });
  }).callback(callback).stopify();
};

// module(path : Path, code : String,
//     callback : Callback<Object>) -> Function<Boolean>
//   Interpret Grace code as a module body and cache it based on the given path
//   so a request for the same module does not occur again. Returns a function
//   that will attempt to stop the execution when called.
Interpreter.prototype.module = function (path, code, callback) {
  var self = this;

  return parse(path, code).then(function (ast) {
    return self.prelude.then(function () {
      return self.interpreter.module(path, ast);
    });
  }).callback(callback).stopify();
};

// load(path : Path, callback : Callback<Object>) -> Function<Boolean>
//   Run the interpreter module loader on the given path. Returns a function
//   that will attempt to stop the execution when called.
Interpreter.prototype.load = function (path, callback) {
  var self = this;

  return self.prelude.then(function () {
    return self.interpreter.load(path);
  }).callback(callback).stopify();
};

// enter(Callback<Object> = null)
//   Enter into an object scope and stay in that state, passing the newly
//   created self value to the given callback. This is useful for implementing
//   an interactive mode.
Interpreter.prototype.enter = function (callback) {
  var self = this;

  self.prelude.then(function () {
    return self.interpreter.enter();
  }).callback(callback);
};

function buildAndApply(method, args) {
  var built, len, required;

  function Build() {
    Interpreter.apply(this, slice(args, required, len));
  }

  Build.prototype = Interpreter.prototype;

  required = typeof args[1] === "string" ? 2 : 1;

  len = args.length - 1;
  built = new Build();
  return built[method].apply(built,
    slice(args, 0, required).concat([args[len]]));
}

// interpret(path : Path = undefined, code : String, prelude : Object = <sys>,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Interpret Grace code standalone.
function interpret() {
  return buildAndApply("interpret", arguments);
}

// module(path : Path, code : String, prelude : Object = <sys>,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Interpret Grace code standalone as a module body and cache it based on the
//   given path so a request for the same module does not occur again.
function module() {
  return buildAndApply("module", arguments);
}

// load(path : Path, prelude : Object = <sys>,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Run a new interpreter with a module loader on the given path.
function load() {
  return buildAndApply("load", arguments);
}

exports.Interpreter = Interpreter;

exports.interpret = interpret;
exports.module = module;
exports.load = load;

rt = require("./runtime");
interpreter = require("./interpreter");
parser = require("./parser");

loader = require("./loader");

exports.Task = Task;
exports.runtime = rt;
exports.defaultLoader = loader.defaultLoader;
exports.prelude = rt.prelude;

exports.parse = Task.callbackify(parser.parse);

util.extend(exports, parser);

