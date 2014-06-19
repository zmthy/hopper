// Exceptions native to the language or necessary for the interpreter.

"use strict";

var Exception, Task, close, defs, open, prim, rt, str, util;

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
  var method = rt.newMethod("raise" + name, signature, func);
  method.isUntraced = true;
  object[util.uglify("raise" + name)] = method;
}

Exception = new prim.Exception(str("Exception"), prim.ExceptionPacket);

exports.Exception = Exception;

Exception.refine(str("Internal Error")).then(function (InternalError) {
  var match = InternalError.match;

  addRaise(InternalError, "FromPrimitiveError()", 1, function (error) {
    if (error instanceof Error) {
      return this.raiseMessage(str(error.message));
    }

    return this.raiseMessage(str(error.toString()));
  });

  InternalError.match = rt.newMethod("match()", 1, function (value) {
    if (value instanceof Error) {
      return defs.success(value);
    }

    return match.call(this, value);
  });

  exports.InternalError = InternalError;
});

Exception.refine_withDefaultMessage([str("Assertion Failure")],
    [str("Failed to satisfy a required pattern")])
  .then(function (AssertionFailure) {
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

Exception
  .refine_withDefaultMessage([str("Uninstantiated Type")],
    [str("Type is not yet instantiated")])
  .then(function (UninstantiatedType) {
    exports.UninstantiatedType = UninstantiatedType;
  });

Exception.refine_withDefaultMessage([str("Out Of Bounds")],
    [str("Access of a collection outside of its bounds")])
  .then(function (OutOfBounds) {
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

Exception.refine_withDefaultMessage([str("Undefined Value")],
    [str("Access of a variable that has not yet had a value defined")])
  .then(function (UndefinedValue) {
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

Exception.refine_withDefaultMessage([str("Unmatchable Block")],
    [str("Match against a block without exactly one parameter")])
  .then(function (UnmatchableBlock) {
    exports.UnmatchableBlock = UnmatchableBlock;
  });

Exception.refine_withDefaultMessage([str("Invalid Type")],
    [str("Duplicate method name in type description")])
  .then(function (InvalidType) {
    exports.InvalidType = InvalidType;
  });

Exception.refine_withDefaultMessage([str("Unresolved Request")],
    [str("Request for a variable or method which cannot be found")])
  .then(function (UnresolvedRequest) {
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

Exception.refine_withDefaultMessage([str("Invalid Super")],
    [str("Incorrect request for a super method")])
  .then(function (InvalidSuper) {
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

Exception.refine_withDefaultMessage([str("Invalid Request")],
    [str("Incorrect number of arguments when requesting a method")])
  .then(function (InvalidRequest) {
    var ne, neGens, postArgVar, postGenVar, preMethod, preVar, tm, tmGens;

    preVar = str("Request for variable «");
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

Exception.refine(str("Invalid Method")).then(function (InvalidMethod) {
  var pre = str("Multiple variadic arguments in method «");

  addRaise(InvalidMethod, "MultipleVariadicParametersForName()", 1,
    function (name) {
      var self = this;

      return join(pre, name, close).then(function (message) {
        return self.raiseMessage(message);
      });
    });

  exports.InvalidMethod = InvalidMethod;
});

Exception.refine_withDefaultMessage([str("Redefinition")],
    [str("Definition of a name that already exists")])
  .then(function (Redefinition) {
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

Exception.refine(str("Invalid Return")).then(function (InvalidReturn) {
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

Exception.refine_withDefaultMessage([str("Invalid Inherits")],
    [str("Inherit from method that does not end in an object constructor")])
  .then(function (InvalidInherits) {
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

Exception.refine_withDefaultMessage([str("Unresolved Module")],
    [str("Unable to locate a module")])
  .then(function (UnresolvedModule) {
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

Exception.refine_withDefaultMessage([str("Parse Error")],
    [str("Invalid Grace code failed to parse")])
  .then(function (ParseError) {
    exports.ParseError = ParseError;
  });

