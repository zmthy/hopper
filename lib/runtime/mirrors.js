// Defines the reflection API for the interpreter.

"use strict";

var defs, prim, rt, util;

rt = require("../runtime");
util = require("../util");

defs = require("./definitions");
prim = require("./primitives");

function Part(name, parameters) {
  this.object = {
    "name": name,
    "parameters": parameters
  };
}

util.inherits(Part, prim.Object);

Part.prototype.name = rt.method("name", 0, function () {
  return defs.string(this.object.name);
});

Part.prototype.generics = rt.method("generics", 0, function () {
  return defs.number(this.object.parameters[0]);
});

Part.prototype.parameters = rt.method("parameters", 0, function () {
  return defs.number(this.object.parameters[1]);
});

Part.prototype.toString = function () {
  var generics, parameters;

  generics = this.object.parameters[0];
  parameters = this.object.parameters[1];

  return this.object.name +
    (generics === 0 ? "" : "<" + generics + ">") +
    (parameters === 0 ? "" : "(" + parameters + ")");
};

Part.prototype.asString = rt.method("asString", 0, function () {
  return defs.string(this.toString());
});

function Method(method) {
  var i, l, mParts, names, parts;

  names = method.identifier.split(" ");
  mParts = method.parts;

  parts = [];

  for (i = 0, l = names.length; i < l; i += 1) {
    parts.push(new Part(names[i].replace("()", ""), mParts[i]));
  }

  this.object = {
    "method": method,
    "parts": parts
  };
}

util.inherits(Method, prim.Object);

Method.prototype.name = rt.method("name", 0, function () {
  return defs.string(this.object.method.identifier);
});

Method.prototype.signature = rt.method("signature", 0, function () {
  return new prim.List(this.object.parts);
});

Method.prototype.toString = function () {
  return "method " + this.object.parts.join(" ");
};

Method.prototype.asString = rt.method("asString", 0, function () {
  return defs.string(this.toString());
});

function Mirror(object) {
  this.object = object;
}

util.inherits(Mirror, prim.Object);

Mirror.prototype.methodNamed_ifAbsent = rt.method("methodNamed() ifAbsent",
  [1, [1, 1]], function (rawName, onAbsent) {
    var object = this.object;

    rawName = rawName[0];
    onAbsent = onAbsent[1];

    return rt.String.assert(rawName).then(function () {
      return rt.Action.assert(onAbsent);
    }).then(function () {
      return rawName.asPrimitiveString();
    }).then(function (name) {
      var pName;

      if (rt.isGraceObject(object)) {
        pName = util.uglify(name);

        if (util.owns(object, pName) && object[pName].isGraceMethod) {
          return new Method(object[pName]);
        }

        return onAbsent.apply();
      }

      throw new Error("Mirrors not yet implemented for JavaScript objects");
    });
  });

Mirror.prototype.methodNamed = rt.method("methodNamed()", 1, function (name) {
  return this.methodNamed_ifAbsent([name], [rt.block(0, function () {
    return rt.FailedSearch.raiseForObject(name);
  })]);
});

Mirror.prototype.methods = rt.method("methods", 0, function () {
  var methods, object;

  object = this.object;
  methods = [];

  if (rt.isGraceObject(object)) {
    util.forProperties(object, function (name, value) {
      if (value.isGraceMethod) {
        methods.push(new Method(value));
      }
    });
  } else {
    throw new Error("Mirrors not yet implemented for JavaScript objects");
  }

  return new prim.Set(methods);
});

Mirror.prototype.asString = rt.method("asString", 0, function () {
  return this.object.asString().then(function (string) {
    return defs.string("mirror[")["++"](string);
  }).then(function (string) {
    return string["++"](defs.string("]"));
  });
});

exports.reflect = rt.method("reflect()", 1, function (object) {
  return new Mirror(object);
});

exports.Mirror = defs.type("Mirror",
  [defs.signature([defs.sigPart("methodNamed", ["name"]),
      defs.sigPart("ifAbsent", ["onAbsent"])]),
    defs.signature("methodNamed", ["name"]),
    defs.signature("methods")
 ]);

exports.MirrorMethod = defs.type("MirrorMethod",
  [defs.signature("name"),
    defs.signature("signature")
 ]);

exports.MirrorPart = defs.type("MirrorMethod",
  [defs.signature("name"),
    defs.signature("generics"),
    defs.signature("parameters")
 ]);

exports.toString = function () {
  return "mirrors";
};
