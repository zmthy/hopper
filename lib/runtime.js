// Runtime definitions that are independent of an Interpreter instance.

"use strict";

var Task, defs, util;

Task = require("./task");
util = require("./util");

function trace(name, object, location) {
  return {
    name: name,
    object: object,
    location: location || null
  };
}

// gte(count : Number) -> GTE
//   Represents a minimum number of parameters.
function gte(count) {
  return { minimum: count };
}

function part(generics, args) {
  args.generics = generics;
  return args;
}

function handleInternalError(error) {
  if (!defs.isGraceExceptionPacket(error)) {
    return defs.InternalError.raiseFromPrimitiveError(error);
  }

  throw error;
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
    }).then(function (value) {
      if (value === null || value === undefined) {
        return defs.InternalError.raise(defs
          .string("Method " + body + " returned an undefined value"));
      }

      return value;
    }, handleInternalError).then(null, function (packet) {
      packet.object.stackTrace.push(trace(name, self));

      throw packet;
    });
  };

  body.isGraceMethod = true;
  body.identifier = name;
  body.isAsynchronous = true;
  body.parts = partCounts;

  body.toString = function () {
    return "«" + name + "»";
  };

  return body;
}

// inheritor(name : String,
//     parameters : Count = gte(0), func : Function) -> Function
//   Create a single part inheritor of a certain parameter count.
//
// inheritor(name : String,
//     parts : [Count | (generics : Number, parameters : Count = gte(0))],
//     func : Function) -> Function
//   Create an anypart inheritor where each part has a certain generic count and
//   parameter count.
//
// where Count = Number | GTE
function inheritor(name, parts, func) {
  return method(name, [1].concat(parts), function (inheriting) {
    var args = util.slice(arguments, 1);

    if (typeof parts.length !== "number" || parts.length < 2) {
      args = args[0];
    }

    return func.apply(this, [inheriting[0]].concat(args));
  });
}

// constructor(name : String,
//     parameters : Count = gte(0), func : Function) -> Function
//   Create a single part constructor of a certain parameter count.
//
// constructor(name : String,
//     parts : [Count | (generics : Number, parameters : Count = gte(0))],
//     func : Function) -> Function
//   Create an anypart constructor where each part has a certain generic count
//   and parameter count.
//
// where Count = Number | GTE
function constructor(name, parts, func) {
  var body = method(name, parts, function () {
    return func.apply(this, [null].concat(util.slice(arguments)));
  });

  body.inherit = inheritor(name, parts, func);

  return body;
}

function asPrimitive(object) {
  return Task.resolve(typeof object.asPrimitive === "function" ?
      object.asPrimitive() : object);
}

function fromPrimitive(value) {
  if (typeof value === "boolean") {
    return defs.boolean(value);
  }

  if (typeof value === "number") {
    return defs.number(value);
  }

  if (typeof value === "string") {
    return defs.string(value);
  }

  if (typeof value === "function") {
    return defs.block(value);
  }

  if (value === undefined || value === null) {
    return defs.done;
  }

  return value;
}

function lookup(receiver, pretty, fromSelf) {
  var func, l, name, object, orig, ours, type;

  name = util.uglify(pretty);
  func = receiver[name];
  ours = defs.isGraceObject(receiver);

  // This is a normal object, so it needs to mimic a Grace object.
  // Function properties are considered the same as methods, and cannot
  // be assigned to.
  if (!ours) {
    if (typeof func === "function") {
      if (!func.isGraceMethod) {
        orig = func;
        func = method(pretty, function () {
          var self = this;

          return Task.each(util.slice(arguments), asPrimitive)
            .then(function (args) {
              return orig.apply(self, args);
            }).then(fromPrimitive);
        });
      }
    } else if (name === "asString") {
      // Use the regular toString in place of asString.
      func = method("asString", 0, function () {
        return defs.string(this.toString());
      });
    } else {
      l = name.length - 2;
      if (name.substring(l) === ":=") {
        name = name.substring(0, l);

        if (typeof receiver[name] !== "function") {
          // Produce a setter.
          func = method(pretty, 1, function (value) {
            return asPrimitive(value).then(function (value) {
              receiver[name] = value;
              return defs.done;
            });
          });
        }
      } else {
        func = receiver[name];

        if (func === undefined) {
          type = typeof receiver;

          if (type === "object" && util.isArray(receiver)) {
            type = "sequence";
          }

          if (type !== "object") {
            object = defs[type](receiver);
            orig = object[name];

            if (typeof orig === "function") {
              func = method(orig.identifer, orig.parts, function () {
                return orig.apply(object, arguments).then(fromPrimitive);
              });
            }
          }

          func = func || defs.base[name];
        } else if (func !== null) {
          if (typeof func !== "function") {
            // Produce a getter. We use name here because there must not be
            // parentheses on the method.
            func = method(name, 0, function () {
              return fromPrimitive(receiver[name]);
            });
          }
        }
      }
    }
  }

  if (typeof func !== "function" ||
      (ours && func === Object.prototype[name]) ||
          (typeof func === "function" && func.internal)) {
    return defs.UnresolvedRequest
      .raiseForName_inObject([defs.string(pretty)], [receiver]);
  }

  if (!fromSelf && func.isConfidential) {
    return defs.UnresolvedRequest
      .raiseConfidentialForName_inObject([defs.string(pretty)], [receiver]);
  }

  return Task.resolve(func);
}

// Asynchronous method application that works for either synchronous or
// asynchronous methods.
function apply(receiver, method, args) {
  if (typeof method === "string") {
    return lookup(receiver, method).then(function (method) {
      return apply(receiver, method, args);
    });
  }

  if (arguments.length < 3) {
    args = [[]];
  }

  try {
    return Task.resolve(method.apply(receiver, args))
      .then(null, handleInternalError);
  } catch (reason) {
    return Task.reject(reason);
  }
}

// Asynchronous inherits method application that works for either synchronous or
// asynchronous methods. The call throws if the method cannot be inherited from.
function inherit(receiver, method, inheriting, args) {
  if (typeof method === "string") {
    return lookup(receiver, method).then(function (method) {
      return inherit(receiver, method, inheriting, args);
    });
  }

  if (typeof method.inherit !== "function") {
    return defs.InvalidInherits.raiseForName(defs.string(method.identifier));
  }

  if (arguments.length < 4) {
    args = [[]];
  }

  return apply(receiver, method.inherit, [[inheriting]].concat(args));
}

exports.lookup = lookup;
exports.handleInternalError = handleInternalError;
exports.apply = apply;
exports.inherit = inherit;
exports.part = part;
exports.gte = gte;
exports.trace = trace;
exports.method = method;
exports.inheritor = inheritor;
exports.constructor = constructor;

defs = require("./runtime/definitions");

util.extend(exports, defs);

exports.primitives = require("./runtime/primitives");

exports.prelude = require("./runtime/prelude");

