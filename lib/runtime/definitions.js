// Individual objects and helper methods for the runtime.

"use strict";

var Action, Unknown, bools, done, prim, rt, util;

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

util.extend(exports, require("./exceptions"));

exports.isGraceExceptionPacket = function (value) {
  return value instanceof prim.ExceptionPacket;
};

