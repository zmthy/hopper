// Primitive Grace definitions in JavaScript.

"use strict";

var Task, defs, rt, util;

Task = require("../task");
rt = require("../runtime");
defs = require("./definitions");
util = require("../util");

function addMethod(Constructor, name) {
  Constructor.prototype[util.uglify(name)] =
    rt.method.apply(rt, util.slice(arguments, 1));
}

function addConstructor(Constructor, name) {
  Constructor.prototype[util.uglify(name)] =
    rt.constructor.apply(rt, util.slice(arguments, 1));
}

function toNumber(raw) {
  return defs.Number.cast(raw).then(function (number) {
    return number.asPrimitiveNumber();
  });
}

function toString(raw) {
  return defs.String.cast(raw).then(function (string) {
    return string.asPrimitiveString();
  });
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
    return result["prefix!"]().then(function (notted) {
      return defs.Boolean.assert(notted).then(function () {
        return notted;
      });
    });
  });
});

addMethod(GraceObject, "asString", 0, function () {
  return defs.string("object");
});

function asString(value) {
  return rt.apply(value, "asString").then(function (string) {
    return toString(string);
  });
}

exports.asString = asString;

GraceObject.prototype.toString = function () {
  var error, string;

  string = null;
  error = null;

  asString(this).now(function (value) {
    string = value;
  }, rt.handleInternalError).then(null, function (reason) {
    error = new Error("Unable to render exception message");

    reason.exception().then(function (exception) {
      return exception.name().then(function (name) {
        return toString(name).then(function (nameString) {
          error.name = nameString;
        });
      });
    }).then(function () {
      return reason.message().then(function (message) {
        return toString(message).then(function (messageString) {
          error.message = messageString;
        });
      });
    }).now();
  });

  if (error !== null) {
    throw error;
  }

  if (string === null || string.toString === GraceObject.prototype.toString) {
    return "object";
  }

  return string.toString();
};

GraceObject.prototype.toString.isInternal = true;

function AbstractPattern() {
  return this;
}

util.inherits(AbstractPattern, GraceObject);

function dirPattern(name, branch) {
  return function (rawRhs) {
    var self = this;

    return defs.Pattern.cast(rawRhs).then(function (rhs) {
      var pattern = new AbstractPattern();

      pattern.match = rt.method("match()", 1, function (value) {
        return self.match(value).then(function (rawMatch) {
          return defs.Boolean.cast(rawMatch).then(function (match) {
            return match[branch](defs.block(0, function () {
              return rhs.match(value);
            }));
          });
        });
      });

      pattern.asString = rt.method("asString", 0, function () {
        return self.asString().then(function (string) {
          return rt.string(name + "(")["++"](string);
        }).then(function (string) {
          return string["++"](rt.string(", "));
        }).then(function (string) {
          return rhs.asString().then(function (rhsString) {
            return string["++"](rhsString);
          });
        }).then(function (string) {
          return string["++"](rt.string(")"));
        });
      });

      return pattern;
    });
  };
}

addMethod(AbstractPattern, "&", 1, dirPattern("Both", "andAlso"));

addMethod(AbstractPattern, "|", 1, dirPattern("Either", "orElse"));

addMethod(AbstractPattern, "assert()", 1, function (value) {
  var packet, self;

  self = this;
  packet = null;

  return self.match(value).then(function (result) {
    return result.orElse(defs.block(0, function () {
      return defs.AssertionFailure
        .raiseForValue_againstPattern([ value ], [ self ])
        .then(null, function (error) {
          packet = error;
          throw packet;
        });
    }));
  }).then(null, function () {
    var trace;

    if (packet !== null) {
      trace = packet.object.stackTrace;
      trace.splice(trace.length - 3, 3);
    }

    throw packet;
  });
});

addMethod(AbstractPattern, "==", 1, function (value) {
  var self = this;

  if (self === value) {
    return defs.bool(true);
  }

  return defs.Pattern.match(value).then(function (isPattern) {
    return isPattern.andAlso(rt.block(0, function () {
      return self["<:"](value).then(function (isSub) {
        return isSub.andAlso(rt.block(0, function () {
          return value["<:"](self);
        }));
      });
    }));
  });
});

addMethod(AbstractPattern, "<:", 1, function (pattern) {
  if (this === pattern || pattern === defs.Unknown) {
    return defs.bool(true);
  }

  return defs.Pattern.assert(pattern).then(function () {
    return defs.bool(false);
  });
});

addMethod(AbstractPattern, ":>", 1, function (pattern) {
  var self = this;

  if (this === pattern || pattern === defs.Unknown) {
    return defs.bool(true);
  }

  return defs.Pattern.assert(pattern).then(function () {
    return pattern["<:"](self).then(function (result) {
      return result;
    });
  });
});

// By default, 1-arity blocks created by the constructor below do not have a
// specified pattern and so will succeed so long as the block itself returns a
// value.
function blockMatch(object) {
  var self = this;

  return self.apply(object).then(function (result) {
    return defs.success(result, self);
  });
}

function Block(parameters, apply) {
  var paramCount;

  AbstractPattern.call(this);

  paramCount = typeof parameters === "number" ? parameters : parameters[1];

  this.apply =
    rt.method("apply" + (paramCount === 0 ? "" : "()"), [ parameters ], apply);

  this.asString = rt.method("asString", 0, function () {
    return defs.string("block/" + paramCount);
  });

  if (paramCount === 1) {
    this.match = rt.method("match()", 1, blockMatch);

    // Blocks without patterns act as Unknown by default.
    this["<:"] = rt.method("<:", 1, function () {
      return defs.bool(true);
    });

    this[":>"] = rt.method(":>", 1, function () {
      return defs.bool(true);
    });
  }
}

util.inherits(Block, AbstractPattern);

addMethod(Block, "asPrimitive", function () {
  return this.apply;
});

function AbstractBoolean() {
  AbstractPattern.call(this);
}

util.inherits(AbstractBoolean, AbstractPattern);

addMethod(AbstractBoolean, "match()", 1, function (against) {
  return defs.equalityMatch(this, against);
});

addMethod(AbstractBoolean, "ifTrue()", 1, function (action) {
  var self = this;

  return defs.Action.assert(action).then(function () {
    return self.ifTrue_ifFalse([ action ], [ defs.emptyBlock ]);
  }).then(function () {
    return rt.done;
  });
});

addMethod(AbstractBoolean, "ifFalse()", 1, function (action) {
  var self = this;

  return defs.Action.assert(action).then(function () {
    return self.ifTrue_ifFalse([ defs.emptyBlock ], [ action ]);
  }).then(function () {
    return rt.done;
  });
});

addMethod(AbstractBoolean, "andAlso() orElse()", [ 1, 1 ], function (fst, snd) {
  var self = this;

  fst = fst[0];
  snd = snd[0];

  return defs.Action.assert(fst).then(function () {
    return defs.Action.assert(snd);
  }).then(function () {
    return self.ifTrue_ifFalse(rt.part([ defs.Boolean ], fst),
      rt.part([ defs.Boolean ], snd));
  });
});

addMethod(AbstractBoolean, "andAlso()", 1, function (action) {
  var self = this;

  return defs.Action.assert(action).then(function () {
    return self.ifTrue_ifFalse(rt.part([ defs.Boolean ], [ action ]),
      rt.part([ defs.Boolean ], [
        defs.block(0, function () {
          return self;
        })
      ]));
  });
});

addMethod(AbstractBoolean, "orElse()", 1, function (action) {
  var self = this;

  // TODO Type check parameters, pass generics.
  return self.ifTrue_ifFalse([
    defs.block(0, function () {
      return self;
    })
  ], [ action ]);
});

addMethod(AbstractBoolean, "&&", 1, function (rhs) {
  var self = this;

  return defs.Boolean.assert(rhs).then(function () {
    return self.andAlso(defs.block(0, function () {
      return rhs;
    }));
  });
});

addMethod(AbstractBoolean, "||", 1, function (rhs) {
  var self = this;

  return defs.Boolean.assert(rhs).then(function () {
    return self.orElse(defs.block(0, function () {
      return rhs;
    }));
  });
});

addMethod(AbstractBoolean, "prefix!", 0, function () {
  return this.andAlso_orElse([
    defs.block(0, function () {
      return defs.bool(false);
    })
  ], [
    defs.block(0, function () {
      return defs.bool(true);
    })
  ]);
});

addMethod(AbstractBoolean, "asBoolean", 0, function () {
  return this.andAlso_orElse([
    defs.block(0, function () {
      return defs.bool(true);
    })
  ], [
    defs.block(0, function () {
      return defs.bool(false);
    })
  ]);
});

addMethod(AbstractBoolean, "asPrimitive", 0, function () {
  return this.asPrimitiveBoolean();
});

function addIfTrueIfFalse(Ctor, index) {
  addMethod(Ctor, "ifTrue() ifFalse()", [ [ 1, 1 ], [ 1, 1 ] ], function () {
    var action, part;

    part = arguments[index];
    action = part[1];

    // TODO Type check arguments and result.
    return action.apply();
  });
}

function True() {
  return this;
}

util.inherits(True, AbstractBoolean);

addIfTrueIfFalse(True, 0);

addMethod(True, "asPrimitiveBoolean", 0, function () {
  return true;
});

addMethod(True, "asString", 0, function () {
  return defs.string("true");
});

function False() {
  return this;
}

util.inherits(False, AbstractBoolean);

addIfTrueIfFalse(False, 1);

addMethod(False, "asPrimitiveBoolean", 0, function () {
  return false;
});

addMethod(False, "asString", 0, function () {
  return defs.string("false");
});

function binaryOp(func, type) {
  return function (rawRhs) {
    var self = this;

    return defs[type].cast(rawRhs).then(function (rhs) {
      return self["asPrimitive" + type]().then(function (fst) {
        return rhs["asPrimitive" + type]().then(function (snd) {
          return func(fst, snd);
        });
      });
    });
  };
}

// TODO Implement arbitrary size.
function GraceNumber(value) {
  AbstractPattern.call(this);

  value = Number(value);

  this.asPrimitiveNumber = rt.method("asPrimitiveNumber", 0, function () {
    return value;
  });
}

util.inherits(GraceNumber, AbstractPattern);

addMethod(GraceNumber, "asPrimitive", 0, function () {
  return this.asPrimitiveNumber();
});

addMethod(GraceNumber, "==", 1, function (rhs) {
  var self = this;

  return defs.Number.match(rhs).then(function (isNumber) {
    return isNumber.andAlso_orElse([
      defs.block(0, function () {
        return self.asPrimitiveNumber().then(function (primSelf) {
          return rhs.asPrimitiveNumber().then(function (primRhs) {
            return defs.bool(primSelf === primRhs);
          });
        });
      })
    ], [
      defs.block(0, function () {
        return defs.bool(false);
      })
    ]);
  });
});

addMethod(GraceNumber, "match()", 1, function (against) {
  return defs.equalityMatch(this, against);
});

addMethod(GraceNumber, "prefix-", 0, function () {
  return this.asPrimitiveNumber().then(function (value) {
    return defs.number(-value);
  });
});

function binaryNum(func) {
  return binaryOp(function (fst, snd) {
    return new GraceNumber(func(fst, snd));
  }, "Number");
}

function binaryNumCmp(func) {
  return binaryOp(function (fst, snd) {
    return defs.bool(func(fst, snd));
  }, "Number");
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

addMethod(GraceNumber, "/", 1, binaryOp(function (fst, snd) {
  if (snd === 0) {
    return rt.NotANumber.raiseDivideByZero().then(null, function (packet) {
      packet.object.stackTrace = [];
      throw packet;
    });
  }

  return new GraceNumber(fst / snd);
}, "Number"));

addMethod(GraceNumber, "%", 1, binaryNum(function (fst, snd) {
  return fst % snd;
}));

addMethod(GraceNumber, "^", 1, binaryNum(function (fst, snd) {
  return Math.pow(fst, snd);
}));

addMethod(GraceNumber, "<", 1, binaryNumCmp(function (fst, snd) {
  return fst < snd;
}));

addMethod(GraceNumber, "<=", 1, binaryNumCmp(function (fst, snd) {
  return fst <= snd;
}));

addMethod(GraceNumber, ">", 1, binaryNumCmp(function (fst, snd) {
  return fst > snd;
}));

addMethod(GraceNumber, ">=", 1, binaryNumCmp(function (fst, snd) {
  return fst >= snd;
}));

function addMath(name, method, arg) {
  method = method || name;

  addMethod(GraceNumber, name, 0, function () {
    return this.asPrimitiveNumber().then(function (value) {
      var result = Math[method](value, arg);

      if (isNaN(result)) {
        return defs.NotANumber.raiseForOperation_on([ method ], [ value ]);
      }

      return new GraceNumber(result);
    });
  });
}

addMath("absolute", "abs");
addMath("round");
addMath("floor");
addMath("ceiling", "ceil");
addMath("log");
addMath("exponent", "exp");
addMath("sin");
addMath("cos");
addMath("tan");
addMath("asin");
addMath("acos");
addMath("atan");
addMath("square", "pow", 2);
addMath("cube", "pow", 3);
addMath("squareRoot", "sqrt");

addMethod(GraceNumber, "asString", 0, function () {
  return this.asPrimitiveNumber().then(function (value) {
    return defs.string(value.toString());
  });
});

function GraceString(value) {
  AbstractPattern.call(this);

  value = String(value);
  this.asPrimitiveString = rt.method("asPrimitiveString", function () {
    return value;
  });
}

util.inherits(GraceString, AbstractPattern);

addMethod(GraceString, "asPrimitive", 0, function () {
  return this.asPrimitiveString();
});

addMethod(GraceString, "==", 1, function (rhs) {
  var self = this;

  return defs.String.match(rhs).then(function (isNumber) {
    return isNumber.andAlso_orElse([
      defs.block(0, function () {
        return self.asPrimitiveString().then(function (primSelf) {
          return rhs.asPrimitiveString().then(function (primRhs) {
            return defs.bool(primSelf === primRhs);
          });
        });
      })
    ], [
      defs.block(0, function () {
        return defs.bool(false);
      })
    ]);
  });
});

addMethod(GraceString, "match()", 1, function (against) {
  return defs.equalityMatch(this, against);
});

addMethod(GraceString, "at()", 1, function (rawIndex) {
  return defs.Number.cast(rawIndex).then(function (index) {
    return this.asPrimitiveString().then(function (string) {
      return index.asPrimitiveNumber().then(function (primIndex) {
        return defs.string(string[primIndex - 1]);
      });
    });
  });
});

addMethod(GraceString, "size", 0, function () {
  return this.asPrimitiveString().then(function (string) {
    return rt.number(string.length);
  });
});

addMethod(GraceString, "do()", 1, function (rawAction) {
  var self = this;

  return defs.Function.cast(rawAction).then(function (action) {
    return self.asPrimitiveString().then(function (string) {
      return Task.each(string, function (character) {
        return action.apply(defs.string(character));
      });
    }).then(function () {
      return defs.done;
    });
  });
});

function binaryStrCmp(func) {
  return binaryOp(function (fst, snd) {
    return defs.bool(func(fst, snd));
  }, "String");
}

addMethod(GraceString, "<", 1, binaryStrCmp(function (fst, snd) {
  return fst < snd;
}));

addMethod(GraceString, "<=", 1, binaryStrCmp(function (fst, snd) {
  return fst <= snd;
}));

addMethod(GraceString, ">", 1, binaryStrCmp(function (fst, snd) {
  return fst > snd;
}));

addMethod(GraceString, ">=", 1, binaryStrCmp(function (fst, snd) {
  return fst >= snd;
}));

addMethod(GraceString, "++", 1, function (rhs) {
  var self = this;

  return self.asPrimitiveString().then(function (primSelf) {
    return defs.String.match(rhs).then(function (isString) {
      return isString.andAlso_orElse([
        defs.block(0, function () {
          return rhs;
        })
      ], [
        defs.block(0, function () {
          return rt.apply(rhs, "asString");
        })
      ]).then(function (snd) {
        return snd.asPrimitiveString().then(function (primSnd) {
          return defs.string(primSelf + primSnd);
        });
      });
    });
  });
});

addMethod(GraceString, "fold() startingWith()", [ [ 1, 1 ], 1 ],
  function (part, value) {
    var pattern, self;

    self = this;
    pattern = part[0];
    value = value[0];

    return defs.Function2.cast(part[1]).then(function (fold) {
      return self["do"](rt.block(1, function (element) {
        return fold.apply(value, element).then(function (result) {
          return pattern.assert(result).then(function () {
            value = result;
            return rt.done;
          });
        });
      })).then(function () {
        return value;
      });
    });
  });

addMethod(GraceString, "asNumber", 0, function () {
  var self = this;

  return self.asPrimitiveString().then(function (value) {
    var number = Number(value);

    if (isNaN(number)) {
      return rt.NotANumber.raiseForParse(self).then(null, function (packet) {
        packet.object.stackTrace = [];
        throw packet;
      });
    }

    return defs.number(number);
  });
});

addMethod(GraceString, "substringFrom() to()", [ 1, 1 ], function (pFrom, pTo) {
  var self = this;

  return toNumber(pFrom[0]).then(function (from) {
    return toNumber(pTo[0]).then(function (to) {
      return self.asPrimitiveString().then(function (primSelf) {
        if (from < 1 || from > primSelf.length + 1) {
          return defs.OutOfBounds.raiseForIndex(defs.number(from));
        }

        if (to < 1 || to > primSelf.length + 1) {
          return defs.OutOfBounds.raiseForIndex(defs.number(to));
        }

        return defs.string(primSelf.substring(from - 1, to - 1));
      });
    });
  });
});

addMethod(GraceString, "substringFrom() size()", [ 1, 1 ],
  function (pFrom, pSize) {
    var self = this;

    return toNumber(pFrom[0]).then(function (from) {
      return toNumber(pSize[0]).then(function (size) {
        return self.asPrimitiveString().then(function (primSelf) {
          var to = from + size;

          if (from < 1 || from > primSelf.length + 1) {
            return defs.OutOfBounds.raiseForIndex(defs.number(from));
          }

          if (to < 1 || to > primSelf.length + 1) {
            return defs.OutOfBounds.raiseForIndex(defs.number(to));
          }

          return defs.string(primSelf.substring(from - 1, to - 1));
        });
      });
    });
  });

addMethod(GraceString, "substringFrom()", 1, function (from) {
  var self = this;

  return self.asPrimitiveString().then(function (string) {
    return self.substringFrom_to([ from ], [ defs.number(string.length + 1) ]);
  });
});

addMethod(GraceString, "substringTo()", 1, function (to) {
  return this.substringFrom_to([ defs.number(1) ], [ to ]);
});

addMethod(GraceString, "replace() with()", [ 1, 1 ], function (pFrom, pTo) {
  var self = this;

  return toString(pFrom[0]).then(function (from) {
    return toString(pTo[0]).then(function (to) {
      return self.asPrimitiveString().then(function (primSelf) {
        return defs.string(primSelf.replace(from, to));
      });
    });
  });
});

addMethod(GraceString, "startsWith()", 1, function (rawPrefix) {
  var self = this;

  return toString(rawPrefix).then(function (prefix) {
    return self.asPrimitiveString().then(function (primSelf) {
      var index = prefix.length;

      if (index > primSelf.length) {
        return defs.bool(false);
      }

      return primSelf.lastIndexOf(prefix, index) === 0;
    });
  });
});

addMethod(GraceString, "endsWith()", 1, function (rawSuffix) {
  var self = this;

  return toString(rawSuffix).then(function (suffix) {
    return self.asPrimitiveString().then(function (primSelf) {
      var index = primSelf.length - suffix.length;

      if (index < 0) {
        return defs.bool(false);
      }

      return primSelf.indexOf(suffix, index) === index;
    });
  });
});

function addIndexOfs(forwards) {
  var defaultStart, method, name;

  method = forwards ? "indexOf" : "lastIndexOf";
  name = method + "_startingAt_ifAbsent";

  defaultStart = forwards ? function () {
    return Task.resolve(defs.number(1));
  } : function (string) {
    return string.asPrimitiveString().then(function (primString) {
      return defs.number(primString.length);
    });
  };

  addMethod(GraceString, method + "() startingAt() ifAbsent()",
    [ 1, 1, [ 1, 1 ] ], function (pSearch, pFrom, pIfAbsent) {
      var self = this;

      return toString(pSearch[0]).then(function (search) {
        return toNumber(pFrom[0]).then(function (from) {
          return defs.Action.cast(pIfAbsent[1]).then(function (absent) {
            return self.asPrimitiveString().then(function (primSelf) {
              var index;

              if (from < 0 || from > primSelf.length ||
                  from === 0 && primSelf.length !== 0) {
                return defs.OutOfBounds.raiseForIndex(defs.number(from));
              }

              index = primSelf[method](search, from - 1);

              if (index < 0) {
                return absent.apply().then(function (result) {
                  return pIfAbsent[0].assert(result).then(function () {
                    return result;
                  });
                });
              }

              return defs.number(index + 1);
            });
          });
        });
      });
    });

  addMethod(GraceString, method + "()", 1, function (search) {
    var self = this;

    return defaultStart(self).then(function (from) {
      return self[name]([ search ], [ from ], [
        defs.block(0, function () {
          return defs.FailedSearch.raiseForObject(search);
        })
      ]);
    });
  });

  addMethod(GraceString, method + "() startingAt()", [ 1, 1 ],
    function (search, from) {
      var self = this;

      return self[name](search, from, [
        defs.block(0, function () {
          return defs.FailedSearch.raiseForObject(search);
        })
      ]);
    });

  addMethod(GraceString, method + "() ifAbsent()", [ 1, [ 1, 1 ] ],
    function (search, absent) {
      var self = this;

      return defaultStart(self).then(function (from) {
        return self[name](search, [ from ], rt.part(absent[0], absent[1]));
      });
    });
}

addIndexOfs(true);
addIndexOfs(false);

addMethod(GraceString, "asString", 0, function () {
  return this.asPrimitiveString().then(function (value) {
    return defs.string("\"" + util.escape(value) + "\"");
  });
});

function Part(name, hasVarArg, generics, parameters) {
  if (typeof hasVarArg !== "boolean") {
    parameters = generics;
    generics = hasVarArg;
    hasVarArg = false;
  }

  if (generics === undefined) {
    parameters = [];
    generics = [];
  } else if (parameters === undefined) {
    parameters = generics;
    generics = [];
  }

  this.name = name;
  this.hasVarArg = hasVarArg;
  this.generics = generics;
  this.parameters = parameters;
}

Part.prototype.pretty = function () {
  return this.name + (this.parameters.length > 0 ? "()" : "");
};

Part.prototype.toString = function () {
  var generics, params;

  generics = this.generics;
  params = this.parameters;

  return this.name +
    (generics.length > 0 ? "<" + generics.join(", ") + ">" : "") +
    (params.length > 0 ? "(" + params.join(", ") + ")" : "");
};

function Signature(parts, hasVarArg, generics, parameters) {
  if (typeof parts === "string") {
    this.parts = [ new Part(parts, hasVarArg, generics, parameters) ];
  } else {
    this.parts = util.map(parts, function (part) {
      if (typeof part === "string") {
        return new Part(part, false, [], []);
      }

      return part;
    });
  }
}

Signature.prototype.name = function () {
  var i, l, name, parts;

  parts = this.parts;
  name = [];

  for (i = 0, l = parts.length; i < l; i += 1) {
    name.push(parts[i].pretty());
  }

  return name.join(" ");
};

Signature.prototype.toString = function () {
  return this.parts.join(" ");
};

function hasSignatures(pattern) {
  return pattern.object !== undefined &&
    util.isArray(pattern.object.signatures);
}

// A proxy for hoisted type declarations that will be filled out with the values
// of a real type once the actual value is built. As such, the proxy can be
// combined with other patterns and be tested for equality, but it cannot be
// matched or stringified.
function TypeProxy(name) {
  var self = this;

  this.object = {
    "dependents": [],

    "become": function (pattern) {
      var pname;

      if (pattern instanceof TypeProxy && pattern.object.become) {
        pattern.object.dependents.push(this);
        return Task.resolve();
      }

      if (pattern.object && pattern.object.signatures) {
        this.signatures = pattern.object.signatures;
      }

      for (pname in pattern) {
        if (!self.hasOwnProperty(pname) && pattern[pname] !== self[name]) {
          self[pname] = pattern[pname];
        }
      }

      delete this.become;

      return Task.each(this, this.dependents, function (dependent) {
        return dependent.become(self);
      }).then(function () {
        delete this.dependents;
      });
    }
  };

  if (name !== null) {
    this.asString = rt.method("asString", 0, function () {
      return defs.string(name);
    });
  }
}

util.inherits(TypeProxy, AbstractPattern);

addMethod(TypeProxy, "match()", 1, function () {
  return this.asString().then(function (name) {
    return defs.IncompleteType.raiseForName(name);
  });
});

function andWaitOn(andTask, lhs, rhs) {
  return andTask.then(function (and) {
    var become, hasLhs, hasRhs, proxy;

    proxy = new TypeProxy(null);
    proxy.asString = and.asString;

    if (lhs instanceof TypeProxy && lhs.object.become) {
      lhs.object.dependents.push(proxy.object);
      hasLhs = false;
    } else {
      hasLhs = true;
    }

    if (rhs instanceof TypeProxy && rhs.object.become) {
      rhs.object.dependents.push(proxy.object);
      hasRhs = false;
    } else {
      hasRhs = true;
    }

    become = proxy.object.become;
    proxy.object.become = function (becoming) {
      if (becoming === lhs && !hasRhs) {
        hasLhs = true;
      } else if (becoming === rhs && !hasLhs) {
        hasRhs = true;
      } else {
        return lhs["&"](rhs).then(function (joint) {
          return become.call(proxy.object, joint);
        });
      }

      return Task.resolve();
    };

    return proxy;
  });
}

addMethod(TypeProxy, "&", 1, function (pattern) {
  var and = AbstractPattern.prototype["&"].call(this, pattern);

  if (!(pattern instanceof TypeProxy || hasSignatures(pattern))) {
    return and;
  }

  return andWaitOn(and, this, pattern);
});

function Type(name, generics, extending, signatures) {
  var i, l;

  if (typeof name !== "string") {
    signatures = extending;
    extending = generics;
    generics = name;
    name = null;
  }

  if (typeof generics !== "number") {
    signatures = extending;
    extending = generics;
    generics = 0;
  }

  if (signatures === undefined) {
    signatures = extending;
    extending = null;
  } else if (util.isArray(extending)) {
    for (i = 0, l = extending.length; i < l; i += 1) {
      signatures = signatures.concat(extending[i].object.signatures);
    }
  } else {
    signatures = signatures.concat(extending.object.signatures);
  }

  this.object = {
    "generics": generics,
    "signatures": signatures
  };

  if (name !== null) {
    name = defs.string(name);

    this.asString = rt.method("asString", 0, function () {
      return name;
    });
  }
}

util.inherits(Type, AbstractPattern);

function typeMatch(type, value, onFail) {
  var i, l, method, name, parts, signature, signatures;

  signatures = type.object.signatures;

  for (i = 0, l = signatures.length; i < l; i += 1) {
    signature = signatures[i];
    name = signature.name();
    method = value[util.uglify(name)];
    parts = signature.parts;

    if (method === undefined) {
      return onFail(value, type, name);
    }

    if (typeof method === "function" && method.parts !== undefined) {
      if (!defs.isSubMethod(method.parts, parts)) {
        return onFail(value, type, name);
      }
    }
  }

  return defs.success(value, type);
}

addMethod(Type, "match()", 1, function (value) {
  return typeMatch(this, value, defs.failure);
});

addMethod(Type, "assert()", 1, function (value) {
  return typeMatch(this, value, function (val, type, name) {
    return defs.AssertionFailure.raiseForValue_againstType_missing([ val ],
      [ type ], [ rt.string(name) ]);
  });
});

addMethod(Type, "cast()", 1, function (value) {
  var self = this;

  return self.assert(value).then(function () {
    var i, l, name, object, pretty, signatures;

    if (defs.isGraceObject(value)) {
      return value;
    }

    signatures = self.object.signatures;

    object = defs.object();

    function makeMethod(mname) {
      return function () {
        return value[mname].apply(value, arguments);
      };
    }

    for (i = 0, l = signatures.length; i < l; i += 1) {
      pretty = signatures[i].name();
      name = util.uglify(pretty);

      object[name] = rt.method(pretty, makeMethod(name));
    }

    if (typeof value.object === "object") {
      object.object = value.object;
    }

    return object;
  });
});

addMethod(Type, "&", 1, function (pattern) {
  var andTask, self;

  self = this;
  andTask = AbstractPattern.prototype["&"].call(this, pattern);

  if (pattern instanceof TypeProxy && pattern.object.become) {
    return andWaitOn(andTask, this, pattern);
  }

  if (!hasSignatures(pattern)) {
    return andTask;
  }

  return andTask.then(function (and) {
    var type =
      new Type(self.object.signatures.concat(pattern.object.signatures));

    type.asString = and.asString;

    return type;
  });
});

addMethod(Type, "<:", function (pattern) {
  var signatures;

  if (this === pattern || pattern === defs.Unknown) {
    return defs.bool(true);
  }

  signatures = this.object.signatures;

  return defs.Pattern.assert(pattern).then(function () {
    if (hasSignatures(pattern)) {
      return new Task(function (resolve, reject) {
        return Task.each(pattern.object.signatures, function (sig1) {
          var i, j, k, l, name, parts1, parts2, sig2;

          name = sig1.name();

          for (i = 0, l = signatures.length; i < l; i += 1) {
            sig2 = signatures[i];

            if (sig2.name() === name) {
              parts1 = sig1.parts;
              parts2 = sig2.parts;

              for (j = 0, k = parts1.length; j < k; j += 1) {
                if (parts1[j].parameters.length !==
                    parts2[j].parameters.length) {
                  // The matching method has a different arity. Resolve to false
                  // and stop the loop.
                  resolve(defs.bool(false));
                  return Task.never();
                }
              }

              // Found an appropriate method, proceed to the next.
              return null;
            }
          }

          // Found no appropriate method. Resolve to false and stop the loop.
          resolve(defs.bool(false));
          return Task.never();
        }).then(function () {
          // Found all appropriate methods, resolve to true.
          resolve(defs.bool(true));
        }, reject);
      });
    }

    return defs.bool(false);
  });
});

addMethod(Type, "asString", 0, function () {
  var sep, signatures;

  signatures = this.object.signatures;
  sep = signatures.length === 0 ? "" : " ";

  return defs.string("type {" + sep + signatures.join("; ") + sep + "}");
});

function NamedPattern(name, pattern) {
  this.name = rt.method("name", function () {
    return name;
  });

  this.pattern = rt.method("pattern", function () {
    return pattern;
  });
}

util.inherits(NamedPattern, AbstractPattern);

addMethod(NamedPattern, "match()", 1, function (value) {
  return this.pattern().then(function (pattern) {
    return pattern.match(value);
  });
});

addMethod(NamedPattern, "assert()", 1, function (value) {
  return this.pattern().then(function (pattern) {
    return pattern.assert(value);
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
      return asString(value).then(function (string) {
        return defs.string(name + "(" + string + ")");
      });
    });
  };
}

function Success(value, pattern) {
  True.call(this);

  this.value = rt.method("value", 0, function () {
    return value;
  });

  this.pattern = rt.method("pattern", 0, function () {
    return pattern;
  });
}

util.inherits(Success, True);

addMethod(Success, "asString", 0, matchAsString("success"));

function Failure(value, pattern) {
  False.call(this);

  this.value = rt.method("value", 0, function () {
    return value;
  });

  this.pattern = rt.method("pattern", 0, function () {
    return pattern;
  });
}

util.inherits(Failure, False);

addMethod(Failure, "asString", 0, matchAsString("failure"));

function Sequence(elements) {
  this.object = {
    "elements": elements
  };
}

util.inherits(Sequence, GraceObject);

addMethod(Sequence, "at()", 1, function (num) {
  var elements = this.object.elements;

  return toNumber(num).then(function (index) {
    if (index < 1 || index > elements.length) {
      return defs.OutOfBounds.raiseForIndex(num);
    }

    return elements[index - 1];
  });
});

addMethod(Sequence, "size", 0, function () {
  return defs.number(this.object.elements.length);
});


addMethod(Sequence, "do()", 1, function (rawAction) {
  var elements = this.object.elements;

  return defs.Function.cast(rawAction).then(function (action) {
    return Task.each(elements, function (element) {
      return action.apply(element);
    });
  }).then(function () {
    return defs.done;
  });
});

addMethod(Sequence, "indices", 0, function () {
  var i, indices, l;

  indices = [];

  for (i = 1, l = this.object.elements.length; i <= l; i += 1) {
    indices.push(defs.number(i));
  }

  return new Sequence(indices);
});

function getElements(self) {
  var elements = [];

  return self["do"](defs.block(1, function (element) {
    elements.push(element);
    return rt.done;
  })).then(function () {
    return elements;
  });
}

addMethod(Sequence, "++", 1, function (rawRhs) {
  var elements = this.object.elements;

  return defs.Do.cast(rawRhs).then(function (rhs) {
    return getElements(rhs).then(function (rhsElements) {
      return defs.sequence(elements.concat(rhsElements));
    });
  });
});

addMethod(Sequence, "sliceFrom() to()", [ 1, 1 ], function (rawFrom, rawTo) {
  var elements = this.object.elements;

  return toNumber(rawFrom).then(function (from) {
    if (from < 1 || from > elements.length + 1) {
      return defs.OutOfBounds.raiseForIndex(defs.number(from));
    }

    return toNumber(rawTo).then(function (to) {
      if (to < 1 || to > elements.length + 1) {
        return defs.OutOfBounds.raiseForIndex(defs.number(to));
      }

      return new Sequence(elements.slice(from - 1, to - 1));
    });
  });
});

addMethod(Sequence, "sliceFrom() to()", [ 1, 1 ], function (rawFrom, rawTo) {
  var elements = this.object.elements;

  return toNumber(rawFrom).then(function (from) {
    if (from < 1 || from > elements.length + 1) {
      return defs.OutOfBounds.raiseForIndex(defs.number(from));
    }

    return toNumber(rawTo).then(function (to) {
      if (to < 1 || to > elements.length + 1) {
        return defs.OutOfBounds.raiseForIndex(defs.number(to));
      }

      return new Sequence(elements.slice(from - 1, to - 1));
    });
  });
});

addMethod(Sequence, "sliceFrom()", 1, function (from) {
  return this.sliceFrom_to(from, defs.number(this.object.elements.length + 1));
});

addMethod(Sequence, "sliceTo()", 1, function (to) {
  return this.sliceFrom_to(defs.number(1), to);
});

addMethod(Sequence, "fold() startingWith()", [ [ 1, 1 ], 1 ],
  function (fold, value) {
    var pattern = fold[0];

    fold = fold[1];
    value = value[0];

    return this["do"](rt.block(1, function (element) {
      return fold.apply(value, element).then(function (result) {
        return pattern.assert(result).then(function () {
          value = result;
          return rt.done;
        });
      });
    })).then(function () {
      return value;
    });
  });

addMethod(Sequence, "asPrimitiveArray", 0, function () {
  return this.object.elements.concat();
});

addMethod(Sequence, "asPrimitive", 0, function () {
  return Task.each(this.object.elements, function (element) {
    if (typeof element.asPrimitive === "function") {
      return element.asPrimitive();
    }

    return element;
  });
});

addMethod(Sequence, "asString", 0, function () {
  var self = this;

  if (this.object.elements.length === 0) {
    return defs.string("⟨⟩");
  }

  return self.at(defs.number(1)).then(function (head) {
    return rt.apply(head, "asString");
  }).then(function (head) {
    return defs.string("⟨")["++"](head);
  }).then(function (head) {
    return self.sliceFrom(defs.number(2)).then(function (rest) {
      return rest.fold_startingWith([
        rt.block(2, function (s, e) {
          return s["++"](defs.string(", ")).then(function (commafied) {
            return rt.apply(e, "asString").then(function (eString) {
              return commafied["++"](eString);
            });
          });
        })
      ], [ head ]);
    });
  }).then(function (s) {
    return s["++"](defs.string("⟩"));
  });
});

addMethod(Sequence, "internalPush()", 1, function (element) {
  this.object.elements.push(element);
  return rt.done;
});

Sequence.prototype.internalPush.isConfidential = true;

addMethod(Sequence, "internalSplice()", rt.gte(2),
  function (rawIndex, rawAmount) {
    var additions, elements;

    elements = this.object.elements;
    additions = util.slice(arguments, 2);

    return toNumber(rawIndex).then(function (index) {
      return toNumber(rawAmount).then(function (amount) {
        return elements
          .splice.apply(elements, [ index, amount ].concat(additions))[0];
      });
    });
  });

addMethod(Sequence, "internalPush()", 1, function (element) {
  this.object.elements.push(element);
  return rt.done;
});

Sequence.prototype.internalPush.isConfidential = true;

addMethod(Sequence, "internalSplice()", rt.gte(2),
  function (rawIndex, rawAmount) {
    var additions, elements;

    elements = this.object.elements;
    additions = util.slice(arguments, 2);

    return toNumber(rawIndex).then(function (index) {
      return toNumber(rawAmount).then(function (amount) {
        return elements
          .splice.apply(elements, [ index, amount ].concat(additions))[0];
      });
    });
  });

Sequence.prototype.internalSplice.isConfidential = true;

function SequencePattern(pattern) {
  this.pattern = rt.method("pattern", 0, function () {
    return pattern;
  });
}

util.inherits(SequencePattern, AbstractPattern);

addMethod(SequencePattern, "match()", 1, function (list) {
  var self = this;

  return self.pattern().then(function (pattern) {
    return new Task(function (resolve, reject) {
      defs.Sequence.match(list).then(function (isSequence) {
        return isSequence.ifTrue_ifFalse([
          defs.block(0, function () {
            return list["do"](defs.block(1, function (value) {
              return new Task(function (next, rejectIter) {
                pattern.match(value).then(function (matched) {
                  return matched.ifTrue_ifFalse([
                    defs.block(0, function () {
                      next(rt.done);
                      return Task.never();
                    })
                  ], [
                    defs.block(0, function () {
                      resolve(defs.failure(list, self));
                      return Task.never();
                    })
                  ]);
                }).then(null, rejectIter);
              });
            })).then(function () {
              return defs.success(list, self);
            });
          })
        ], [
          defs.block(0, function () {
            return defs.failure(list, self);
          })
        ]);
      }).then(resolve, reject);
    });
  });
});

addMethod(SequencePattern, "asString", 0, function () {
  return this.pattern().then(function (pattern) {
    return asString(pattern).then(function (string) {
      return defs.string("Sequence<" + string + ">");
    });
  });
});

function Trace(name, object, location) {
  var self = this;

  if (location === undefined) {
    location = object;
    object = null;
  }

  this.name = rt.method("name", 0, function () {
    return defs.string(name);
  });

  this.receiver = rt.method("receiver", 0, object === null ? function () {
    return defs.NoSuchValue
      .raiseForName_inObject([ defs.string("receiver") ], [ this ]);
  } : function () {
    return defs.string(object);
  });

  this.receiverOrIfAbsent = rt.method("receiverOrIfAbsent()", [ [ 1, 1 ] ],
    function (pAbsent) {
      var pattern = pAbsent[0];

      return defs.Action.cast(pAbsent[1]).then(function (absent) {
        if (object === null) {
          return absent.apply().then(function (result) {
            return pattern.assert(result).then(function () {
              return result;
            });
          });
        }

        return defs.string(object);
      });
    });

  function fromLocation(mname, type, prop) {
    self[mname] = rt.method(mname, 0,
      location === null || location[prop] === null ? function () {
        return defs.NoSuchValue
          .raiseForName_inObject([ defs.string(mname) ], [ self ]);
      } : function () {
        return defs[type](location[prop]);
      });

    self[mname + "OrIfAbsent"] = rt.method(mname + "OrIfAbsent", [ [ 1, 1 ] ],
      function (pAbsent) {
        var pattern = pAbsent[0];

        return defs.Action.cast(pAbsent[1]).then(function (absent) {
          if (location === null || location[prop] === null) {
            return absent.apply().then(function (result) {
              return pattern.assert(result).then(function () {
                return result;
              });
            });
          }

          return defs[type](location[prop]);
        });
      });
  }

  fromLocation("moduleName", "string", "module");
  fromLocation("lineNumber", "number", "line");
  fromLocation("columnNumber", "number", "column");

  this.asString = rt.method("asString", 0, function () {
    var trace = "at «" + name + "»";

    if (object !== null) {
      trace += " in «" + object + "»";
    }

    if (location !== null) {
      trace += " from ";

      if (location.module !== null) {
        trace += '"' + location.module + '" ';
      }

      trace += "(line " + location.line + ", column " + location.column + ")";
    }

    return defs.string(trace);
  });
}

util.inherits(Trace, GraceObject);

function Backtrace(traces) {
  Sequence.call(this, traces);
}

util.inherits(Backtrace, Sequence);

addMethod(Backtrace, "asString", 0, function () {
  var nl, once;

  nl = defs.string("\n");
  once = false;

  return this.fold_startingWith(rt.part(defs.String,
    rt.block(2, function (string, next) {
      return (once ? string["++"](nl) : Task.resolve(string))
        .then(function (preString) {
          once = true;
          return preString["++"](next);
        });
    })), [ defs.string("") ]);
});

function ExceptionPacket(exception, message) {
  if (message === undefined) {
    this.asString = rt.method("asString", 0, function () {
      return exception.name();
    });
  }

  message = message || defs.string("");

  this.exception = rt.method("exception", 0, function () {
    return exception;
  });

  this.message = rt.method("message", 0, function () {
    return message;
  });

  this.object = {
    "stackTrace": []
  };
}

util.inherits(ExceptionPacket, GraceObject);

function traceProperty(packet, name, type) {
  var i, l, location, trace;

  trace = packet.object.stackTrace;

  for (i = 0, l = trace.length; i < l; i += 1) {
    location = trace[i].location;

    if (location !== null && location[name] !== null) {
      return defs[type](location[name]);
    }
  }

  return defs.NoSuchValue
    .raiseForName_inObject([ defs.string(name) ], [ packet ]);
}

addMethod(ExceptionPacket, "moduleName", 0, function () {
  return traceProperty(this, "module", "string");
});

addMethod(ExceptionPacket, "lineNumber", 0, function () {
  return traceProperty(this, "line", "number");
});

addMethod(ExceptionPacket, "columnNumber", 0, function () {
  return traceProperty(this, "column", "number");
});

addMethod(ExceptionPacket, "backtrace", 0, function () {
  var backtrace, i, l, stack, trace;

  stack = this.object.stackTrace;
  backtrace = [];

  for (i = 0, l = stack.length; i < l; i += 1) {
    trace = stack[i];
    backtrace.push(new Trace(trace.name, trace.object, trace.location));
  }

  return new Backtrace(backtrace);
});

addMethod(ExceptionPacket, "raise", 0, function () {
  throw this;
});

addMethod(ExceptionPacket, "asString", 0, function () {
  var self = this;

  return self.exception().then(function (exception) {
    return exception.name().then(function (name) {
      return self.message().then(function (message) {
        return defs.string(": ")["++"](message).then(function (string) {
          return name["++"](string);
        });
      });
    });
  });
});

function Exception(name, Packet, parent) {
  this.object = {
    "name": name,
    "Packet": Packet
  };

  this.parent = rt.method("parent", 0, parent === undefined ? function () {
    return this;
  } : function () {
    return parent;
  });
}

util.inherits(Exception, AbstractPattern);

addMethod(Exception, "name", 0, function () {
  return this.object.name;
});

addMethod(Exception, "raise()", 1, function (message) {
  throw new this.object.Packet(this, message);
});

addMethod(Exception, "raiseDefault", 0, function () {
  throw new this.object.Packet(this);
});

addConstructor(Exception, "refine()", 1, function (inherit, name) {
  var Packet, self;

  self = this;
  Packet = this.object.Packet;

  function ChildPacket(exception, message) {
    Packet.call(this, exception, message);
  }

  util.inherits(ChildPacket, Packet);

  function ChildException() {
    Exception.call(this, name, ChildPacket, self);
  }

  ChildException.prototype = this;

  if (inherit !== null) {
    util.extendAll(inherit, ChildException.prototype);
    ChildException.call(inherit);
  }

  return Task.resolve(new ChildException());
});

addConstructor(Exception, "refine() defaultMessage()", [ 1, 1 ],
  function (inherit, name, defMessage) {
    var Packet, self;

    self = this;
    Packet = this.object.Packet;

    name = name[0];
    defMessage = defMessage[0];

    function ChildPacket(exception, message) {
      Packet.call(this, exception, message || defMessage);
    }

    util.inherits(ChildPacket, Packet);

    function ChildException() {
      Exception.call(this, name, ChildPacket, self);
    }

    ChildException.prototype = this;

    if (inherit !== null) {
      util.extendAll(inherit, ChildException.prototype);
      ChildException.call(inherit);
    }

    return Task.resolve(new ChildException());
  });

addMethod(Exception, "match()", 1, function (value) {
  return Task.resolve(defs.match(value instanceof this.object.Packet,
    value, this));
});

addMethod(Exception, "asString", 0, function () {
  return this.name();
});

exports.Object = GraceObject;
exports.Block = Block;
exports.AbstractBoolean = AbstractBoolean;
exports.True = True;
exports.False = False;
exports.String = GraceString;
exports.Number = GraceNumber;
exports.AbstractPattern = AbstractPattern;
exports.Part = Part;
exports.Signature = Signature;
exports.Type = Type;
exports.TypeProxy = TypeProxy;
exports.NamedPattern = NamedPattern;
exports.Success = Success;
exports.Failure = Failure;
exports.Sequence = Sequence;
exports.SequencePattern = SequencePattern;
exports.Exception = Exception;
exports.ExceptionPacket = ExceptionPacket;
