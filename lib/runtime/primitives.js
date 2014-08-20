// Primitive Grace definitions in JavaScript.

"use strict";

var Task, defs, rt, unicode, util;

Task = require("../task");
rt = require("../runtime");
defs = require("./definitions");
unicode = require("../parser/unicode");
util = require("../util");

function addMethod(Constructor, name) {
  Constructor.prototype[util.uglify(name)] =
    rt.method.apply(rt, util.slice(arguments, 1));
}

function addConstructor(Constructor, name) {
  Constructor.prototype[util.uglify(name)] =
    rt.constructor.apply(rt, util.slice(arguments, 1));
}

function GraceObject() {
  return this;
}

GraceObject.isInternal = true;

addMethod(GraceObject, "==", 1, function (value) {
  return defs.boolean(this === value);
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

function asString(self) {
  var methods;

  methods = [];
  util.forAllProperties(self, function (key, method) {
    if (typeof method === "function" &&
        !method.isConfidential && !method.isInternal &&
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

function render(value) {
  return defs.String.assert(value).then(function () {
    return rt.apply(value, "asPrimitiveString");
  });
}

function toString(value) {
  return rt.apply(value, "asString").then(function (string) {
    return render(string);
  });
}

GraceObject.prototype.toString = function () {
  var error, string;

  string = null;
  error = null;

  toString(this).now(function (value) {
    string = value;
  }, function (reason) {
    error = new Error("Unable to render exception message");

    rt.apply(reason, "exception").then(function (exception) {
      return rt.apply(exception, "name").then(function (name) {
        return render(name).then(function (name) {
          error.name = name;
        });
      });
    }).then(function () {
      return rt.apply(reason, "message").then(function (message) {
        return render(message).then(function (message) {
          error.message = message;
        });
      });
    }).now();
  });

  if (error !== null) {
    throw error;
  }

  if (string === null || string.toString === GraceObject.prototype.toString) {
    return asString(this);
  }

  return string.toString();
};

GraceObject.prototype.toString.isInternal = true;

function AbstractPattern() {
  return this;
}

util.inherits(AbstractPattern, GraceObject);

function dirPattern(name, branch) {
  return function (rhs) {
    var lhs = this;
    return defs.Pattern.assert(rhs).then(function () {
      var pattern = new AbstractPattern();

      pattern.match = rt.method("match()", 1, function (value) {
        return lhs.match(value).then(function (match) {
          return defs.Boolean.assert(match).then(function () {
            return match[branch](defs.block(0, function () {
              return rhs.match(value);
            }));
          });
        });
      });

      pattern.asString = rt.method("asString", 0, function () {
        return lhs.asString().then(function (string) {
          return rt.string(name + "(")["++"](string);
        }).then(function (string) {
          return string["++"](rt.string(", "));
        }).then(function (string) {
          return rhs.asString().then(function (rhs) {
            return string["++"](rhs);
          });
        }).then(function (string) {
          return string["++"](rt.string(")"));
        });
      });

      return pattern;
    });
  };
}

addMethod(AbstractPattern, "&", 1, dirPattern("both", "andAlso"));

addMethod(AbstractPattern, "|", 1, dirPattern("either", "orElse"));

addMethod(AbstractPattern, "assert()", 1, function (value) {
  var self = this;

  return self.match(value).then(function (result) {
    return result.orElse(defs.block(0, function () {
      return defs.AssertionFailure
        .raiseForValue_againstPattern([value], [self]);
    }));
  });
});

function Block(parameters, apply) {
  var paramCount;

  AbstractPattern.call(this);

  paramCount = typeof parameters === "number" ? parameters : parameters[1];

  this.apply =
    rt.method("apply" + (paramCount === 0 ? "" : "()"), [parameters], apply);

  this.asString = rt.method("asString", 0, function () {
    return defs.string("block/" + paramCount);
  });

  if (paramCount === 1) {
    this.match = rt.method("match()", 1, function (object) {
      var self = this;

      return self.apply(object).then(function (result) {
        return defs.success(result, self);
      });
    });
  }
}

util.inherits(Block, AbstractPattern);

addMethod(Block, "asPrimitive", function () {
  return this.apply;
});

addMethod(Block, "match()", 1, function () {
  return rt.UnmatchableBlock.raiseDefault();
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
    return self.ifTrue_ifFalse([action], [defs.emptyBlock]);
  }).then(function () {
    return rt.done;
  });
});

addMethod(AbstractBoolean, "ifFalse()", 1, function (action) {
  var self = this;

  return defs.Action.assert(action).then(function () {
    return self.ifTrue_ifFalse([defs.emptyBlock], [action]);
  }).then(function () {
    return rt.done;
  });
});

addMethod(AbstractBoolean, "andAlso() orElse()", [1, 1], function (fst, snd) {
  var self = this;

  fst = fst[0];
  snd = snd[0];

  return defs.Action.assert(fst).then(function () {
    return defs.Action.assert(snd);
  }).then(function () {
    return self.ifTrue_ifFalse(rt.part([defs.Boolean], fst),
      rt.part([defs.Boolean], snd));
  });
});

addMethod(AbstractBoolean, "andAlso()", 1, function (action) {
  var self = this;

  return defs.Action.assert(action).then(function () {
    return self.ifTrue_ifFalse(rt.part([defs.Boolean], [action]),
      rt.part([defs.Boolean], [defs.block(0, function () {
        return self;
      })]));
  });
});

addMethod(AbstractBoolean, "orElse()", 1, function (action) {
  var self = this;

  // TODO Type check parameters, pass generics.
  return self.ifTrue_ifFalse([defs.block(0, function () {
    return self;
  })], [action]);
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
  return this.andAlso_orElse([defs.block(0, function () {
    return defs.boolean(false);
  })], [defs.block(0, function () {
    return defs.boolean(true);
  })]);
});

addMethod(AbstractBoolean, "asBoolean", 0, function () {
  return this.andAlso_orElse([defs.block(0, function () {
    return defs.boolean(true);
  })], [defs.block(0, function () {
    return defs.boolean(false);
  })]);
});

addMethod(AbstractBoolean, "asPrimitive", 0, function () {
  return this.asPrimitiveBoolean();
});

addMethod(AbstractBoolean, "asPrimitiveString", 0, function () {
  return this.asPrimitiveBoolean().then(function (bool) {
    return bool.toString();
  });
});

function addIfTrueIfFalse(Ctor, index) {
  addMethod(Ctor, "ifTrue() ifFalse()", [[1, 1], [1, 1]], function () {
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

addMethod(GraceNumber, "asPrimitiveString", 0, function () {
  return this.asPrimitiveNumber().then(function (num) {
    return num.toString();
  });
});

addMethod(GraceNumber, "==", 1, function (rhs) {
  var self = this;

  return defs.Number.match(rhs).then(function (isNumber) {
    return isNumber.andAlso_orElse([defs.block(0, function () {
      return self.asPrimitiveNumber().then(function (lhs) {
        return rhs.asPrimitiveNumber().then(function (rhs) {
          return defs.boolean(lhs === rhs);
        });
      });
    })], [defs.block(0, function () {
      return defs.boolean(false);
    })]);
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

function binaryOp(func) {
  return function (rhs) {
    var self = this;

    return defs.Number.assert(rhs).then(function () {
      return self.asPrimitiveNumber().then(function (fst) {
        return rhs.asPrimitiveNumber().then(function (snd) {
          return func(fst, snd);
        });
      });
    });
  };
}

function binaryNum(func) {
  return binaryOp(function (fst, snd) {
    return new GraceNumber(func(fst, snd));
  });
}

function binaryCmp(func) {
  return binaryOp(function (fst, snd) {
    return defs.boolean(func(fst, snd));
  });
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

addMethod(GraceNumber, "%", 1, binaryNum(function (fst, snd) {
  return fst % snd;
}));

addMethod(GraceNumber, "^", 1, binaryNum(function (fst, snd) {
  return Math.pow(fst, snd);
}));

addMethod(GraceNumber, "<", 1, binaryCmp(function (fst, snd) {
  return fst < snd;
}));

addMethod(GraceNumber, "<=", 1, binaryCmp(function (fst, snd) {
  return fst <= snd;
}));

addMethod(GraceNumber, ">", 1, binaryCmp(function (fst, snd) {
  return fst > snd;
}));

addMethod(GraceNumber, ">=", 1, binaryCmp(function (fst, snd) {
  return fst >= snd;
}));

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
    return isNumber.andAlso_orElse([defs.block(0, function () {
      return self.asPrimitiveString().then(function (lhs) {
        return rhs.asPrimitiveString().then(function (rhs) {
          return defs.boolean(lhs === rhs);
        });
      });
    })], [defs.block(0, function () {
      return defs.boolean(false);
    })]);
  });
});

addMethod(GraceString, "match()", 1, function (against) {
  return defs.equalityMatch(this, against);
});

addMethod(GraceString, "at()", 1, function (index) {
  return this.asPrimitiveString().then(function (string) {
    return index.asPrimitiveNumber().then(function (index) {
      return defs.string(string[index - 1]);
    });
  });
});

addMethod(GraceString, "size", 0, function () {
  return this.asPrimitiveString().then(function (string) {
    return rt.number(string.length);
  });
});

addMethod(GraceString, "do()", 1, function (action) {
  var self = this;

  return defs.Function.assert(action).then(function () {
    return self.asPrimitiveString();
  }).then(function (string) {
    return Task.each(string, function (character) {
      return action.apply(defs.string(character));
    });
  }).then(function () {
    return defs.done;
  });
});

addMethod(GraceString, "++", 1, function (rhs) {
  var self = this;

  return self.asPrimitiveString().then(function (fst) {
    return defs.String.match(rhs).then(function (isString) {
      return isString.andAlso_orElse([defs.block(0, function () {
        return rhs;
      })], [defs.block(0, function () {
        return rhs.asString();
      })]).then(function (snd) {
        return snd.asPrimitiveString().then(function (snd) {
          return new GraceString(fst + snd);
        });
      });
    });
  });
});

addMethod(GraceString, "asString", 0, function () {
  return this.asPrimitiveString().then(function (value) {
    return defs.string("\"" + unicode.escape(value) + "\"");
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

Part.prototype.name = function () {
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
    this.parts = [new Part(parts, hasVarArg, generics, parameters)];
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
    name.push(parts[i].name);
  }

  return name.join(" ");
};

Signature.prototype.toString = function () {
  return this.parts.join(" ");
};

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
    generics: generics,
    signatures: signatures
  };

  if (name !== null) {
    name = defs.string(name);

    this.asString = rt.method("asString", 0, function () {
      return name;
    });
  }
}

util.inherits(Type, AbstractPattern);

addMethod(Type, "match()", 1, function (value) {
  var generics, i, j, k, l, mcount, method, mparts,
    part, parts, scount, signature, signatures;

  signatures = this.object.signatures;

  for (i = 0, l = signatures.length; i < l; i += 1) {
    signature = signatures[i];
    method = value[util.uglify(signature.name())];
    parts = signature.parts;

    if (method === undefined) {
      return defs.failure(value, this);
    }

    if (typeof method === "function" && method.parts !== undefined) {
      mparts = method.parts;

      for (j = 0, k = mparts.length; j < k; j += 1) {
        part = parts[j];
        generics = part.generics.length;

        mcount = mparts[j][1];
        scount = part.parameters.length;

        if ((generics !== 0 && mparts[j][0] !== generics) ||
            (typeof mcount === "number" ? part.hasVarArg || mcount !== scount :
                (part.hasVarArg ? scount - 1 : scount) < mcount.minimum)) {
          return defs.failure(value, this);
        }
      }
    }
  }

  return defs.success(value, this);
});

addMethod(Type, "asString", 0, function () {
  var l, sep, signatures;

  signatures = this.object.signatures;
  l = signatures.length;
  sep = l === 0 ? "" : l === 1 ? " " : "\n  ";

  return defs.string("type {" + sep + signatures.join("\n  ") + sep + "}");
});

// A proxy for hoisted type declarations that will be filled out with the values
// of a real type once the actual value is built. As such, the proxy can be
// combined with other patterns and be tested for equality, but it cannot be
// matched or stringified.
function TypeProxy(name) {
  this.asString = rt.method("asString", 0, function () {
    return defs.string(name);
  });
}

util.inherits(TypeProxy, AbstractPattern);

addMethod(TypeProxy, "match()", 1, function () {
  return this.asString().then(function (name) {
    return defs.IncompleteType.raiseForName(name);
  });
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
    return this.result().then(function (value) {
      return value.asString().then(function (string) {
        return string.asPrimitiveString().then(function (string) {
          return defs.string(name + "(" + string + ")");
        });
      });
    });
  };
}

function Success(result, pattern) {
  True.call(this);

  this.result = rt.method("result", 0, function () {
    return result;
  });

  this.pattern = rt.method("pattern", 0, function () {
    return pattern;
  });
}

util.inherits(Success, True);

addMethod(Success, "asString", 0, matchAsString("success"));

function Failure(result, pattern) {
  False.call(this);

  this.result = rt.method("result", 0, function () {
    return result;
  });

  this.pattern = rt.method("pattern", 0, function () {
    return pattern;
  });
}

util.inherits(Failure, False);

addMethod(Failure, "asString", 0, matchAsString("failure"));

function Sequence(elements) {
  var size = elements.length;

  this.at = rt.method("at()", 1, function (num) {
    return defs.Number.assert(num).then(function () {
      return num.asPrimitiveNumber().then(function (index) {
        if (index < 1 || index > size) {
          return defs.OutOfBounds.raiseForIndex(num);
        }

        return elements[index - 1];
      });
    });
  });

  this.size = rt.method("size", 0, function () {
    return defs.number(size);
  });

  this.asPrimitiveArray = rt.method("asPrimitiveArray", 0, function () {
    return elements.concat();
  });
}

util.inherits(Sequence, GraceObject);

addMethod(Sequence, "do()", 1, function (action) {
  var self = this;

  return defs.Function.assert(action).then(function () {
    return self.asPrimitiveArray();
  }).then(function (elements) {
    return Task.each(elements, function (element) {
      return action.apply(element);
    });
  }).then(function () {
    return defs.done;
  });
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

addMethod(Sequence, "++", 1, function (rhs) {
  var self = this;

  return defs.Do.assert(rhs).then(function () {
    return self.asPrimitiveArray();
  }).then(function (lhs) {
    return getElements(rhs).then(function (rhs) {
      return defs.sequence(lhs.concat(rhs));
    });
  });
});

addMethod(Sequence, "asString", 0, function () {
  return this.asPrimitiveArray().then(function (elements) {
    return defs.string("sequence.with" +
      (elements.length === 0 ? "" : "(" + elements.join(", ") + ")"));
  });
});

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
        return isSequence.ifTrue_ifFalse([defs.block(0, function () {
          return list["do"](defs.block(1, function (value) {
            return new Task(function (next, reject) {
              pattern.match(value).then(function (matched) {
                return matched.ifTrue_ifFalse([defs.block(0, function () {
                  next(rt.done);
                  return Task.never();
                })], [defs.block(0, function () {
                  resolve(defs.failure(list, self));
                  return Task.never();
                })]);
              }).then(null, reject);
            });
          })).then(function () {
            return defs.success(list, self);
          });
        })], [defs.block(0, function () {
          return defs.failure(list, self);
        })]);
      }).then(resolve, reject);
    });
  });
});

addMethod(SequencePattern, "asString", 0, function () {
  return this.pattern().then(function (pattern) {
    return pattern.asString().then(function (string) {
      return string.asPrimitiveString().then(function (string) {
        return defs.string("Sequence<" + string + ">");
      });
    });
  });
});

function ExceptionPacket(exception, message) {
  if (message === undefined) {
    this.asString = rt.method("asString", function () {
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
    stackTrace: []
  };
}

util.inherits(ExceptionPacket, GraceObject);

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

function Exception(name, Packet) {
  this.object = {
    name: name,
    Packet: Packet
  };
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
  var Packet = this.object.Packet;

  function ChildPacket(exception, message) {
    Packet.call(this, exception, message);
  }

  util.inherits(ChildPacket, Packet);

  function ChildException() {
    Exception.call(this, name, ChildPacket);
  }

  ChildException.prototype = this;

  if (inherit !== null) {
    util.extendAll(inherit, ChildException.prototype);
    ChildException.call(inherit);
  }

  return Task.resolve(new ChildException());
});

addConstructor(Exception, "refine() withDefaultMessage()", [1, 1],
  function (inherit, name, defMessage) {
    var Packet = this.object.Packet;

    name = name[0];
    defMessage = defMessage[0];

    function ChildPacket(exception, message) {
      Packet.call(this, exception, message || defMessage);
    }

    util.inherits(ChildPacket, Packet);

    function ChildException() {
      Exception.call(this, name, ChildPacket);
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

