// Defines a base visitor class for building AST visitors in Grace.

"use strict";

var ast, defs, prim, rt, util, visitor;

ast = require("../ast");
rt = require("../runtime");
defs = require("../runtime/definitions");
prim = require("../runtime/primitives");
util = require("../util");

function Visitor() {}

util.inherits(Visitor, prim.Object);

function visit(node) {
  return this.visitNode(node);
}

util.forProperties(ast, function (name) {
  name = "visit" + name;

  Visitor.prototype[name] = rt.method(name, 1, visit);
});

Visitor.prototype.visitNode = rt.method("visitNode", 1, function () {
  return defs.bool(true);
});

function EmptyVisitor() {}

util.inherits(EmptyVisitor, Visitor);

EmptyVisitor.prototype.visitNode = rt.method("visitNode", 1, function () {
  return defs.bool(false);
});

visitor = defs.object();

function makeConstructor(name, Ctor) {
  visitor[name] = rt.constructor(name, 0, function (inheritor) {
    if (inheritor === null) {
      return new Ctor();
    }

    util.extend(inheritor, Ctor.prototype);

    return inheritor;
  });
}

makeConstructor("base", Visitor);
makeConstructor("empty", EmptyVisitor);

module.exports = visitor;
