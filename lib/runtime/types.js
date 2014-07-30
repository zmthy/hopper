// Built-in type definitions.

"use strict";

var Unknown, defs, prim, rt, type;

rt = require("../runtime");
prim = require("./primitives");
defs = require("./definitions");
type = require("./definitions").type;

Unknown = new prim.AbstractPattern();

Unknown.match = rt.method("match()", 1, function (object) {
  return defs.success(object);
});

Unknown.asString = rt.method("asString", 0, function () {
  return defs.string("Unknown");
});

exports.Unknown = Unknown;

exports.Action = type("Action", ["apply"]);

exports.Any = type("Object", []);

exports.Boolean = type("Boolean",
  ["andAlso orElse", "andAlso", "orElse", "&&", "||", "prefix!"]);

exports.Match = type("Match",
  ["andAlso orElse", "andAlso", "orElse", "&&", "||", "prefix!", "value"]);

exports.Number = type("Number", ["asPrimitiveNumber"]);

exports.List = type("List", ["doForEach", "++"]);

exports.String = type("String", ["asPrimitiveString", "++"]);

exports.Pattern = type("Pattern", ["match", "&", "|"]);

exports.ObjectAnnotator = type("ObjectAnnotator", ["annotateObject"]);

exports.MethodAnnotator = type("MethodAnnotator", ["annotateMethod"]);

exports.DefAnnotator = type("DefAnnotator", ["annotateDef"]);

exports.VarAnnotator = type("VarAnnotator", ["annotateVar"]);

exports.ClassAnnotator = type("ClassAnnotator", ["annotateClass"]);

exports.TypeAnnotator = type("TypeAnnotator", ["annotateType"]);

