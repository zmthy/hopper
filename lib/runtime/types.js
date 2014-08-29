// Built-in type definitions.

"use strict";

var Bool, Do, Done, Foreign, Node, Order, Pattern, Sequence, Unknown,
  ast, defs, prim, rt, type, util;

ast = require("../ast");
rt = require("../runtime");
util = require("../util");

prim = require("./primitives");
defs = require("./definitions");
type = require("./definitions").type;

exports.Object = type("Object", []);

exports.Nothing = defs.pattern("Nothing", defs.failure);

exports.Unknown = defs.pattern("Unknown", function (object) {
  return defs.success(object);
});

Foreign = defs.pattern("Foreign", function (object) {
  return defs.match(!defs.isGraceObject(object), object, Foreign);
});

exports.Foreign = Foreign;

exports.Done = new defs.singleton("Done", defs.done);

Order = type("Order",
    [ defs.signature("<", ["than"]),
      defs.signature("<=", ["than"]),
      defs.signature(">", ["than"]),
      defs.signature(">=", ["than"])
    ]);

exports.Order = Order;

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

exports.Procedure = type("Procedure", 1, [defs.signature("apply", ["value"])]);

(function () {
  var i, j, params;

  for (i = 2; i < 10; i += 1) {
    params = [];

    for (j = 1; j < i + 1; j += 1) {
      params.push("value" + j);
    }

    exports["Function" + i] =
      type("Function" + i, i + 1, [defs.signature("apply", params)]);

    exports["Procedure" + i] =
      type("Procedure" + i, i, [defs.signature("apply", params)]);
  }
}());

Bool = type("Boolean",
    [ defs.signature([defs.sigPart("ifTrue", ["T"], ["then"]),
        defs.sigPart("ifFalse", ["E"], ["else"])]),
      defs.signature("ifTrue", ["then"]),
      defs.signature("ifFalse", ["else"]),
      defs.signature([defs.sigPart("andAlso", ["then"]),
        defs.sigPart("orElse", ["else"])]),
      defs.signature([defs.sigPart("andAlso", ["then"])]),
      defs.signature([defs.sigPart("orElse", ["else"])]),
      defs.signature("&&", ["and"]),
      defs.signature("||", ["or"]),
      defs.signature("prefix!")
    ]);

exports.Boolean = Bool;

exports.Match =
  type("Match", Bool, [defs.signature("value"), defs.signature("pattern")]);

exports.Number = type("Number", [Order, Pattern],
    [ defs.signature("prefix-"),
      defs.signature("+", ["addene"]),
      defs.signature("-", ["subtrahend"]),
      defs.signature("*", ["multiplier"]),
      defs.signature("/", ["divisor"]),
      defs.signature("%", ["divisor"]),
      defs.signature("^", ["exponent"]),
      defs.signature("absolute"),
      defs.signature("round"),
      defs.signature("floor"),
      defs.signature("ceiling"),
      defs.signature("log"),
      defs.signature("exponent"),
      defs.signature("sin"),
      defs.signature("cos"),
      defs.signature("tan"),
      defs.signature("asin"),
      defs.signature("acos"),
      defs.signature("atan"),
      defs.signature("square"),
      defs.signature("cube"),
      defs.signature("squareRoot"),
      defs.signature("asPrimitiveNumber")
    ]);

Do = type("Do", 1, [defs.signature("do", ["function"])]);

exports.Do = Do;

Sequence = type("Sequence", 1, Do,
    [ defs.signature("at", ["index"]),
      defs.signature("size"),
      defs.signature("++", ["list"]),
      defs.signature([defs.sigPart("fold", ["T"], ["f"]),
        defs.sigPart("startingWith", ["a"])]),
    ]);

exports.Sequence = Sequence;

exports.String =
  type("String", [Order, Pattern, Sequence],
      [ defs.signature([defs.sigPart("substringFrom", ["from"]),
          defs.sigPart("to", ["to"])]),
        defs.signature([defs.sigPart("substringFrom", ["from"]),
          defs.sigPart("size", ["size"])]),
        defs.signature("substringFrom", ["from"]),
        defs.signature("substringTo", ["to"]),
        defs.signature([defs.sigPart("replace", ["substring"]),
          defs.sigPart("with", ["inserting"])]),
        defs.signature("startsWith", ["prefix"]),
        defs.signature("endsWith", ["suffix"]),
        defs.signature("indexOf", ["needle"]),
        defs.signature([defs.sigPart("indexOf", ["needle"]),
          defs.sigPart("startingAt", ["from"])]),
        defs.signature([defs.sigPart("indexOf", ["needle"]),
          defs.sigPart("ifAbsent", ["action"])]),
        defs.signature([defs.sigPart("indexOf", ["needle"]),
          defs.sigPart("startingAt", ["from"]),
          defs.sigPart("ifAbsent", ["action"])]),
        defs.signature("lastIndexOf", ["needle"]),
        defs.signature([defs.sigPart("lastIndexOf", ["needle"]),
          defs.sigPart("startingAt", ["from"])]),
        defs.signature([defs.sigPart("lastIndexOf", ["needle"]),
          defs.sigPart("ifAbsent", ["action"])]),
        defs.signature([defs.sigPart("lastIndexOf", ["needle"]),
          defs.sigPart("startingAt", ["from"]),
          defs.sigPart("ifAbsent", ["action"])]),
        defs.signature("asPrimitiveString")
      ]);

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

Node = defs.pattern("Node", function (value) {
  return defs.match(value instanceof ast.Node, value, this);
});

util.forProperties(ast, function (name, Ctor) {
  var pattern = defs.pattern(name, function (value) {
    return defs.match(value instanceof Ctor, value, this);
  });

  Node[name] = rt.method(name, 0, function () {
    return pattern;
  });
});

exports.Node = Node;

