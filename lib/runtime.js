// Runtime definitions that are independent of an Interpreter instance.

"use strict";

var Task, defs, util;

Task = require("./task");
util = require("./util");

function lookup(receiver, pretty) {
  var l, method, name, ours;

  name = util.uglify(pretty);
  method = receiver[name];
  ours = defs.isGraceObject(receiver);

  // This is a normal object, so it needs to mimic a Grace object.
  // Function properties are considered the same as methods, and cannot
  // be assigned to.
  if (!ours && typeof method !== "function") {
    if (name === "asString") {
      method = receiver.toString;

      if (method === Object.prototype.toString) {
        method = defs.base.asString;
      }
    } else {
      l = name.length - 3;
      if (name.substring(l) === " :=") {
        name = name.substring(0, l);

        if (typeof receiver[name] !== "function") {
          method = function (args) {
            receiver[name] = args[0];
          };
        }
      } else {
        method = receiver[name];

        if (method !== "undefined") {
          if (typeof method !== "function") {
            method = function () {
              return receiver[name];
            };
          }
        } else {
          method = defs.base[name];
        }
      }
    }
  }

  if (typeof method !== "function" ||
      (ours && method === Object.prototype[name]) ||
          (typeof method === "function" && method.internal)) {
    return defs.UnresolvedRequest
      .raiseForName_inObject([defs.string(pretty)], [receiver]);
  }

  return Task.resolve(method);
}

function handleInternalError(error) {
  if (!defs.isGraceExceptionPacket(error)) {
    return defs.InternalError.raiseFromPrimitiveError(error);
  }

  throw error;
}

// Asynchronous method application that works for either synchronous or
// asynchronous methods.
function apply(receiver, method, args) {
  var run, task;

  if (typeof method === "string") {
    return lookup(receiver, method).then(function (method) {
      return apply(receiver, method, args);
    });
  }

  if (arguments.length < 3) {
    args = [[]];
  }

  if (!method.takesParts) {
    args = args[0];
  }

  task = new Task(function (resolve, reject) {
    run = util.once(function (force) {
      var result;

      delete task.deferred;

      try {
        result = method.apply(receiver, args);
      } catch (reason) {
        return reject(reason);
      }

      Task.resolve(result)[force ? "now" : "then"](resolve, reject);
    });
  });

  task.deferred = run;
  setImmediate(run);

  return task.then(null, handleInternalError);
}

// Asynchronous inherits method application that works for either synchronous or
// asynchronous methods. The call throws if the method cannot be inherited from.
function inherit(inheriting, method, args) {
  if (typeof method.inherit !== "function") {
    return defs.InvalidInherits.raiseForName(defs.string(method.identifier));
  }

  return apply(inheriting, method.inherit, args);
}

function part(generics, args) {
  args.generics = generics;
  return args;
}

// gte(count : Number) -> GTE
//   Represents a minimum number of parameters.
function gte(count) {
  return { minimum: count };
}

function trace(name, object, location) {
  return {
    name: name,
    object: object,
    location: location || null
  };
}

// method(name : String,
//     parameters : Count = gte(0), func : Function) -> Function
//   Create a single part method of a certain parameter count.
//
// method(name : String,
//     parts : [Count | (generics : Number, parameters : Count = gte(0))],
//     func : Function) -> Function
//   Create an anypart method where each part has a certain generic count and
//   parameter count.
//
// where Count = Number | GTE
function method(name, partCounts, func) {
  var body, i, isGeneric, isMulti, partCount, partsLength;

  if (arguments.length < 3) {
    func = partCounts;
    partCounts = [gte(0)];
  }

  if (partCounts === null || !util.isArray(partCounts)) {
    partCounts = [partCounts];
  }

  partsLength = partCounts.length;
  isMulti = partCounts.length > 1;
  isGeneric = false;

  for (i = 0; i < partsLength; i += 1) {
    partCount = partCounts[i];

    if (util.isArray(partCount)) {
      if (partCount.length === 1) {
        partCount[1] = gte(0);
      }
    } else {
      partCounts[i] = [0, partCount];
    }

    if (partCount[0] > 0) {
      isGeneric = true;
    }
  }

  body = function () {
    var argParts, argsLength, self;

    argsLength = arguments.length;
    argParts = util.slice(arguments);
    self = this;

    if (partCounts.length === 1 && !util.isArray(argParts[0])) {
      argsLength = 1;
      argParts = [argParts];
    }

    // The next two errors can't be caused by the interpreter without an
    // incorrect method definition in JavaScript.

    if (argsLength < partsLength) {
      throw new TypeError('Not enough parts for method "' + name + '"');
    }

    if (argsLength > partsLength) {
      throw new TypeError('Too many parts for method "' + name + '"');
    }

    return Task.each(partCounts, argParts, function (partCount, argPart) {
      if ((typeof partCount[1] === "number" && argPart.length < partCount[1]) ||
          argPart.length < partCount[1].minimum) {
        return defs.InvalidRequest
          .raiseNotEnoughArgumentsForMethod(defs.string(name));
      }

      if (typeof partCount[1] === "number" && argPart.length > partCount[1]) {
        return defs.InvalidRequest
          .raiseTooManyArgumentsForMethod(defs.string(name));
      }

      if (util.isArray(argPart.generics) && argPart.generics.length !== 0) {
        if (argPart.generics.length < partCount[0]) {
          return defs.InvalidRequest
            .raiseNotEnoughGenericArgumentsForMethod(defs.string(name));
        }

        if (argPart.generics.length > partCount[0]) {
          return defs.InvalidRequest
            .raiseTooManyGenericArgumentsForMethod(defs.string(name));
        }

        return Task.each(argPart.generics, function (generic) {
          return defs.Pattern.assert(generic);
        }).then(function () {
          return argPart.generics.concat(argPart);
        });
      }

      if (isGeneric) {
        // No generics given in the request. Default to Unknown.
        return util.replicate(partCount[0], defs.Unknown).concat(argPart);
      }

      return argPart;
    }).then(function (argParts) {
      if (!isMulti) {
        argParts = argParts[0];
      }

      return func.apply(self, argParts);
    }).then(null, handleInternalError).then(null, function (packet) {
      if (!body.isUntraced) {
        packet.object.stackTrace.push(trace(name, self));
      }

      throw packet;
    });
  };

  body.identifier = name;
  body.isAsynchronous = true;

  body.toString = function () {
    return "«" + name + "»";
  };

  // This has to be true even if the method doesn't accept generic parameters to
  // ensure that it correctly reports that generics should not be passed.
  body.takesParts = true;

  return body;
}

// constructor(name : String,
//     parameters : Count = gte(0), func : Function) -> Function
//   Create a single part class of a certain parameter count.
//
// constructor(name : String,
//     parts : [Count | (generics : Number, parameters : Count = gte(0))],
//     func : Function) -> Function
//   Create an anypart constructor where each part has a certain generic count
//   and parameter count.
//
// where Count = Number | GTE
function constructor() {
  var body = method.apply(this, arguments);

  body.inherit = body;

  return body;
}

// block(parameters : Count = gte(0), apply : Function) -> Object
//   Construct a block with an apply method of a certain parameter count.
//
// block((generics : Number, parameters : Count = gte(0)),
//     apply : Function) -> Object
//   Construct a block with a generic apply method of a certain generic count
//   and parameter count.
//
// where Count = Number | GTE
function block(parameters, apply) {
  var paramCount, object;

  paramCount = typeof parameters === "number" ? parameters : parameters[1];
  object = defs.object();

  object.apply =
    method("apply" + (paramCount === 0 ? "" : "()"), [parameters], apply);

  object.asString = method("asString", 0, function () {
    return defs.string("block/" + paramCount);
  });

  return object;
}

exports.lookup = lookup;
exports.handleInternalError = handleInternalError;
exports.apply = apply;
exports.inherit = inherit;
exports.part = part;
exports.gte = gte;
exports.trace = trace;
exports.method = method;
exports.constructor = constructor;
exports.block = block;

defs = require("./runtime/definitions");

util.extend(exports, defs);

