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
  var i, ident, l, mParts, names, parts;

  ident = method.identifier;
  names = ident.substring(":=") === -1 ? ident.split(" ") : [ ident ];

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
  [ 1, [ 1, 1 ] ], function (rawName, onAbsent) {
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
  return this.methodNamed_ifAbsent([ name ], [ rt.block(0, function () {
    return rt.FailedSearch.raiseForObject(name);
  }) ]);
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
  [ defs.signature([ defs.sigPart("methodNamed", [ "name" ]),
      defs.sigPart("ifAbsent", [ "onAbsent" ]) ]),
    defs.signature("methodNamed", [ "name" ]),
    defs.signature("methods")
  ]);

exports.MirrorMethod = defs.type("MirrorMethod",
  [ defs.signature("name"),
    defs.signature("signature")
  ]);

exports.MirrorPart = defs.type("MirrorMethod",
  [ defs.signature("name"),
    defs.signature("generics"),
    defs.signature("parameters")
  ]);

exports.toString = function () {
  return "mirrors";
};

function ParamPart(unknown) {
  this.name = "_";
  this.pattern = unknown;
}

ParamPart.prototype.toString = function () {
  return this.name + " : " + this.pattern;
};

function PartType(name, paramCount, unknown) {
  var i, params = [];

  for (i = 0; i < paramCount; i += 1) {
    params.push(new ParamPart(unknown));
  }

  this.name = name;
  this.parameters = params;
}

PartType.prototype.toString = function () {
  return this.name + "(" + this.parameters.join(", ") + ")";
};

function MethodType(method, unknown) {
  var i, l, part, parts, sig;

  parts = method.object.parts;
  sig = [];

  for (i = 0, l = parts.length; i < l; i += 1) {
    part = parts[i];
    sig.push(new PartType(part.object.name,
      part.object.parameters[1]), unknown);
  }

  this.name = method.object.method.identifier;
  this.signature = sig;
  this.returnType = unknown;
}

MethodType.prototype.isPublic = true;
MethodType.prototype["isPublic:="] = function (value) {
  this.isPublic = value;
};

MethodType.prototype.toString = function () {
  return this.parts.join(" ");
};

function Entry(key, value) {
  this.object = {
    "key": key,
    "value": value
  };
}

util.inherits(Entry, prim.Object);

Entry.prototype.key = rt.method("key", 0, function () {
  return this.object.key;
});

Entry.prototype.value = rt.method("value", 0, function () {
  return this.object.value;
});

Entry.prototype["=="] = rt.method("==", 1, function (other) {
  var object = this.object;

  if (other instanceof Entry) {
    return object.key["=="](other.object.key).then(function (isEqual) {
      return isEqual.andAlso(rt.block(0, function () {
        return object.value["=="](other.object.value);
      }));
    });
  }

  return defs.bool(false);
});

Mirror.prototype.insertInto_withUnknown =
  rt.method("insertInto() withUnknown", [ 1, 1 ], function (map, unknown) {
    var elements, object;

    map = map[0];
    unknown = unknown[0];

    object = this.object;
    elements = map.object.elements;

    util.forProperties(object, function (name, value) {
      if (value.isGraceMethod) {
        elements.push(new Entry(defs.string(name),
          new MethodType(new Method(value), unknown)));
      }
    });

    return defs.done;
  });

Mirror.prototype.metadata = rt.method("metadata", 0, function () {
  var object = this.object;

  object.object = object.object || {};
  object = object.object;

  object.metadata = object.metadata || new WeakSet();
  return object.metadata;
});
