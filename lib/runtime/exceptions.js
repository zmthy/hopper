// Exceptions native to the language or necessary for the interpreter.

"use strict";

var Err, Exception, Task, close, defs, open, prim, rt, str, util;

Task = require("../task");
rt = require("../runtime");
defs = require("./definitions");
prim = require("./primitives");
util = require("../util");

str = defs.string;

open = str("«");
close = str("»");

function join(string) {
  return Task.each(util.slice(arguments, 1), function (next) {
    return string["++"](next).then(function (concat) {
      string = concat;
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

Err.refine(str("Internal Error")).now(function (InternalError) {
  var match = InternalError.match;

  addRaise(InternalError, "FromPrimitiveError()", 1, function (error) {
    if (error instanceof Error) {
      return this.raise(str(error.message));
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

Err.refine_withDefaultMessage([str("Assertion Failure")],
    [str("Failed to satisfy a required pattern")])
  .now(function (AssertionFailure) {
    var mid = str("» failed to satisfy the required pattern «");

    addRaise(AssertionFailure, "ForValue() againstPattern()", [1, 1],
      function (value, pattern) {
        var self = this;

        return value[0].asString().then(function (value) {
          return join(open, value, mid, pattern[0], close)
            .then(function (message) {
              return self.raise(message);
            });
        });
      });

    exports.AssertionFailure = AssertionFailure;
  });

Err.refine(str("Incomplete Type")).now(function (IncompleteType) {
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

Err.refine(str("Incomplete Object")).now(function (IncompleteObject) {
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

Err.refine_withDefaultMessage([str("Out Of Bounds")],
    [str("Access of a collection outside of its bounds")])
  .now(function (OutOfBounds) {
    var post, pre;

    pre = str("Access of a collection at index «");
    post = str("» outside of its bounds");

    addRaise(OutOfBounds, "ForIndex()", 1, function (index) {
      var self = this;

      return defs.Number.assert(index).then(function () {
        return join(pre, index, post).then(function (message) {
          return self.raise(message);
        });
      });
    });

    exports.OutOfBounds = OutOfBounds;
  });

Err.refine_withDefaultMessage([str("Undefined Value")],
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

Err.refine_withDefaultMessage([str("Unmatchable Block")],
    [str("Match against a block without exactly one parameter")])
  .now(function (UnmatchableBlock) {
    exports.UnmatchableBlock = UnmatchableBlock;
  });

Err.refine(str("Invalid Type")).now(function (InvalidType) {
  var post, pre;

  pre = str("Duplicate method name «");
  post = str("» in type");

  addRaise(InvalidType, "ForDuplicateMethodName()", 1, function (name) {
    var self = this;

    return join(pre, name, post).then(function (message) {
      return self.raise(message);
    });
  });

  exports.InvalidType = InvalidType;
});

Err.refine_withDefaultMessage([str("Unresolved Request")],
    [str("Request for a variable or method which cannot be found")])
  .now(function (UnresolvedRequest) {
    var post, preMethod, postQualified, preQualified, preVar;

    preVar = str("Request for a variable or method «");
    preMethod = str("Request for a method «");
    post = str("» which cannot be found");

    preQualified = str("Request for an undefined method «");
    postQualified = str("» in «");

    addRaise(UnresolvedRequest, "ForName", 1, function (name) {
      var self = this;

      return rt.String.assert(name).then(function () {
        return name.asPrimitiveString().then(function (name) {
          if (/\(\)/.test(name)) {
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

    addRaise(UnresolvedRequest, "ForName() inObject()", [1, 1],
      function (name, obj) {
        var self = this;

        return join(preQualified, name[0], postQualified, obj[0], close)
          .then(function (message) {
            return self.raise(message);
          });
      });

    exports.UnresolvedRequest = UnresolvedRequest;
  });

exports.UnresolvedRequest.refine(str("Unresolved Super Request"))
  .now(function (UnresolvedSuperRequest) {
    var post, pre;

    pre = str("Request for an undefined super method «");
    post = str("» in «");

    addRaise(UnresolvedSuperRequest, "ForName() inObject", [1, 1],
      function (name, obj) {
        var self = this;

        return join(pre, name[0], post, obj[0], close).then(function (message) {
          return self.raise(message);
        });
      });

    exports.UnresolvedSuperRequest = UnresolvedSuperRequest;
  });

Err.refine(str("Invalid Request")).now(function (InvalidRequest) {
  var ne, neGens, postArgVar, postGenVar,
    preAmbig, preMethod, preType, preVar, tm, tmGens;

  preVar = str("Request for variable «");
  preType = str("Request for type «");
  postArgVar = str("» with arguments");
  postGenVar = str("» with generic parameters");

  preMethod = str("Request for method «");
  ne = str("» did not supply enough arguments");
  tm = str("» supplied too many arguments");
  neGens = str("» did not supply enough generic arguments");
  tmGens = str("» supplied too many generic arguments");

  preAmbig = str("Ambiguous request for «");

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

  addRaise(InvalidRequest, "AmbiguousRequestForName()", 1, function (name) {
    var self = this;

    return join(preAmbig, name, close).then(function (message) {
      return self.raise(message);
    });
  });

  exports.InvalidRequest = InvalidRequest;
});

Err.refine(str("Invalid Method")).now(function (InvalidMethod) {
  var args, postConf, postStat, postVar, preConf, preStat, preVar;

  preConf = str("Confidential definition «");
  postConf = str("» overrides a public method");
  preStat = str("Definition «");
  postStat = str("» overrides a static declaration");
  preVar = str("Definition «");
  postVar = str("» is an overriding variable");
  args = str("Multiple variadic arguments in method «");

  addRaise(InvalidMethod, "ConfidentialOverrideForName()", 1, function (name) {
    var self = this;

    return join(preConf, name, postConf).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(InvalidMethod, "StaticOverrideForName()", 1, function (name) {
    var self = this;

    return join(preStat, name, postStat).then(function (message) {
      return self.raise(message);
    });
  });

  addRaise(InvalidMethod, "OverridingVariableForName()", 1, function (name) {
    var self = this;

    return join(preVar, name, postVar).then(function (message) {
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

Err.refine_withDefaultMessage([str("Redefinition")],
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

Err.refine(str("Invalid Return")).now(function (InvalidReturn) {
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

Err.refine_withDefaultMessage([str("Invalid Inherits")],
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

Err.refine_withDefaultMessage([str("Unresolved Module")],
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

Err.refine_withDefaultMessage([str("Parse Failure")],
    [str("Invalid Grace code failed to parse")])
  .now(function (ParseFailure) {
    exports.ParseFailure = ParseFailure;
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

Err.refine(str("Not A Number")).now(function (NotANumber) {
  var divide, post, pre;

  divide = str("Division by zero");
  pre = str("Failed to parse «");
  post = str("» to a number");

  addRaise(NotANumber, "DivideByZero", 0, function () {
    return this.raise(divide);
  });

  addRaise(NotANumber, "ForParse()", 1, function (string) {
    var self = this;

    return string.asString().then(function (string) {
      return join(pre, string, post).then(function (message) {
        return self.raise(message);
      });
    });
  });

  exports.NotANumber = NotANumber;
});

