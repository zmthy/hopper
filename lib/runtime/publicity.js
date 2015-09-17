// Publicity annotation definitions.

"use strict";

var defs, rt, util;

rt = require("../runtime");
defs = require("./definitions");
util = require("../util");

function setName(name, object) {
  name = defs.string(name);
  object.asString = rt.method("asString", 0, function () {
    return name;
  });

  return object;
}

function addMethod(object, name, func, params) {
  object[util.uglify(name)] = rt.method(name, params || 1, func);
  return object;
}

function newAnnotation(name, func) {
  var annotation = defs.object();

  setName(name, annotation);

  addMethod(annotation, "annotateMethod()", func);
  addMethod(annotation, "annotateDef()", func);
  addMethod(annotation, "annotateClass()", func);
  addMethod(annotation, "annotateType()", func);

  addMethod(annotation, "annotateVar()", function (reader, writer) {
    func(reader);
    return func(writer);
  }, 2);

  return annotation;
}

function makePublic(method) {
  delete method.isConfidential;
  return rt.done;
}

exports["public"] = newAnnotation("public", makePublic);

exports.confidential = newAnnotation("confidential", function (method) {
  method.isConfidential = true;
  return rt.done;
});

exports.readable = setName("readable",
  addMethod(defs.object(), "annotateVar()", makePublic, 2));

exports.writable = setName("writable",
  addMethod(defs.object(), "annotateVar()", function (reader, writer) {
    return makePublic(writer);
  }, 2));

exports.override = newAnnotation("override", function () {
  return rt.done;
});
