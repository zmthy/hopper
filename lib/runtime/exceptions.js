// Exceptions native to the language or necessary for the interpreter.

"use strict";

var Err, Exception, LErr, RErr, Task, close, defs, open, prim, rt, str, util;

Task = require("../task");
rt = require("../runtime");
defs = require("./definitions");
prim = require("./primitives");
util = require("../util");

str = defs.string;

open = str("«");
close = str("»");

function asString(object) {
  return rt.apply(object, "asString").then(null, function () {
    return "unrenderable object";
  });
}

function join(string) {
  return Task.each(util.slice(arguments, 1), function (next) {
    return string["++"](next).then(function (concat) {
      string = concat;
    }, function () {
      string += "unrenderable object";
    });
  }).then(function () {
    return string;
  });
}

function addRaise(object, name, signature, func) {
  object[util.uglify("raise" + name)] =
    rt.method("raise" + name, signature, function () {
      return func.apply(this, arguments).then(null, function (packet) {
        packet.object.stackTrace = [];
        throw packet;
      });
    });
}

Exception = new prim.Exception(str("Exception"), prim.ExceptionPacket);

exports.Exception = Exception;

Exception.refine(str("Error")).now(function (Error) {
  var raise, raiseDefault;

  raise = Error.raise;
  raiseDefault = Error.raiseDefault;

  function clearTrace(packet) {
    packet.object.stackTrace = [];
    throw packet;
  }

  addRaise(Error, "()", 1, function (message) {
    return raise.call(this, message).then(null, clearTrace);
  });

  addRaise(Error, "Default", 0, function () {
    return raiseDefault.call(this).then(null, clearTrace);
  });

  Err = Error;
  exports.Error = Error;
});

Err.refine(str("Runtime Error")).now(function (RuntimeError) {
  RErr = RuntimeError;
  exports.RuntimeError = RuntimeError;
});

RErr.refine(str("Internal Error")).now(function (InternalError) {
  var match = InternalError.match;

  addRaise(InternalError, "FromPrimitiveError()", 1, function (error) {
    if (error instanceof Error) {
      return this.raise(str(error.message)).then(null, function (packet) {
        packet.object.error = error;
        throw packet;
      });
    }

    return this.raise(str(error.toString()));
  });

  InternalError.match = rt.method("match()", 1, function (value) {
    if (value instanceof Error) {
      return defs.success(value);
    }

    return match.call(this, value);
  });

  exports.InternalError = InternalError;
});

RErr.refine(str("Incomplete Type")).now(function (IncompleteType) {
  var post, pre;

  pre = str("The type «");
  post = str("» was accessed before it was fully instantiated");

  addRaise(IncompleteType, "ForName()", 1, function (name) {
    var self = this;

    return join(pre, name, post).then(function (message) {
      return self.raise(message);
    });
  });

  exports.IncompleteType = IncompleteType;
});

RErr.refine(str("Incomplete Object")).now(function (IncompleteObject) {
  var post, preName, preSelf;

  preName = str("The implicit receiver of «");
  preSelf = str("«self");
  post = str("» was accessed before it was fully instantiated");

  addRaise(IncompleteObject, "ForName()", 1, function (name) {
    var self = this;

    return join(preName, name, post).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(IncompleteObject, "ForSelf", 0, function () {
    var self = this;

    return join(preSelf, post).then(function (message) {
      return self.raise(message);
    });
  });

  exports.IncompleteObject = IncompleteObject;
});

RErr.refine_defaultMessage([str("Undefined Value")],
    [str("Access of a variable that has not yet had a value defined")])
  .now(function (UndefinedValue) {
    var post, pre;

    pre = str("Access of a variable «");
    post = str("» that has not yet had a value defined");

    addRaise(UndefinedValue, "ForName()", 1, function (name) {
      var self = this;

      return join(pre, name, post).then(function (message) {
        return self.raise(message);
      });
    });

    exports.UndefinedValue = UndefinedValue;
  });

RErr.refine_defaultMessage([str("Unmatchable Block")],
    [str("Match against a block without exactly one parameter")])
  .now(function (UnmatchableBlock) {
    exports.UnmatchableBlock = UnmatchableBlock;
  });

RErr.refine(str("Invalid Type")).now(function (InvalidType) {
  var postDep, postDup, preDep, preDup;

  preDup = str("Duplicate method name «");
  postDup = str("» in type «");

  preDep = str("The type «");
  postDep = str("» recursively depends on itself to produce a value");

  addRaise(InvalidType, "DuplicateMethodName() inType()", [1, 1],
    function (name, type) {
      var self = this;

      return join(preDup, name[0], postDup, type[0], close)
        .then(function (message) {
          return self.raise(message);
        });
    });

  addRaise(InvalidType, "SelfDependencyForType()", 1, function (type) {
    var self = this;

    return join(preDep, type, postDep).then(function (message) {
      return self.raise(message);
    });
  });

  exports.InvalidType = InvalidType;
});

RErr.refine_defaultMessage([str("Unresolved Request")],
    [str("Request for a variable or method which cannot be found")])
  .now(function (UnresolvedRequest) {
    var post, postAssign, postQualified,
      preAssign, preConf, preMethod, preQualified, preVar;

    preVar = str("Request for a variable or method «");
    preMethod = str("Request for a method «");
    post = str("» which cannot be found");

    preAssign = str("Assignment to variable «");
    postAssign = str("» which cannot be assigned to");

    preQualified = str("Request for an undefined method «");
    postQualified = str("» in «");

    preConf = str("Request for a confidential method «");

    addRaise(UnresolvedRequest, "ForName()", 1, function (rawName) {
      var self = this;

      return rt.String.cast(rawName).then(function (name) {
        return name.asPrimitiveString().then(function (primName) {
          if (/\(\)/.test(primName)) {
            return preMethod;
          }

          return preVar;
        }).then(function (pre) {
          return join(pre, name, post).then(function (message) {
            return self.raise(message);
          });
        });
      });
    });

    addRaise(UnresolvedRequest, "ForAssignToName()", 1, function (name) {
      var self = this;

      return join(preAssign, name, postAssign).then(function (message) {
        return self.raise(message);
      });
    });

    addRaise(UnresolvedRequest, "ForAssignToUnresolvedName()", 1,
      function (name) {
        var self = this;

        return join(preAssign, name, post).then(function (message) {
          return self.raise(message);
        });
      });

    addRaise(UnresolvedRequest, "ForName() inObject()", [1, 1],
      function (name, obj) {
        var self = this;

        return join(preQualified, name[0], postQualified, obj[0], close)
          .then(function (message) {
            return self.raise(message);
          });
      });

    exports.UnresolvedRequest = UnresolvedRequest;

    addRaise(UnresolvedRequest, "ConfidentialForName() inObject()", [1, 1],
      function (name, obj) {
        var self = this;

        return join(preConf, name[0], postQualified, obj[0], close)
          .then(function (message) {
            return self.raise(message);
          });
      });
  });

exports.UnresolvedRequest.refine(str("Unresolved Super Request"))
  .now(function (UnresolvedSuperRequest) {
    var post, pre;

    pre = str("Request for an undefined super method «");
    post = str("» in «");

    addRaise(UnresolvedSuperRequest, "ForName() inObject()", [1, [1]],
      function (name, obj) {
        var self = this;

        return join(pre, name[0], post, obj[0], close).then(function (message) {
          return self.raise(message);
        });
      });

    exports.UnresolvedSuperRequest = UnresolvedSuperRequest;
  });

RErr.refine(str("Invalid Request")).now(function (InvalidRequest) {
  var ne, neGens, postArgVar, postGenVar,
    preMethod, preType, preVar, tm, tmGens;

  preVar = str("Request for variable «");
  preType = str("Request for type «");
  postArgVar = str("» with arguments");
  postGenVar = str("» with generic parameters");

  preMethod = str("Request for method «");
  ne = str("» did not supply enough arguments");
  tm = str("» supplied too many arguments");
  neGens = str("» did not supply enough generic arguments");
  tmGens = str("» supplied too many generic arguments");

  addRaise(InvalidRequest, "GenericsForVariable()", 1, function (name) {
    var self = this;

    return join(preVar, name, postGenVar).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(InvalidRequest, "ArgumentsForVariable()", 1, function (name) {
    var self = this;

    return join(preVar, name, postArgVar).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(InvalidRequest, "ArgumentsForType()", 1, function (name) {
    var self = this;

    return join(preType, name, postArgVar).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(InvalidRequest, "NotEnoughArgumentsForMethod()", 1,
    function (name) {
      var self = this;

      return join(preMethod, name, ne).then(function (message) {
        return self.raise(message);
      });
    });

  addRaise(InvalidRequest, "TooManyArgumentsForMethod()", 1, function (name) {
    var self = this;

    return join(preMethod, name, tm).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(InvalidRequest, "NotEnoughGenericArgumentsForMethod()", 1,
    function (name) {
      var self = this;

      return join(preMethod, name, neGens).then(function (message) {
        return self.raise(message);
      });
    });

  addRaise(InvalidRequest, "TooManyGenericArgumentsForMethod()", 1,
    function (name) {
      var self = this;

      return join(preMethod, name, tmGens).then(function (message) {
        return self.raise(message);
      });
    });

  exports.InvalidRequest = InvalidRequest;
});

RErr.refine(str("Invalid Method")).now(function (InvalidMethod) {
  var args, postConf, postParam, postStat, postVar, pre, preConf;

  pre = str("Definition «");
  postParam = str("» has mismatched parameters with its overridden method");
  postConf = str("» overrides a public method");
  preConf = str("Confidential definition «");
  postConf = str("» overrides a public method");
  postStat = str("» overrides a static declaration");
  postVar = str("» is an overriding variable");
  args = str("Multiple variadic arguments in method «");

  addRaise(InvalidMethod, "MismatchedParametersForName()", 1, function (name) {
    var self = this;

    return join(pre, name, postParam).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(InvalidMethod, "ConfidentialOverrideForName()", 1, function (name) {
    var self = this;

    return join(preConf, name, postConf).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(InvalidMethod, "StaticOverrideForName()", 1, function (name) {
    var self = this;

    return join(pre, name, postStat).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(InvalidMethod, "OverridingVariableForName()", 1, function (name) {
    var self = this;

    return join(pre, name, postVar).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(InvalidMethod, "MultipleVariadicParametersForName()", 1,
    function (name) {
      var self = this;

      return join(args, name, close).then(function (message) {
        return self.raise(message);
      });
    });

  exports.InvalidMethod = InvalidMethod;
});

RErr.refine_defaultMessage([str("Redefinition")],
    [str("Definition of a name that already exists")])
  .now(function (Redefinition) {
    var post, pre;

    pre = str("A definition named «");
    post = str("» already exists");

    addRaise(Redefinition, "ForName()", 1, function (name) {
      var self = this;

      return join(pre, name, post).then(function (message) {
        return self.raise(message);
      });
    });

    exports.Redefinition = Redefinition;
  });

RErr.refine(str("Invalid Return")).now(function (InvalidReturn) {
  var completed, object, outside;

  completed = str("Return from a completed method request for «");
  object = str("Return from inside an object constructor");
  outside = str("Return from outside of a method");

  addRaise(InvalidReturn, "ForCompletedMethod()", 1, function (name) {
    var self = this;

    return join(completed, name, close).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(InvalidReturn, "InsideOfObject", 0, function () {
    return this.raise(object);
  });

  addRaise(InvalidReturn, "OutsideOfMethod", 0, function () {
    return this.raise(outside);
  });

  exports.InvalidReturn = InvalidReturn;
});

RErr.refine_defaultMessage([str("Invalid Inherits")],
    [str("Inherit from method that does not end in an object constructor")])
  .now(function (InvalidInherits) {
    var post, pre;

    pre = str("Inherit from method «");
    post = str("» that does not end in an object constructor");

    addRaise(InvalidInherits, "ForName()", 1, function (name) {
      var self = this;

      return join(pre, name, post).then(function (message) {
        return self.raise(message);
      });
    });

    exports.InvalidInherits = InvalidInherits;
  });

RErr.refine_defaultMessage([str("Unresolved Module")],
    [str("Unable to locate a module")])
  .now(function (UnresolvedModule) {
    var post, pre;

    pre = str('Unable to locate a module at the path "');
    post = str('"');

    addRaise(UnresolvedModule, "ForPath()", 1, function (name) {
      var self = this;

      return join(pre, name, post).then(function (message) {
        return self.raise(message);
      });
    });

    exports.UnresolvedModule = UnresolvedModule;
  });

RErr.refine_defaultMessage([str("Parse Failure")],
    [str("Invalid Grace code failed to parse")])
  .now(function (ParseFailure) {
    exports.ParseFailure = ParseFailure;
  });

Err.refine(str("Logic Error")).now(function (LogicError) {
  LErr = LogicError;
  exports.LogicError = LogicError;
});

LErr.refine_defaultMessage([str("Assertion Failure")],
    [str("Failed to satisfy a required pattern")])
  .now(function (AssertionFailure) {
    var mid, miss, post;

    mid = str("» failed to satisfy the required pattern «");
    miss = str("» is missing the required method «");
    post = str("» to satisfy the type «");

    addRaise(AssertionFailure, "ForValue() againstPattern()", [1, 1],
      function (value, pattern) {
        var self = this;

        return asString(value[0]).then(function (string) {
          return join(open, string, mid, pattern[0], close)
            .then(function (message) {
              return self.raise(message);
            });
        });
      });

    addRaise(AssertionFailure, "ForValue() againstType() missing()",
      [1, 1, 1], function (value, pattern, signature) {
        var self = this;

        return asString(value[0]).then(function (string) {
          return join(open, string, miss, signature[0], post, pattern[0], close)
            .then(function (message) {
              return self.raise(message);
            });
        });
      });

    exports.AssertionFailure = AssertionFailure;
  });

LErr.refine(str("Match Failure")).now(function (MatchFailure) {
  var pre = str("No case branches matched «");

  addRaise(MatchFailure, "ForObject()", 1, function (value) {
    var self = this;

    return join(pre, value, close).then(function (message) {
      return self.raise(message);
    });
  });

  exports.MatchFailure = MatchFailure;
});

LErr.refine(str("No Such Value")).now(function (NoSuchValue) {
  var mid, pre;

  pre = str("No such value «");
  mid = str("» in object «");

  addRaise(NoSuchValue, "ForName() inObject()", [1, 1],
    function (name, object) {
      var self = this;

      return join(pre, name[0], mid, object[0], close).then(function (message) {
        return self.raise(message);
      });
    });

  exports.NoSuchValue = NoSuchValue;
});

LErr.refine(str("Failed Search")).now(function (FailedSearch) {
  var pre = str("Could not find the object «");

  addRaise(FailedSearch, "ForObject()", 1, function (object) {
    var self = this;

    return join(pre, object, close).then(function (message) {
      return self.raise(message);
    });
  });

  exports.FailedSearch = FailedSearch;
});

LErr.refine_defaultMessage([str("Out Of Bounds")],
    [str("Access of a collection outside of its bounds")])
  .now(function (OutOfBounds) {
    var post, pre;

    pre = str("Access of a collection at index «");
    post = str("» outside of its bounds");

    addRaise(OutOfBounds, "ForIndex()", 1, function (rawIndex) {
      var self = this;

      return defs.Number.cast(rawIndex).then(function (index) {
        return join(pre, index, post).then(function (message) {
          return self.raise(message);
        });
      });
    });

    exports.OutOfBounds = OutOfBounds;
  });

LErr.refine(str("Not A Number")).now(function (NotANumber) {
  var divide, mid, postOp, postParse, preOp, preParse;

  divide = str("Division by zero");
  preParse = str("Failed to parse «");
  postParse = str("» to a number");

  preOp = str("Applying «");
  mid = str("» to the number «");
  postOp = str("» is not a real number");

  addRaise(NotANumber, "DivideByZero", 0, function () {
    return this.raise(divide);
  });

  addRaise(NotANumber, "ForParse()", 1, function (rawString) {
    var self = this;

    return rt.String.cast(rawString).then(function (string) {
      return asString(string).then(function (primString) {
        return join(preParse, primString, postParse).then(function (message) {
          return self.raise(message);
        });
      });
    });
  });

  addRaise(NotANumber, "ForOperation() on()", [1, 1], function (name, num) {
    var self = this;

    return join(preOp, name[0], mid, num[0], postOp).then(function (message) {
      return self.raise(message);
    });
  });

  exports.NotANumber = NotANumber;
});

Exception.refine(str("Checker Failure")).now(function (CheckerFailure) {
  CheckerFailure.object.Packet.prototype.nodeOrIfAbsent =
    rt.method("nodeOrIfAbsent", 1, function (action) {
      return rt.Action.assert(action).then(function () {
        return action.apply();
      });
    });

  addRaise(CheckerFailure, "() forNode()", [1, 1], function (msg, node) {
    msg = msg[0];
    node = node[0];

    return this.raise(msg).then(null, function (packet) {
      packet.object.node = node;

      packet.nodeOrIfAbsent = rt.method("nodeOrIfAbsent", 1, function (action) {
        return rt.Action.assert(action).then(function () {
          return node;
        });
      });

      throw packet;
    });
  });

  addRaise(CheckerFailure, "ForNode()", 1, function (node) {
    return this.raiseDefault().then(null, function (packet) {
      packet.object.node = node;

      packet.nodeOrIfAbsent = rt.method("nodeOrIfAbsent", 1, function (action) {
        return rt.Action.assert(action).then(function () {
          return node;
        });
      });

      throw packet;
    });
  });

  exports.CheckerFailure = CheckerFailure;
});
