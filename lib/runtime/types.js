// Built-in type definitions.

"use strict";

var Done, Unknown, defs, prim, rt, type;

rt = require("../runtime");
prim = require("./primitives");
defs = require("./definitions");
type = require("./definitions").type;

exports.Unknown = defs.pattern("Unknown", function (object) {
  return defs.success(object);
});

exports.Done = new defs.singleton("Done", defs.done);

exports.Action = type("Action", 1, ["apply"]);

exports.Function = type("Function", 2, ["apply"]);

exports.Any = type("Object", 0, []);

exports.Boolean = type("Boolean", 0,
  ["andAlso orElse", "andAlso", "orElse", "&&", "||", "prefix!"]);

exports.Match = type("Match", 0,
  ["andAlso orElse", "andAlso", "orElse", "&&", "||", "prefix!", "value"]);

exports.Number = type("Number", 0,
  ["+", "-", "*", "/", "^", "%", "asPrimitiveNumber"]);

exports.List = type("List", 1, ["doForEach", "++"]);

exports.String = type("String", 0, ["asPrimitiveString", "++"]);

exports.Pattern = type("Pattern", 0, ["match", "&", "|"]);

exports.ObjectAnnotator = type("ObjectAnnotator", 0, ["annotateObject"]);

exports.MethodAnnotator = type("MethodAnnotator", 0, ["annotateMethod"]);

exports.DefAnnotator = type("DefAnnotator", 0, ["annotateDef"]);

exports.VarAnnotator = type("VarAnnotator", 0, ["annotateVar"]);

exports.ClassAnnotator = type("ClassAnnotator", 0, ["annotateClass"]);

exports.TypeAnnotator = type("TypeAnnotator", 0, ["annotateType"]);

