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

function boolean(value) {
  if (value) {
    return bools[true];
  }

  return bools[false];
}

exports.boolean = boolean;

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

exports.named = function (name, pattern) {
  return new prim.NamedPattern(name, pattern);
};

function success(value, pattern) {
  return new prim.Success(value, pattern);
}

exports.success = success;

function failure(value, pattern) {
  return new prim.Failure(value, pattern);
}

exports.failure = failure;

exports.singleton = function (name, object) {
  return pattern(name, function (value) {
    var self = this;

    return object["=="](value).then(function (eq) {
      return eq.ifTrue_ifFalse([rt.block(0, function () {
        return success(value, self);
      })], [rt.block(0, function () {
        return failure(value, self);
      })]);
    });
  });
};

exports.match = function (bool, value, pattern) {
  return bool ? success(value, pattern) : failure(value, pattern);
};

exports.equalityMatch = function (self, against) {
  return rt.apply(self, "==", [[against]]).then(function (eq) {
    return rt.apply(eq, "andAlso() orElse()", [[block(0, function () {
      return success(against, self);
    })], [block(0, function () {
      return failure(against, self);
    })]]);
  });
};

exports.sequence = function (elements) {
  return new prim.Sequence(elements);
};

exports.sequenceOf = function (pattern) {
  return new prim.SequencePattern(pattern || types.Unknown);
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

exports.isInternalError = function (error) {
  var isInternal = true;

  if (isGraceExceptionPacket(error)) {
    exceptions.InternalError.match(error).now(function (match) {
      return match.orElse(block(0, function () {
        isInternal = false;
        return rt.done;
      })).now();
    });
  }

  return isInternal;
};

exports.isParseError = function (error) {
  var isParse = true;

  if (isGraceExceptionPacket(error)) {
    exceptions.ParseError.match(error).now(function (match) {
      match.orElse(block(0, function () {
        isParse = false;
        return rt.done;
      })).now();
    });
  }

  return isParse;
};

function addGenerics(name, generics) {
  return rt.method("asString", 0, function () {
    return rt.string(name + "<")["++"](generics[0]).then(function (string) {
      var comma = rt.string(", ");

      return Task.each(util.slice(generics, 1), function (snd) {
        return string["++"](comma).then(function (fst) {
          return fst["++"](snd).then(function (value) {
            string = value;
          });
        });
      }).then(function () {
        return string;
      });
    }).then(function (string) {
      return string["++"](rt.string(">"));
    });
  });
}

exports.withGenerics = function (name, type) {
  var args, i, l, value;

  function Clone() {
    return this;
  }

  args = util.slice(arguments, 2);

  for (i = 0, l = args.length; i < l; i += 1) {
    // If any of the generic types isn't Unknown, we produce a different
    // type which has a better stringifier.
    if (args[i] !== rt.Unknown) {
      Clone.prototype = type;
      value = new Clone();
      value.asString = addGenerics(name, args);
      return value;
    }
  }

  return type;
};

