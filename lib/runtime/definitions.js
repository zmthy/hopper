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

function bool(value) {
  if (value) {
    return bools[true];
  }

  return bools[false];
}

exports.bool = bool;

exports.number = function (value) {
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

done = object();

done.asString = rt.newMethod("asString", 0, function () {
  return string("done");
});

exports.done = done;

Unknown = new prim.AbstractPattern();

Unknown.match = rt.newMethod("match()", 1, function () {
  return bool(true);
});

Unknown.asString = rt.newMethod("asString", 0, function () {
  return string("Unknown");
});

exports.Unknown = Unknown;

Action = type("Action", ["apply"]);

// TODO Implement this in a way that does not cause a stack overflow from the
// re-assertion in orElse().
Action.assert = rt.newMethod("assert()", 1, function () {
  return done;
});

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
    exceptions.InternalError.match(error).then(function (match) {
      match.orElse(rt.block(0, function () {
        isInternal = false;
      }));
    });
  }

  return isInternal;
};

exports.try_catch =
  rt.newMethod("try() catch()", [[1, 1], [1, 1]], function (fst, snd) {
    return fst[1].apply().then(null, function (packet) {
      return snd[1].match(packet).then(function (match) {
        return match.andAlso_orElse(rt.part(snd[0], rt.block(0, function () {
          return snd[1].apply(packet);
        })), [rt.block(0, function () {
          return packet.raise();
        })]);
      });
    });
  });

