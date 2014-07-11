// Individual objects and helper methods for the runtime.

"use strict";

var Action, Task, Unknown, bools, done, exceptions, prim, rt, util;

Task = require("../task");
prim = require("./primitives");
rt = require("../runtime");
util = require("../util");

function object() {
  return new prim.GraceObject();
}

exports.object = object;

exports.isGraceObject = function (value) {
  return value instanceof prim.GraceObject;
};

exports.base = prim.GraceObject.prototype;

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
  var base, x;

  if (typeof value === "string") {
    x = value.match(/[xX]/);

    if (x !== null) {
      base = Number(value.substring(0, x.index));

      if (base > 1 && base < 37) {
        value = parseInt(value.substring(x.index + 1), base);
      }
    }
  }

  return new prim.GraceNumber(value);
};

function string(value) {
  return new prim.GraceString(value);
}

exports.string = string;

function type(name, names) {
  return new prim.Type(name, names);
}

exports.type = type;

exports.proxy = function () {
  return new prim.TypeProxy();
};

exports.pattern = function (match) {
  var pattern = new prim.AbstractPattern();
  pattern.match = rt.method("match()", 1, match);
  return pattern;
};

exports.named = function (name, pattern) {
  return new prim.NamedPattern(name, pattern);
};

function success(value) {
  return new prim.Success(value);
}

exports.success = success;

function failure(value) {
  return new prim.Failure(value);
}

exports.failure = failure;

exports.match = function (bool, value) {
  return bool ? success(value) : failure(value);
};

exports.equalityMatch = function (self, against) {
  return rt.apply(self, "==", [[against]]).then(function (eq) {
    return rt.apply(eq, "andAlso() orElse()", [[block(0, function () {
      return success(against);
    })], [block(0, function () {
      return failure(against);
    })]]);
  });
};

exports.list = function (elements) {
  return new prim.List(elements);
};

exports.listOf = function (pattern) {
  return new prim.ListPattern(pattern || Unknown);
};

bools = {
  "true": new prim.True(),
  "false": new prim.False()
};

function getBoolean(which) {
  var method, value;

  value = bools[which];

  method = rt.method(which.toString(), 0, function () {
    return value;
  });

  method.inherit = rt.method(which.toString(), 0, function () {
    util.extendAll(this, value);
    return this;
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

Unknown = new prim.AbstractPattern();

Unknown.match = rt.method("match()", 1, function (object) {
  return success(object);
});

Unknown.asString = rt.method("asString", 0, function () {
  return string("Unknown");
});

exports.Unknown = Unknown;

Action = type("Action", ["apply"]);

exports.Action = Action;

exports.Any = type("Object", []);

exports.Boolean = type("Boolean",
  ["andAlso orElse", "andAlso", "orElse", "&&", "||", "prefix!"]);

exports.Match = type("Match",
  ["andAlso orElse", "andAlso", "orElse", "&&", "||", "prefix!", "value"]);

exports.Number = type("Number", ["asPrimitiveNumber"]);

exports.List = type("List", ["doForEach", "++"]);

exports.String = type("String", ["asPrimitiveString", "++"]);

exports.Pattern = type("Pattern", ["match", "&", "|"]);

exceptions = require("./exceptions");

util.extend(exports, exceptions);

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
      })).now();
    });
  }

  return isParse;
};

exports.try_catch =
  rt.method("try() catch()", [1, 1], function (fst, snd) {
    return Action.match(fst[0]).then(function () {
      return Action.match(snd[0]);
    }).then(function () {
      return fst[0].apply();
    }).then(null, function (packet) {
      return snd[0].match(packet).then(function (match) {
        return match.orElse(block(0, function () {
          return packet.raise();
        }));
      });
    });
  });

