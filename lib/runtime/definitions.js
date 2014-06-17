// Individual objects and helper methods for the runtime.

"use strict";

var Action, Unknown, bools, done, prim, rt;

prim = require("./primitives");
rt = require("../runtime");

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

exports.success = function (value) {
  var object = bool(true);

  object.value = rt.newMethod("value", 0, function () {
    return value;
  });

  return object;
};

exports.failure = function (value) {
  var object = bool(false);

  object.value = rt.newMethod("value", 0, function () {
    return value;
  });

  return object;
};

bools = {
  "true": new prim.AbstractBoolean(),
  "false": new prim.AbstractBoolean()
};

bools[true].andAlso_orElse =
  rt.newMethod("andAlso() orElse()", [1, 1], function (fst) {
    return fst[0].apply();
  });

bools[true].asString = rt.newMethod("asString", 0, function () {
  return string("true");
});

/*jslint unparam: true*/
bools[false].andAlso_orElse =
  rt.newMethod("andAlso() orElse()", [1, 1], function (fst, snd) {
    return snd[0].apply();
  });
/*jslint unparam: false*/

bools[false].asString = rt.newMethod("asString", 0, function () {
  return string("false");
});

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

exports.List = type("List", ["++"]);

exports.String = type("String", ["asPrimitiveString", "++"]);

exports.Pattern = type("Pattern", ["match", "&", "|"]);

