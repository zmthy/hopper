// The core module of the library, exposing an interpreter that takes Grace code
// and executes it. It also exposes the constructor for the underlying
// Interpreter object, which allows for the preservation of state between
// multiple executions.

"use strict";

var interpreter, loader, parser, rt, task, util;

parser = require("./parser");
task = require("./task");
util = require("./util");

function parseAndHandle(text, path) {
  return parser.parse(text, path).then(null, (error) => {
    if (error instanceof parser.ParseError) {
      return rt.ParseFailure.raise(rt.string(error.message))
        .then(null, (packet) => {
          packet.object.stackTrace = [
            rt.trace(null, null, {
              "module": path,
              "line": error.line,
              "column": error.column
            })
          ];

          throw packet;
        });
    }

    return rt.InternalError.raiseFromPrimitiveError(error);
  });
}

function CheckResult(isSuccess, name, result, stackTrace) {
  this.isSuccess = isSuccess;
  this.name = name;

  if (isSuccess) {
    this.value = result;
  } else {
    this.message = result;
    this.stackTrace = stackTrace || null;
  }
}

CheckResult.prototype.toString = function () {
  return this.name + (this.message ? ": " + this.message : "");
};

// new Interpreter(preludeGen : Promise<Object> | Object = <sys>,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>)
//   A new interpreter, with internal state preserved between executions. The
//   prelude generator may either be a task to build the prelude object, or just
//   the object itself.
function Interpreter(preludeGen, moduleLoader) {
  if (moduleLoader === undefined && typeof preludeGen === "function") {
    moduleLoader = preludeGen;
    preludeGen = rt.prelude;
  }

  this.prelude = Promise.resolve(preludeGen || rt.prelude);
  moduleLoader = moduleLoader || loader.defaultLoader;

  this.prelude.then((prelude) => {
    this.interpreter = new interpreter.Interpreter(prelude,
      (path, callback) => {
        moduleLoader.apply(null, [this, path, callback]);
      });
  });
}

function makeInterpret(method, optionalPath, parse, onSuccess, onFailure) {
  return function (path, code, callback) {
    var next, promise;

    if (optionalPath && typeof code !== "string") {
      callback = code;
      code = path;
      path = null;
    }

    next = (ast) => {
      return this.prelude.then(() => {
        delete this.interpreter.modulePath;

        if (path !== null) {
          this.interpreter.modulePath = path;
        }

        return this.interpreter[method](ast, path);
      });
    };

    promise = (util.isArray(code) ? next(code) : parse(code, path).then(next))
      .then(onSuccess || null, onFailure || null);

    task.callback(promise, callback);

    return function () {
      self.interpreter.stop();
    };
  };
}

// interpret(path : Path = undefined,
//     code : String, callback : Callback<Object>) -> Function
//   Interpret Grace code with the existing state of this interpreter, returning
//   the result of the final expression. Takes an optional module path that will
//   be used to report problems. Returns a function that will attempt to stop
//   the execution when called.
Interpreter.prototype.interpret =
  makeInterpret("interpret", true, parseAndHandle);

// check(path : Path = undefined,
//     code : String, callback : Callback<StaticError>) -> Function
//   Parse and check the given code, returning an object with information about
//   the problem if the code fails to parse or fails its check. Takes an
//   optional module path that will be used to report problems. Returns a
//   function that will attempt to stop the execution when called.
Interpreter.prototype.check =
  makeInterpret("check", true, parser.parse, function (result) {
    if (util.isArray(result)) {
      return new CheckResult(true, "Success", result);
    }

    return result.message().then((message) => {
      return message.asPrimitiveString();
    }).then((message) => {
      return new CheckResult(false,
        "Checker Failure", message, result.object.stackTrace);
    });
  }, function (packet) {
    if (packet instanceof parser.ParseError) {
      return new CheckResult(false, "Parse Failure", packet.message, [packet]);
    }

    throw packet;
  });

// module(path : Path, code : String,
//     callback : Callback<Object>) -> Function
//   Interpret Grace code as a module body and cache it based on the given path
//   so a request for the same module does not occur again. Returns a function
//   that will attempt to stop the execution when called.
Interpreter.prototype.module =
  makeInterpret("module", false, parseAndHandle);

// load(path : Path, callback : Callback<Object>) -> Function
//   Run the interpreter module loader on the given path. Returns a function
//   that will attempt to stop the execution when called.
Interpreter.prototype.load = function (path, callback) {
  task.callback(this.prelude.then(() => {
    return this.interpreter.load(path);
  }), callback);

  return function () {
    self.stop();
  };
};

// enter(Callback<Object> = null)
//   Enter into an object scope and stay in that state, passing the newly
//   created self value to the given callback. This is useful for implementing
//   an interactive mode.
Interpreter.prototype.enter = function (callback) {
  task.callback(this.prelude.then(() => {
    return this.interpreter.enter();
  }), callback);
};

function buildAndApply(method, args) {
  var built, len, required;

  function Build() {
    Interpreter.apply(this, util.slice(args, required, len));
  }

  Build.prototype = Interpreter.prototype;

  required = typeof args[1] === "string" || util.isArray(args[1]) ? 2 : 1;

  len = args.length - 1;
  built = new Build();
  return built[method].apply(built,
    util.slice(args, 0, required).concat([args[len]]));
}

exports.CheckResult = CheckResult;
exports.Interpreter = Interpreter;

// interpret(path : Path = undefined, code : String, prelude : Object = <sys>,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Interpret Grace code standalone.
exports.interpret = function () {
  return buildAndApply("interpret", arguments);
};

// check(path : Path = undefined, code : String, prelude : Object = <sys>,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Check Grace code standalone.
exports.check = function () {
  return buildAndApply("check", arguments);
};

// module(path : Path, code : String, prelude : Object = <sys>,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Interpret Grace code standalone as a module body and cache it based on the
//   given path so a request for the same module does not occur again.
exports.module = function () {
  return buildAndApply("module", arguments);
};

// load(path : Path, prelude : Object = <sys>,
//     moduleLoader : Function<Interpreter, Path, Callback<Object>> = <fs>,
//     callback : Callback<Object>)
//   Run a new interpreter with a module loader on the given path.
exports.load = function () {
  return buildAndApply("load", arguments);
};

rt = require("./runtime");
interpreter = require("./interpreter");

loader = require("./loader");

exports.runtime = rt;
exports.defaultLoader = loader.defaultLoader;
exports.prelude = rt.prelude;

util.extend(exports, parser);
