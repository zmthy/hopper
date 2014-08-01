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
  var method = rt.method("raise" + name, signature, func);
  method.isUntraced = true;
  object[util.uglify("raise" + name)] = method;
}

Exception = new prim.Exception(str("Exception"), prim.ExceptionPacket);

exports.Exception = Exception;

Exception.refine(str("Error")).now(function (Error) {
  var raise, raiseMessage;

  raise = Error.raise;
  raiseMessage = Error.raiseMessage;

  function clearTrace(packet) {
    packet.object.stackTrace = [];
    throw packet;
  }

  addRaise(Error, "", 0, function () {
    return raise.call(this).then(null, clearTrace);
  });

  addRaise(Error, "Message()", 1, function (message) {
    return raiseMessage.call(this, message).then(null, clearTrace);
  });

  Err = Error;
  exports.Error = Error;
});

Err.refine(str("Internal Error")).now(function (InternalError) {
  var match = InternalError.match;

  addRaise(InternalError, "FromPrimitiveError()", 1, function (error) {
    if (error instanceof Error) {
      return this.raiseMessage(str(error.message));
    }

    return this.raiseMessage(str(error.toString()));
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
              return self.raiseMessage(message);
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
      return self.raiseMessage(message);
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
      return self.raiseMessage(message);
    });
  });

  addRaise(IncompleteObject, "ForSelf", 0, function () {
    var self = this;

    return join(preSelf, post).then(function (message) {
      return self.raiseMessage(message);
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
          return self.raiseMessage(message);
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
        return self.raiseMessage(message);
      });
    });

    exports.UndefinedValue = UndefinedValue;
  });

Err.refine_withDefaultMessage([str("Unmatchable Block")],
    [str("Match against a block without exactly one parameter")])
  .now(function (UnmatchableBlock) {
    exports.UnmatchableBlock = UnmatchableBlock;
  });

Err.refine_withDefaultMessage([str("Invalid Type")],
    [str("Duplicate method name in type description")])
  .now(function (InvalidType) {
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
            return self.raiseMessage(message);
          });
        });
      });
    });

    addRaise(UnresolvedRequest, "ForName() inObject()", [1, 1],
      function (name, obj) {
        var self = this;

        return join(preQualified, name[0], postQualified, obj[0], close)
          .then(function (message) {
            return self.raiseMessage(message);
          });
      });

    exports.UnresolvedRequest = UnresolvedRequest;
  });

Err.refine_withDefaultMessage([str("Invalid Super")],
    [str("Incorrect request for a super method")])
  .now(function (InvalidSuper) {
    var missingPost, outsidePost, pre, wrongMid, wrongPost;

    pre = str("Request for a super method «");
    missingPost = str("» which does not exist");
    outsidePost = str("» outside of a method");
    wrongMid = str("» inside of a different method «");
    wrongPost = str("»");

    addRaise(InvalidSuper, "NoSuchMethodForName()", 1, function (name) {
      var self = this;

      return join(pre, name, missingPost).then(function (message) {
        return self.raiseMessage(message);
      });
    });

    addRaise(InvalidSuper, "OutsideOfMethodForName()", 1, function (name) {
      var self = this;

      return join(pre, name, outsidePost).then(function (message) {
        return self.raiseMessage(message);
      });
    });

    addRaise(InvalidSuper, "ForName() inMethod()", [1, 1],
      function (name, meth) {
        var self = this;

        return join(pre, name[0], wrongMid, meth[0], wrongPost)
          .then(function (message) {
            return self.raiseMessage(message);
          });
      });

    exports.InvalidSuper = InvalidSuper;
  });

Err.refine(str("Invalid Request")).now(function (InvalidRequest) {
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
      return self.raiseMessage(message);
    });
  });

  addRaise(InvalidRequest, "ArgumentsForVariable()", 1, function (name) {
    var self = this;

    return join(preVar, name, postArgVar).then(function (message) {
      return self.raiseMessage(message);
    });
  });

  addRaise(InvalidRequest, "ArgumentsForType()", 1, function (name) {
    var self = this;

    return join(preType, name, postArgVar).then(function (message) {
      return self.raiseMessage(message);
    });
  });

  addRaise(InvalidRequest, "NotEnoughArgumentsForMethod()", 1,
    function (name) {
      var self = this;

      return join(preMethod, name, ne).then(function (message) {
        return self.raiseMessage(message);
      });
    });

  addRaise(InvalidRequest, "TooManyArgumentsForMethod()", 1, function (name) {
    var self = this;

    return join(preMethod, name, tm).then(function (message) {
      return self.raiseMessage(message);
    });
  });

  addRaise(InvalidRequest, "NotEnoughGenericArgumentsForMethod()", 1,
    function (name) {
      var self = this;

      return join(preMethod, name, neGens).then(function (message) {
        return self.raiseMessage(message);
      });
    });

  addRaise(InvalidRequest, "TooManyGenericArgumentsForMethod()", 1,
    function (name) {
      var self = this;

      return join(preMethod, name, tmGens).then(function (message) {
        return self.raiseMessage(message);
      });
    });

  exports.InvalidRequest = InvalidRequest;
});

Err.refine(str("Invalid Method")).now(function (InvalidMethod) {
  var args, postConf, preConf, postStat, preStat;

  preConf = str("Confidential definition «");
  postConf = str("» overrides a public method");
  preStat = str("Definition «");
  postStat = str("» overrides a static declaration");
  args = str("Multiple variadic arguments in method «");

  addRaise(InvalidMethod, "ConfidentialOverrideForName()", 1, function (name) {
    var self = this;

    return join(preConf, name, postConf).then(function (message) {
      return self.raiseMessage(message);
    });
  });

  addRaise(InvalidMethod, "StaticOverrideForName()", 1, function (name) {
    var self = this;

    return join(preStat, name, postStat).then(function (message) {
      return self.raiseMessage(message);
    });
  });

  addRaise(InvalidMethod, "MultipleVariadicParametersForName()", 1,
    function (name) {
      var self = this;

      return join(args, name, close).then(function (message) {
        return self.raiseMessage(message);
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
        return self.raiseMessage(message);
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
      return self.raiseMessage(message);
    });
  });

  addRaise(InvalidReturn, "InsideOfObject", 0, function () {
    return this.raiseMessage(object);
  });

  addRaise(InvalidReturn, "OutsideOfMethod", 0, function () {
    return this.raiseMessage(outside);
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
        return self.raiseMessage(message);
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
        return self.raiseMessage(message);
      });
    });

    exports.UnresolvedModule = UnresolvedModule;
  });

Err.refine_withDefaultMessage([str("Parse Error")],
    [str("Invalid Grace code failed to parse")])
  .now(function (ParseError) {
    exports.ParseError = ParseError;
  });

Err.refine_withDefaultMessage([str("Outer Limit")],
    [str("Request for outer on the outermost scope")])
  .now(function (OuterLimit) {
    exports.OuterLimit = OuterLimit;
  });

