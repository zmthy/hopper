// Runtime definitions that are independent of an Interpreter instance.

"use strict";

var Task, defs, util;

Task = require("./task");
util = require("./util");

function trace(name, object, location) {
  return {
    "name": name,
    "object": object,
    "location": location || null
  };
}

// gte(count : Number) -> GTE
//   Represents a minimum number of parameters.
function gte(count) {
  return {
    "minimum": count
  };
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
  var body, i, isGeneric, isMulti, partsLength, unnormalised;

  if (arguments.length < 3) {
    func = partCounts;
    partCounts = [gte(0)];
  }

  if (!util.isArray(partCounts)) {
    partCounts = [partCounts];
  }

  partsLength = partCounts.length;
  isMulti = partCounts.length > 1;
  isGeneric = false;

  for (i = 0; i < partsLength; i += 1) {
    unnormalised = partCounts[i];

    if (util.isArray(unnormalised)) {
      if (unnormalised.length === 1) {
        unnormalised[1] = gte(0);
      }
    } else {
      partCounts[i] = [0, unnormalised];
    }

    if (unnormalised[0] > 0) {
      isGeneric = true;
    }
  }

  body = function () {
    var argParts, argsLength, first, self;

    argsLength = arguments.length;
    argParts = util.slice(arguments);
    self = this;

    if (partCounts.length === 1) {
      first = argParts[0];

      if (!(util.isArray(first) && util.owns(first, "generics"))) {
        argsLength = 1;
        argParts = [argParts];
      }
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
      if (typeof partCount[1] === "number" && argPart.length < partCount[1] ||
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
    }).then(function (args) {
      if (!isMulti) {
        args = args[0];
      }

      return func.apply(self, args);
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

    if (!util.isArray(parts) || parts.length === 1) {
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
    return defs.bool(value);
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

  if (util.isArray(value)) {
    return defs.list(value);
  }

  if (value === undefined || value === null) {
    return defs.done;
  }

  return value;
}

function lookup(receiver, pretty, fromSelf) {
  var func, l, name, object, orig, type;

  name = util.uglify(pretty);
  func = receiver[name];

  if (!defs.isGraceObject(receiver) &&
      (typeof func !== "function" || !func.isGraceMethod)) {
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
    } else if (pretty === "asString") {
      // Use the regular toString in place of asString.
      func = method("asString", 0, function () {
        return defs.string(this.toString());
      });
    } else if (pretty === "at()") {
      func = method("at()", 1, function (index) {
        var self = this;

        return defs.asString(index).then(function (primIndex) {
          return fromPrimitive(self[primIndex]);
        });
      });
    } else if (pretty === "at() put()") {
      func = method("at() put()", [1, 1], function (index, value) {
        var self = this;

        return defs.asString(index).then(function (primIndex) {
          return asPrimitive(value).then(function (primValue) {
            self[primIndex] = primValue;
            return defs.done;
          });
        });
      });
    } else {
      l = name.length - 2;
      if (name.substring(l) === ":=") {
        name = name.substring(0, l);
        orig = receiver[name];

        // Produce a setter. This provides a mechanism for overwriting functions
        // in the object, which means you could assign a Grace block and have it
        // appear as a method rather than an object. You could replicate this
        // behaviour in Grace anyway, and JavaScript objects are always going to
        // appear a little wonky in Grace, so it's considered acceptable.
        if (typeof orig !== "function" || !orig.isGraceMethod) {
          func = method(pretty, 1, function (value) {
            return asPrimitive(value).then(function (primValue) {
              receiver[name] = primValue;
              return defs.done;
            });
          });
        }
      } else {
        func = receiver[name];

        if (func === undefined) {
          type = typeof receiver;

          if (type === "object" && util.isArray(receiver)) {
            type = "list";
          }

          if (type !== "object") {
            object = defs[type === "boolean" ? "bool" : type](receiver);
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
      defs.isGraceObject(receiver) && func === Object.prototype[name] ||
          typeof func === "function" && func.internal) {
    return defs.UnresolvedRequest
      .raiseForName_inObject([defs.string(pretty)], [receiver]);
  }

  if (!fromSelf && func.isConfidential) {
    return defs.UnresolvedRequest
      .raiseConfidentialForName_inObject([defs.string(pretty)], [receiver]);
  }

  return Task.resolve(func);
}

function call(receiver, meth, args) {
  try {
    return Task.resolve(meth.apply(receiver, args))
      .then(null, handleInternalError);
  } catch (reason) {
    return Task.reject(handleInternalError(reason));
  }
}

// Asynchronous method application that works for either synchronous or
// asynchronous methods.
function apply(receiver, meth, args) {
  if (typeof meth === "string") {
    return lookup(receiver, meth).then(function (foundMethod) {
      return apply(receiver, foundMethod, args);
    });
  }

  if (args === undefined) {
    // The user may optionally pass no arguments, signifying a call to a
    // single-part method with no arguments.
    args = [];
  } else if (args.length === 1 && !util.owns(args[0], "generics")) {
    // If the call is to a single-part method with arguments but no generics, it
    // needs to be removed from the part array to avoid confusing it with a
    // single-argument array. Removing  is equivalent to constructing a true
    // 'part' with the part function from above, but avoids having to create an
    // empty generic list.
    args = args[0];
  }

  return call(receiver, meth, args);
}

// Asynchronous inherits method application that works for either synchronous or
// asynchronous methods. The call throws if the method cannot be inherited from.
function inherit(receiver, meth, inheriting, args) {
  if (typeof meth === "string") {
    return lookup(receiver, meth).then(function (foundMethod) {
      return inherit(receiver, foundMethod, inheriting, args);
    });
  }

  if (typeof meth.inherit !== "function") {
    return defs.InvalidInherits.raiseForName(defs.string(meth.identifier));
  }

  if (args === undefined) {
    // As above, but inherited methods are always multi-part due to the
    // invisible part that takes the inheriting object inserted at the start.
    args = [[]];
  }

  args.unshift([inheriting]);

  return call(receiver, meth.inherit, args);
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
