// Primitive Grace definitions in JavaScript.

"use strict";

var Task, defs, rt, unicode, util;

Task = require("../task");
rt = require("../runtime");
defs = require("./definitions");
unicode = require("../unicode");
util = require("../util");

function addMethod(constructor, name) {
  constructor.prototype[util.uglify(name)] =
    rt.newMethod.apply(rt, util.slice(arguments, 1));
}

function GraceObject() {
  return this;
}

GraceObject.isInternal = true;

addMethod(GraceObject, "==", 1, function (value) {
  return defs.bool(this === value);
});

addMethod(GraceObject, "!=", 1, function (value) {
  return this["=="](value).then(function (result) {
    return result["prefix!"];
  });
});

function asString(self) {
  var methods;

  methods = [];
  util.forAllProperties(self, function (key, method) {
    if (typeof method === "function" &&
        !method.isInternal &&
        key !== "==" && key !== "!=" && key !== "asString") {
      methods.push("method " + (method.identifier || key));
    }
  });

  return "object {" + (methods.length === 0 ? "" :
      methods.length === 1 ? " " + methods[0] + " " :
          "\n  " + methods.join("\n  ") + "\n") + "}";
}

addMethod(GraceObject, "asString", 0, function () {
  return defs.string(asString(this));
});

GraceObject.prototype.toString = function () {
  var error, string;

  string = null;
  error = null;

  function reject(reason) {
    error = reason;
  }

  rt.apply(this, this.asString, [[]]).now().then(function (value) {
    rt.apply(value, value.asPrimitiveString, [[]]).now()
      .then(function (value) {
        string = value;
      }, reject);
  }, reject);

  if (error !== null) {
    throw error;
  }

  if (string === null || string.toString === GraceObject.prototype.toString) {
    return asString(this);
  }

  return string.toString();
};

GraceObject.prototype.toString.isInternal = true;

function object() {
  return new GraceObject();
}

function isGraceObject(value) {
  return value instanceof GraceObject;
}

function AbstractBoolean() {
  return this;
}

util.inherits(AbstractBoolean, GraceObject);

addMethod(AbstractBoolean, "andAlso()", [[1, 1]], function (T, action) {
  var self = this;

  return defs.Action.assert(action).then(function () {
    return self.andAlso_orElse(rt.part([T], [rt.block(0, function () {
      return action.apply();
    })]), [rt.block(0, function () {
      return self;
    })]);
  });
});

addMethod(AbstractBoolean, "orElse()", [[1, 1]], function (T, action) {
  var self = this;

  return defs.Action.assert(action).then(function () {
    return self.andAlso_orElse([rt.block(0, function () {
      return self;
    })], rt.part(T, [rt.block(0, function () {
      return action.apply();
    })]));
  });
});

addMethod(AbstractBoolean, "&&", 1, function (rhs) {
  var self = this;

  return defs.Bool.assert(rhs).then(function () {
    return self.andAlso(rt.part([defs.Bool], [rt.block(0, function () {
      return rhs;
    })]));
  });
});

addMethod(AbstractBoolean, "||", 1, function (rhs) {
  var self = this;

  return defs.Bool.assert(rhs).then(function () {
    return self.orElse(rt.part([defs.Bool], [rt.block(0, function () {
      return rhs;
    })]));
  });
});

addMethod(AbstractBoolean, "prefix!", 0, function () {
  return this.andAlso_orElse(rt.part([defs.Bool], [rt.block(0, function () {
    return defs.bool(false);
  })]), rt.part([defs.Bool], [rt.block(0, function () {
    return defs.bool(true);
  })]));
});

function buildAndAlsoOrElse(index) {
  return function () {
    return arguments[index][1].apply();
  };
}

function True() {
  return this;
}

util.inherits(True, AbstractBoolean);

addMethod(True, "andAlso() orElse()", [[1, 1], [1, 1]], buildAndAlsoOrElse(0));

addMethod(True, "asString", 0, function () {
  return defs.string("true");
});

function False() {
  return this;
}

util.inherits(False, AbstractBoolean);

addMethod(False, "andAlso() orElse()", [[1, 1], [1, 1]], buildAndAlsoOrElse(1));

addMethod(False, "asString", 0, function () {
  return defs.string("false");
});

// TODO Implement arbitrary size.
function GraceNumber(value) {
  value = Number(value);
  this.asPrimitiveNumber = rt.newMethod("asPrimitiveNumber", 0, function () {
    return value;
  });
}

util.inherits(GraceNumber, GraceObject);

addMethod(GraceNumber, "prefix-", 0, function () {
  return this.asPrimitiveNumber().then(function (value) {
    return defs.number(-value);
  });
});

function binaryNum(func) {
  return function (rhs) {
    return defs.Num.assert(rhs).then(function () {
      return this.asPrimitiveNumber().then(function (fst) {
        return rhs.asPrimtiiveNumber().then(function (snd) {
          return new GraceNumber(func(fst, snd));
        });
      });
    });
  };
}

addMethod(GraceNumber, "+", 1, binaryNum(function (fst, snd) {
  return fst + snd;
}));

addMethod(GraceNumber, "-", 1, binaryNum(function (fst, snd) {
  return fst - snd;
}));

addMethod(GraceNumber, "*", 1, binaryNum(function (fst, snd) {
  return fst * snd;
}));

addMethod(GraceNumber, "/", 1, binaryNum(function (fst, snd) {
  return fst / snd;
}));

addMethod(GraceNumber, "^", 1, binaryNum(function (fst, snd) {
  return Math.pow(fst, snd);
}));

addMethod(GraceNumber, "asString", 0, function () {
  return this.asPrimitiveNumber().then(function (value) {
    return defs.string(value.toString());
  });
});

function GraceString(value) {
  value = String(value);
  this.asPrimitiveString = rt.newMethod("asPrimitiveString", function () {
    return value;
  });
}

util.inherits(GraceString, GraceObject);

addMethod(GraceString, "asString", 0, function () {
  return this.asPrimitiveString().then(function (value) {
    return defs.string("\"" + unicode.escape(value) + "\"");
  });
});

addMethod(GraceString, "++", 1, function (rhs) {
  var self = this;

  return self.asPrimitiveString().then(function (fst) {
    return defs.String.match(rhs).then(function (isString) {
      return isString.andAlso_orElse([rt.block(0, function () {
        return rhs;
      })], [rt.block(0, function () {
        return rhs.asString();
      })]).then(function (snd) {
        return snd.asPrimitiveString().then(function (snd) {
          return new GraceString(fst + snd);
        });
      });
    });
  });
});

function AbstractPattern() {
  return this;
}

util.inherits(AbstractPattern, GraceObject);

function dirPattern(name) {
  return function (rhs) {
    var lhs = this;

    defs.Pattern.assert(rhs).then(function () {
      var pattern = new AbstractPattern();
      pattern.match = rt.newMethod("match", 1, function (value) {
        return lhs.match(value).then(function (match) {
          return defs.Bool.assert(match).then(function () {
            return match[name](rt.block(0, function () {
              return rhs.match(value);
            }));
          });
        });
      });

      return pattern;
    });
  };
}

addMethod(AbstractPattern, "&", 1, dirPattern("andAlso"));

addMethod(AbstractPattern, "|", 1, dirPattern("orElse"));

addMethod(AbstractPattern, "assert()", 1, function (value) {
  var self = this;

  return this.match(value).then(function (result) {
    return result.orElse(rt.block(0, function () {
      throw value + " does not match pattern " + self;
    }));
  });
});

function Type(name, names) {
  if (util.isArray(names)) {
    this.asString = rt.newMethod("asString", 0, function () {
      return defs.string(name);
    });
  } else {
    names = name;
  }

  this.names = rt.newMethod("names", 0, function () {
    return names;
  });
}

util.inherits(Type, AbstractPattern);

addMethod(Type, "match()", 1, function (value) {
  return this.names().then(function (names) {
    return new Task(function (resolve, reject) {
      return Task.each(names, function (name) {
        return new Task(function (next) {
          if (typeof value[util.uglify(name)] === "function") {
            next();
          } else {
            resolve(defs.failure(value));
          }
        });
      }).then(function () {
        resolve(defs.success(value));
      }, reject);
    });
  });
});

addMethod(Type, "asString", 0, function () {
  return this.names().then(function (names) {
    var l, sep;

    l = names.length;
    sep = l === 0 ? "" : l === 1 ? " " : "\n  ";

    return defs.string("type {" + sep + names.join("\n  ") + sep + "}");
  });
});

// A proxy for hoisted type declarations that will be filled out with the values
// of a real type once the actual value is built. As such, the proxy can be
// combined with other patterns and be tested for equality, but it cannot be
// matched or stringified.
function TypeProxy() {
  return this;
}

util.inherits(TypeProxy, AbstractPattern);

addMethod(TypeProxy, "match()", 1, function () {
  throw "The type is not yet instantiated";
});

addMethod(TypeProxy, "asString", 0, function () {
  throw "The type is not yet instantiated";
});

function NamedPattern(name, pattern) {
  this.name = rt.newMethod("name", function () {
    return name;
  });

  this.pattern = rt.newMethod("pattern", function () {
    return pattern;
  });
}

util.inherits(NamedPattern, AbstractPattern);

addMethod(NamedPattern, "match()", 1, function (value) {
  return this.pattern().then(function (pattern) {
    return pattern.match(value);
  });
});

addMethod(NamedPattern, "asString", 0, function () {
  var self = this;

  return this.name().then(function (name) {
    return self.pattern().then(function (pattern) {
      return defs.string(name.toString() +
          (pattern === defs.Unknown ? "" : " : " + pattern));
    });
  });
});

function matchAsString(name) {
  return function () {
    return this.value().then(function (value) {
      return value.asString().then(function (string) {
        return string.asPrimitiveString().then(function (string) {
          return defs.string(name + "(" + string + ")");
        });
      });
    });
  };
}

function Success(value) {
  this.value = rt.newMethod("value", 0, function () {
    return value;
  });
}

util.inherits(Success, True);

addMethod(Success, "asString", 0, matchAsString("success"));

function Failure(value) {
  this.value = rt.newMethod("value", 0, function () {
    return value;
  });
}

util.inherits(Failure, False);

addMethod(Failure, "asString", 0, matchAsString("failure"));

function List(elements) {
  var size = elements.length;

  this.at = rt.newMethod("at()", 1, function (index) {
    return defs.Number.assert(index).then(function () {
      return index.asPrimitiveNumber().then(function (index) {
        if (index < 1 || index > size) {
          throw "List out of bounds exception for index " + index;
        }

        return elements[index - 1];
      });
    });
  });

  this.size = rt.newMethod("size", 0, function () {
    return defs.number(size);
  });
}

util.inherits(List, GraceObject);

addMethod(List, "doForEach()", [[1, 1]], function (T, action) {
  var self = this;

  return defs.Action.assert(action).then(function () {
    return self.size().then(function (size) {
      return size.asPrimitiveNumber().then(function (size) {
        return Task.each(size, function (i) {
          return self.at(defs.number(i + 1)).then(function (element) {
            return action.apply(element).then(function (result) {
              return T.assert(result);
            });
          });
        });
      });
    });
  }).then(function () {
    return defs.done;
  });
});

function getElements(self) {
  var elements = [];

  return self.doForEach(rt.block(1, function (element) {
    elements.push(element);
  })).then(function () {
    return elements;
  });
}

addMethod(List, "++", 1, function (rhs) {
  return getElements(this).then(function (lhs) {
    return getElements(rhs).then(function (rhs) {
      return defs.list(lhs.concat(rhs));
    });
  });
});

addMethod(List, "asString", 0, function () {
  return getElements(this).then(function (elements) {
    return defs.string("[" + elements.join(",") + "]");
  });
});

function ListPattern(pattern) {
  this.pattern = rt.newMethod("pattern", 0, function () {
    return pattern;
  });
}

util.inherits(ListPattern, AbstractPattern);

addMethod(ListPattern, "match()", 1, function (list) {
  return this.pattern().then(function (pattern) {
    return new Task(function (resolve, reject) {
      defs.List.match(list).then(function (isList) {
        return isList.andAlso_orElse([rt.block(0, function () {
          return list.doForEach(rt.block(1, function (value) {
            return new Task(function (next) {
              pattern.match(value).then(function (matched) {
                return matched.andAlso_orElse([rt.block(0, function () {
                  next();
                })], [rt.block(0, function () {
                  resolve(defs.failure(list));
                })]);
              });
            });
          })).then(function () {
            return defs.success(list);
          });
        })], [rt.block(0, function () {
          return defs.failure(list);
        })]);
      }).then(resolve, reject);
    });
  });
});

addMethod(ListPattern, "asString", 0, function () {
  return this.pattern().then(function (pattern) {
    return pattern.asString().then(function (string) {
      return string.asPrimitiveString().then(function (string) {
        return defs.string("List<" + string + ">");
      });
    });
  });
});

exports.GraceObject = GraceObject;
exports.True = True;
exports.False = False;
exports.GraceString = GraceString;
exports.GraceNumber = GraceNumber;
exports.AbstractPattern = AbstractPattern;
exports.Type = Type;
exports.TypeProxy = TypeProxy;
exports.NamedPattern = NamedPattern;
exports.Success = Success;
exports.Failure = Failure;
exports.List = List;
exports.ListPattern = ListPattern;

