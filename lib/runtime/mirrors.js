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
  var params = this.parameters;

  return this.name +
    (params.length === 0 ? "" : "(" + this.parameters.join(", ") + ")");
};

function MethodType(name, parts, unknown) {
  var i, l, part, sig;

  sig = [];

  for (i = 0, l = parts.length; i < l; i += 1) {
    part = parts[i];
    sig.push(new PartType("_", part[1], unknown));
  }

  this.name = name;
  this.signature = sig;
  this.returnType = unknown;
}

MethodType.prototype.isPublic = true;
MethodType.prototype["isPublic:="] = function (value) {
  this.isPublic = value;
};

MethodType.prototype.toString = function () {
  return this.signature.join(" ");
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

function nameFromParts(parts) {
  var i, l, name;

  if (parts.length === 1 && parts[0].parameters.length === 0 ||
      parts[0].name.match(/\W/)) {
    return parts[0].name;
  }

  name = "";

  for (i = 0, l = parts.length; i < l; i += 1) {
    name += parts[i].name + "()";
  }

  return name;
}

function countsFromParts(parts) {
  var counts, i, l, part;

  counts = [];

  for (i = 0, l = parts.length; i < l; i += 1) {
    part = parts[i];
    counts.push([ part.generics.length, part.parameters.length ]);
  }

  return counts;
}

function fromRealType(type, empty, unknown) {
  var i, l, methodTypes, parts, signatures;

  signatures = type.object.signatures;
  methodTypes = [];

  for (i = 0, l = signatures.length; i < l; i += 1) {
    parts = signatures[i].parts;
    methodTypes.push(new MethodType(nameFromParts(parts),
      countsFromParts(parts), unknown));
  }

  methodTypes = defs.set(methodTypes);

  function ObjectType() {
    this.methods = rt.method("methods", 0, function () {
      return methodTypes;
    });

    this.asString = rt.method("asString", 0, function () {
      return type.asString();
    });
  }

  ObjectType.prototype = empty;

  return new ObjectType();
}

Mirror.prototype.insertInto_withEmpty_unknown_pattern =
  rt.method("insertInto() withEmpty() unknown() pattern()",
  [ 1, 1, 1, 1 ], function (map, empty, unknown, pattern) {
    var elements, object;

    map = map[0];
    empty = empty[0];
    unknown = unknown[0];
    pattern = pattern[0];

    object = this.object;
    elements = map.object.elements;

    util.forProperties(object, function (name, value) {
      var mType, result;

      if (value.isGraceMethod) {
        mType = new MethodType(value.identifier, value.parts, unknown);

        if (value.isStatic && value.value) {
          result = value.value;

          if (result.object && result.object.signatures) {
            mType.returnType = pattern;
            mType.value = fromRealType(result, empty, unknown);
          }
        }

        elements.push(new Entry(defs.string(name), mType));
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

Mirror.prototype.asObjectTypeWithEmpty_unknown =
  rt.method("asObjectTypeWithEmpty() unknown()", [ 1, 1 ],
    function (empty, unknown) {
      return fromRealType(this.object, empty[0], unknown[0]);
    });
