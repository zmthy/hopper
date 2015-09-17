// Individual objects and helper methods for the runtime.

"use strict";

var Task, bools, done, exceptions, prim, rt, types, util;

Task = require("../task");
prim = require("./primitives");
rt = require("../runtime");
util = require("../util");

function object() {
  return new prim.Object();
}

exports.object = object;

exports.asString = prim.asString;

exports.isGraceObject = function (value) {
  return value instanceof prim.Object;
};

exports.base = prim.Object.prototype;

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
  return new prim.Block(parameters, apply);
}

exports.block = block;

function bool(value) {
  if (value) {
    return bools[true];
  }

  return bools[false];
}

exports.bool = bool;

exports.number = function (value) {
  return new prim.Number(value);
};

function string(value) {
  return new prim.String(value);
}

exports.string = string;

function type(name, generics, extending, signatures) {
  return new prim.Type(name, generics, extending, signatures);
}

exports.type = type;

exports.signature = function (parts, hasVarArg, generics, parameters) {
  return new prim.Signature(parts, hasVarArg, generics, parameters);
};

exports.sigPart = function (name, hasVarArg, generics, parameters) {
  return new prim.Part(name, hasVarArg, generics, parameters);
};

exports.proxy = function (name) {
  return new prim.TypeProxy(name);
};

function pattern(name, match) {
  var pat = new prim.AbstractPattern();

  pat.match = rt.method("match()", 1, match);

  name = string(name);

  pat.asString = rt.method("asString", 0, function () {
    return name;
  });

  return pat;
}

exports.pattern = pattern;

exports.named = function (name, patt) {
  return new prim.NamedPattern(name, patt);
};

function success(value, patt) {
  return new prim.Success(value, patt);
}

exports.success = success;

function failure(value, patt) {
  return new prim.Failure(value, patt);
}

exports.failure = failure;

exports.singleton = function (name, value) {
  return pattern(name, function (against) {
    var self = this;

    return value["=="](against).then(function (eq) {
      return eq.ifTrue_ifFalse([
        rt.block(0, function () {
          return success(against, self);
        })
      ], [
        rt.block(0, function () {
          return failure(against, self);
        })
      ]);
    });
  });
};

exports.match = function (cond, value, patt) {
  return cond ? success(value, patt) : failure(value, patt);
};

exports.equalityMatch = function (value, against) {
  return value["=="](against).then(function (eq) {
    return eq.andAlso_orElse([
      block(0, function () {
        return success(against, value);
      })
    ], [
      block(0, function () {
        return failure(against, value);
      })
    ]);
  });
};

exports.list = function (elements) {
  return new prim.List(elements);
};

exports.listOf = function (patt) {
  return new prim.ListPattern(patt || types.Unknown);
};

exports.set = function (elements) {
  return new prim.Set(elements);
};

exports.entry = function (key, value) {
  return new prim.Entry(key, value);
};

exports.dictionary = function (elements) {
  return new prim.Dictionary(elements);
};

bools = {
  "true": new prim.True(),
  "false": new prim.False()
};

function getBoolean(which) {
  var method, value;

  value = bools[which];

  method = rt.constructor(which.toString(), 0, function (inheriting) {
    if (inheriting !== null) {
      util.extendAll(inheriting, value);
    }

    return value;
  });

  return method;
}

exports.mtrue = getBoolean(true);

exports.mfalse = getBoolean(false);

done = object();

done.asString = rt.method("asString", 0, function () {
  return string("done");
});

exports.done = done;

exports.emptyBlock = block(0, function () {
  return done;
});

types = require("./types");

util.extend(exports, types);

exceptions = require("./exceptions");

util.extend(exports, exceptions);

util.extend(exports, require("./methods"));

util.extend(exports, require("./publicity"));

function isGraceExceptionPacket(value) {
  return value instanceof prim.ExceptionPacket;
}

exports.isGraceExceptionPacket = isGraceExceptionPacket;

exports.isInternalError = function (value) {
  return value instanceof Error ||
      value instanceof exceptions.InternalError.object.Packet;
};

exports.isParseError = function (value) {
  return value instanceof exceptions.ParseFailure.object.Packet;
};

exports.isInterruptError = function (value) {
  return value instanceof Task.InterruptError ||
      value instanceof exceptions.InternalError.object.Packet &&
          value.object.error instanceof Task.InterruptError;
};

function addGenerics(name, generics) {
  return rt.method("asString", 0, function () {
    return rt.string(name + "<")["++"](generics[0]).then(function (str) {
      var comma = rt.string(", ");

      return Task.each(util.slice(generics, 1), function (snd) {
        return str["++"](comma).then(function (fst) {
          return fst["++"](snd).then(function (value) {
            str = value;
          });
        });
      }).then(function () {
        return str;
      });
    }).then(function (init) {
      return init["++"](rt.string(">"));
    });
  });
}

exports.withGenerics = function (name, genericType) {
  var args, i, l;

  function GenericType() {
    this.asString = addGenerics(name, args);
  }

  GenericType.prototype = genericType;

  args = util.slice(arguments, 2);

  for (i = 0, l = args.length; i < l; i += 1) {
    // If any of the generic types isn't Unknown, we produce a different
    // type which has a better stringifier.
    if (args[i] !== rt.Unknown) {
      return new GenericType();
    }
  }

  return genericType;
};

exports.isSubMethod = function (mparts, parts) {
  var generics, i, l, mcount, part, scount;

  for (i = 0, l = mparts.length; i < l; i += 1) {
    part = parts[i];
    generics = part.generics !== undefined ? part.generics.length : part[0];

    mcount = mparts[i][1];
    scount = part.parameters !== undefined ? part.parameters.length : part[1];

    if (generics !== 0 && mparts[i][0] !== generics ||
        (typeof mcount === "number" ? part.hasVarArg || mcount !== scount :
            (part.hasVarArg ? scount - 1 : scount) < mcount.minimum)) {
      return false;
    }
  }

  return true;
};

function newComparison(name, impl) {
  var comp = new prim.Comparison();

  name = string(name);

  comp.ifLessThan_ifEqualTo_ifGreaterThan =
    rt.method("ifLessThan() ifEqualTo() ifGreaterThan()", [1, 1, 1],
      function (onLessThan, onEqualTo, onGreaterThan) {
        return types.Action.assert(onLessThan[0]).then(function () {
          return types.Action.assert(onEqualTo[0]);
        }).then(function () {
          return types.Action.assert(onGreaterThan[0]);
        }).then(function () {
          return impl(onLessThan[0], onEqualTo[0], onGreaterThan[0]);
        });
      });

  comp.asString = rt.method("asString", 0, function () {
    return name;
  });

  return comp;
}

exports.LessThan = newComparison("Less Than", function (onLessThan) {
  return onLessThan.apply();
});

exports.EqualTo = newComparison("Equal To", function (onLessThan, onEqualTo) {
  return onEqualTo.apply();
});

exports.GreaterThan = newComparison("Greater Than",
  function (onLessThan, onEqualTo, onGreaterThan) {
    return onGreaterThan.apply();
  });
