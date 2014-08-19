// Built-in type definitions.

"use strict";

var Bool, Done, List, Pattern, Unknown, defs, prim, rt, type;

rt = require("../runtime");
prim = require("./primitives");
defs = require("./definitions");
type = require("./definitions").type;

exports.Object = type("Object", []);

exports.Unknown = defs.pattern("Unknown", function (object) {
  return defs.success(object);
});

exports.Done = new defs.singleton("Done", defs.done);

Pattern = type("Pattern",
    [ defs.signature("match", ["value"]),
      defs.signature("assert", ["value"]),
      defs.signature("&", ["and"]),
      defs.signature("|", ["or"])
    ]);

exports.Pattern = Pattern;

exports.Action = type("Action", 1, [defs.signature("apply")]);

exports.Function =
  type("Function", 2, Pattern, [defs.signature("apply", ["value"])]);

(function () {
  var i, j, params;

  for (i = 2; i < 10; i += 1) {
    params = [];

    for (j = 1; j < i + 1; j += 1) {
      params.push("value" + j);
    }

    exports["Function" + i] =
      type("Function" + i, i + 1, [defs.signature("apply", params)]);
  }
}());

Bool = type("Boolean",
    [ defs.signature(defs.sigPart("ifTrue", ["T"], ["then"]),
        defs.sigPart("ifFalse", ["E"], ["else"])),
      defs.signature("ifTrue", ["then"]),
      defs.signature("ifFalse", ["else"]),
      defs.signature(defs.sigPart("andAlso", ["then"]),
        defs.sigPart("orElse", ["else"])),
      defs.signature(defs.sigPart("andAlso", ["then"])),
      defs.signature(defs.sigPart("orElse", ["else"])),
      defs.signature("&&", ["and"]),
      defs.signature("||", ["or"]),
      defs.signature("prefix!")
    ]);

exports.Boolean = Bool;

exports.Match =
  type("Match", Bool, [defs.signature("value"), defs.signature("pattern")]);

exports.Number = type("Number", Pattern,
    [ defs.signature("+", ["addene"]),
      defs.signature("-", ["subtrahend"]),
      defs.signature("*", ["multiplier"]),
      defs.signature("/", ["divisor"]),
      defs.signature("%", ["divisor"]),
      defs.signature("^", ["exponent"]),
      defs.signature("asPrimitiveNumber")
    ]);

List = type("List", 1,
    [ defs.signature("at", ["index"]),
      defs.signature("size"),
      defs.signature("do", ["function"]),
      defs.signature("++", ["list"])
    ]);

exports.List = List;

exports.String =
  type("String", [Pattern, List], [defs.signature("asPrimitiveString")]);

exports.ObjectAnnotator =
  type("ObjectAnnotator", [defs.signature("annotateObject", ["obj"])]);

exports.MethodAnnotator =
  type("MethodAnnotator", [defs.signature("annotateMethod", ["meth"])]);

exports.DefAnnotator =
  type("DefAnnotator", [defs.signature("annotateDef", ["definition"])]);

exports.VarAnnotator =
  type("VarAnnotator", [defs.signature("annotateVar", ["reader", "writer"])]);

exports.ClassAnnotator =
  type("ClassAnnotator", [defs.signature("annotateClass", ["cls"])]);

exports.TypeAnnotator =
  type("TypeAnnotator", [defs.signature("annotateType", ["typ"])]);

