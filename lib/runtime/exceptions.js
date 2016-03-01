// Exceptions native to the language or necessary for the interpreter.

"use strict";

var Err, Exception, LErr, RErr, close, defs, open, prim, rt, task, str, util;

task = require("../task");
rt = require("../runtime");
defs = require("./definitions");
prim = require("./primitives");
util = require("../util");

str = defs.string;

open = str("«");
close = str("»");

function asString(object) {
  return rt.apply(object, "asString").then(null, () => {
    return "unrenderable object";
  });
}

function join(string) {
  return task.each(util.slice(arguments, 1), (next) => {
    return string["++"](next).then((concat) => {
      string = concat;
    }, () => {
      string += "unrenderable object";
    });
  }).then(() => {
    return string;
  });
}

function addRaise(object, name, signature, func) {
  object[util.uglify("raise" + name)] =
    rt.method("raise" + name, signature, function () {
      return func.apply(this, arguments).then(null, (packet) => {
        packet.object.stackTrace = [];
        throw packet;
      });
    });
}

Exception = new prim.Exception(str("Exception"), prim.ExceptionPacket);

exports.Exception = Exception;

(function () {
  var raise, raiseDefault;

  Err = Exception._refine(str("Error"));

  raise = Err.raise;
  raiseDefault = Err.raiseDefault;

  function clearTrace(packet) {
    packet.object.stackTrace = [];
    throw packet;
  }

  addRaise(Err, "()", 1, function (message) {
    return raise.call(this, message).then(null, clearTrace);
  });

  addRaise(Err, "Default", 0, function () {
    return raiseDefault.call(this).then(null, clearTrace);
  });

  exports.Err = Err;
}());

RErr = Err._refine(str("Runtime Error"));
exports.RuntimeError = RErr;

(function () {
  var InternalError, match;

  InternalError = RErr._refine(str("Internal Error"));
  match = InternalError.match;

  addRaise(InternalError, "FromPrimitiveError()", 1, function (error) {
    if (error instanceof Error) {
      console.log(error.stack);
      return this.raise(str(error.message)).then(null, (packet) => {
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
}());

(function () {
  var IncompleteType, post, pre;

  IncompleteType = RErr._refine(str("Incomplete Type"));

  pre = str("The type «");
  post = str("» was accessed before it was fully instantiated");

  addRaise(IncompleteType, "ForName()", 1, function (name) {
    var self = this;

    return join(pre, name, post).then((message) => {
      return self.raise(message);
    });
  });

  exports.IncompleteType = IncompleteType;
}());

(function () {
  var IncompleteObject, post, preName, preSelf;

  IncompleteObject = RErr._refine(str("Incomplete Object"));

  preName = str("The implicit receiver of «");
  preSelf = str("«self");
  post = str("» was accessed before it was fully instantiated");

  addRaise(IncompleteObject, "ForName()", 1, function (name) {
    var self = this;

    return join(preName, name, post).then((message) => {
      return self.raise(message);
    });
  });

  addRaise(IncompleteObject, "ForSelf", 0, function () {
    var self = this;

    return join(preSelf, post).then((message) => {
      return self.raise(message);
    });
  });

  exports.IncompleteObject = IncompleteObject;
}());

(function () {
  var UndefinedValue, post, pre;

  UndefinedValue = RErr._refine(str("Undefined Value"),
    str("Access of a variable that has not yet had a value defined"));

  pre = str("Access of a variable «");
  post = str("» that has not yet had a value defined");

  addRaise(UndefinedValue, "ForName()", 1, function (name) {
    var self = this;

    return join(pre, name, post).then((message) => {
      return self.raise(message);
    });
  });

  exports.UndefinedValue = UndefinedValue;
}());

exports.UnmatchableBlock = RErr._refine(str("Unmatchable Block"),
  str("Match against a block without exactly one parameter"));

(function () {
  var InvalidType, postDep, postDup, preDep, preDup;

  InvalidType = RErr._refine(str("Invalid Type"));

  preDup = str("Duplicate method name «");
  postDup = str("» in type «");

  preDep = str("The type «");
  postDep = str("» recursively depends on itself to produce a value");

  addRaise(InvalidType, "DuplicateMethodName() inType()", [1, 1],
    function (name, type) {
      var self = this;

      return join(preDup, name[0], postDup, type[0], close)
        .then((message) => {
          return self.raise(message);
        });
    });

  addRaise(InvalidType, "SelfDependencyForType()", 1, function (type) {
    var self = this;

    return join(preDep, type, postDep).then((message) => {
      return self.raise(message);
    });
  });

  exports.InvalidType = InvalidType;
}());

(function () {
  var UnresolvedRequest, post, postAssign, postQualified,
    preAssign, preConf, preMethod, preQualified, preVar;

  UnresolvedRequest = RErr._refine(str("Unresolved Request"),
    str("Request for a variable or method which cannot be found"));

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

    return rt.String.cast(rawName).then((name) => {
      return name.asPrimitiveString().then((primName) => {
        if (/\(\)/.test(primName)) {
          return preMethod;
        }

        return preVar;
      }).then((pre) => {
        return join(pre, name, post).then((message) => {
          return self.raise(message);
        });
      });
    });
  });

  addRaise(UnresolvedRequest, "ForAssignToName()", 1, function (name) {
    var self = this;

    return join(preAssign, name, postAssign).then((message) => {
      return self.raise(message);
    });
  });

  addRaise(UnresolvedRequest, "ForAssignToUnresolvedName()", 1,
    function (name) {
      var self = this;

      return join(preAssign, name, post).then((message) => {
        return self.raise(message);
      });
    });

  addRaise(UnresolvedRequest, "ForName() inObject()", [1, 1],
    function (name, obj) {
      var self = this;

      return join(preQualified, name[0], postQualified, obj[0], close)
        .then((message) => {
          return self.raise(message);
        });
    });

  exports.UnresolvedRequest = UnresolvedRequest;

  addRaise(UnresolvedRequest, "ConfidentialForName() inObject()", [1, 1],
    function (name, obj) {
      var self = this;

      return join(preConf, name[0], postQualified, obj[0], close)
        .then((message) => {
          return self.raise(message);
        });
    });
}());

(function () {
  var UnresolvedSuperRequest, post, pre;

  UnresolvedSuperRequest =
    exports.UnresolvedRequest._refine(str("Unresolved Super Request"));

  pre = str("Request for an undefined super method «");
  post = str("» in «");

  addRaise(UnresolvedSuperRequest, "ForName() inObject()", [1, [1]],
    function (name, obj) {
      var self = this;

      return join(pre, name[0], post, obj[0], close).then((message) => {
        return self.raise(message);
      });
    });

  exports.UnresolvedSuperRequest = UnresolvedSuperRequest;
}());

(function () {
  var InvalidRequest, ne, neGens, postArgVar, postGenVar,
    preMethod, preType, preVar, tm, tmGens;

  InvalidRequest = RErr._refine(str("Invalid Request"));

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

    return join(preVar, name, postGenVar).then((message) => {
      return self.raise(message);
    });
  });

  addRaise(InvalidRequest, "ArgumentsForVariable()", 1, function (name) {
    var self = this;

    return join(preVar, name, postArgVar).then((message) => {
      return self.raise(message);
    });
  });

  addRaise(InvalidRequest, "ArgumentsForType()", 1, function (name) {
    var self = this;

    return join(preType, name, postArgVar).then((message) => {
      return self.raise(message);
    });
  });

  addRaise(InvalidRequest, "NotEnoughArgumentsForMethod()", 1,
    function (name) {
      var self = this;

      return join(preMethod, name, ne).then((message) => {
        return self.raise(message);
      });
    });

  addRaise(InvalidRequest, "TooManyArgumentsForMethod()", 1, function (name) {
    var self = this;

    return join(preMethod, name, tm).then((message) => {
      return self.raise(message);
    });
  });

  addRaise(InvalidRequest, "NotEnoughGenericArgumentsForMethod()", 1,
    function (name) {
      var self = this;

      return join(preMethod, name, neGens).then((message) => {
        return self.raise(message);
      });
    });

  addRaise(InvalidRequest, "TooManyGenericArgumentsForMethod()", 1,
    function (name) {
      var self = this;

      return join(preMethod, name, tmGens).then((message) => {
        return self.raise(message);
      });
    });

  exports.InvalidRequest = InvalidRequest;
}());

(function () {
  var InvalidMethod, args, postConf, postParam, postStat, postVar, pre, preConf;

  InvalidMethod = RErr._refine(str("Invalid Method"));

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

    return join(pre, name, postParam).then((message) => {
      return self.raise(message);
    });
  });

  addRaise(InvalidMethod, "ConfidentialOverrideForName()", 1, function (name) {
    var self = this;

    return join(preConf, name, postConf).then((message) => {
      return self.raise(message);
    });
  });

  addRaise(InvalidMethod, "StaticOverrideForName()", 1, function (name) {
    var self = this;

    return join(pre, name, postStat).then((message) => {
      return self.raise(message);
    });
  });

  addRaise(InvalidMethod, "OverridingVariableForName()", 1, function (name) {
    var self = this;

    return join(pre, name, postVar).then((message) => {
      return self.raise(message);
    });
  });

  addRaise(InvalidMethod, "MultipleVariadicParametersForName()", 1,
    function (name) {
      var self = this;

      return join(args, name, close).then((message) => {
        return self.raise(message);
      });
    });

  exports.InvalidMethod = InvalidMethod;
}());


(function () {
  var Redefinition, post, pre;

  Redefinition = RErr._refine(str("Redefinition"),
    str("Definition of a name that already exists"));

  pre = str("A definition named «");
  post = str("» already exists");

  addRaise(Redefinition, "ForName()", 1, function (name) {
    var self = this;

    return join(pre, name, post).then((message) => {
      return self.raise(message);
    });
  });

  exports.Redefinition = Redefinition;
}());

(function () {
  var InvalidReturn, completed, object, outside;

  InvalidReturn = RErr._refine(str("Invalid Return"));

  completed = str("Return from a completed method request for «");
  object = str("Return from inside an object constructor");
  outside = str("Return from outside of a method");

  addRaise(InvalidReturn, "ForCompletedMethod()", 1, function (name) {
    var self = this;

    return join(completed, name, close).then((message) => {
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
}());

(function () {
  var InvalidInherits, post, pre;

  InvalidInherits = RErr._refine(str("Invalid Inherits"),
    str("Inherit from method that does not end in an object constructor"));

  pre = str("Inherit from method «");
  post = str("» that does not end in an object constructor");

  addRaise(InvalidInherits, "ForName()", 1, function (name) {
    var self = this;

    return join(pre, name, post).then((message) => {
      return self.raise(message);
    });
  });

  exports.InvalidInherits = InvalidInherits;
}());

(function () {
  var UnresolvedModule, post, pre;

  UnresolvedModule = RErr._refine(str("Unresolved Module"),
    str("Unable to locate a module"));

  pre = str('Unable to locate a module at the path "');
  post = str('"');

  addRaise(UnresolvedModule, "ForPath()", 1, function (name) {
    var self = this;

    return join(pre, name, post).then((message) => {
      return self.raise(message);
    });
  });

  exports.UnresolvedModule = UnresolvedModule;
}());

exports.ParseFailure = RErr._refine(str("Parse Failure"),
  str("Invalid Grace code failed to parse"));

LErr = Err._refine(str("Logic Error"));
exports.LogicError = LErr;

(function () {
  var AssertionFailure, mid, miss, post;

  AssertionFailure = LErr._refine(str("Assertion Failure"),
    str("Failed to satisfy a required pattern"));

  mid = str("» failed to satisfy the required pattern «");
  miss = str("» is missing the required method «");
  post = str("» to satisfy the type «");

  addRaise(AssertionFailure, "ForValue() againstPattern()", [1, 1],
    function (value, pattern) {
      var self = this;

      return asString(value[0]).then((string) => {
        return join(open, string, mid, pattern[0], close)
          .then((message) => {
            return self.raise(message);
          });
      });
    });

  addRaise(AssertionFailure, "ForValue() againstType() missing()",
    [1, 1, 1], function (value, pattern, signature) {
      var self = this;

      return asString(value[0]).then((string) => {
        return join(open, string, miss, signature[0], post, pattern[0], close)
          .then((message) => {
            return self.raise(message);
          });
      });
    });

  exports.AssertionFailure = AssertionFailure;
}());

(function () {
  var MatchFailure, pre;

  MatchFailure = LErr._refine(str("Match Failure"));
  pre = str("No case branches matched «");

  addRaise(MatchFailure, "ForObject()", 1, function (value) {
    var self = this;

    return join(pre, value, close).then((message) => {
      return self.raise(message);
    });
  });

  exports.MatchFailure = MatchFailure;
}());

(function () {
  var NoSuchValue, mid, pre;

  NoSuchValue = LErr._refine(str("No Such Value"));

  pre = str("No such value «");
  mid = str("» in object «");

  addRaise(NoSuchValue, "ForName() inObject()", [1, 1],
    function (name, object) {
      var self = this;

      return join(pre, name[0], mid, object[0], close).then((message) => {
        return self.raise(message);
      });
    });

  exports.NoSuchValue = NoSuchValue;
}());

(function () {
  var FailedSearch, pre;

  FailedSearch = LErr._refine(str("Failed Search"));

  pre = str("Could not find the object «");

  addRaise(FailedSearch, "ForObject()", 1, function (object) {
    var self = this;

    return join(pre, object, close).then((message) => {
      return self.raise(message);
    });
  });

  exports.FailedSearch = FailedSearch;
}());

(function () {
  var OutOfBounds, post, pre;

  OutOfBounds = LErr._refine(str("Out Of Bounds"),
    str("Attempted to index into a collection outside of its bounds"));

  pre = str("Access of a collection at index «");
  post = str("» outside of its bounds");

  addRaise(OutOfBounds, "ForIndex()", 1, function (rawIndex) {
    var self = this;

    return defs.Number.cast(rawIndex).then((index) => {
      return join(pre, index, post).then((message) => {
        return self.raise(message);
      });
    });
  });

  exports.OutOfBounds = OutOfBounds;
}());

exports.EmptyAccess = LErr._refine(str("Empty Access"),
  str("Attempted to access an element of an empty collection"));

(function () {
  var NotANumber, divide, mid, postOp, postParse, preOp, preParse;

  NotANumber = LErr._refine(str("Not A Number"));

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

    return rt.String.cast(rawString).then((string) => {
      return asString(string).then((primString) => {
        return join(preParse, primString, postParse).then((message) => {
          return self.raise(message);
        });
      });
    });
  });

  addRaise(NotANumber, "ForOperation() on()", [1, 1], function (name, num) {
    var self = this;

    return join(preOp, name[0], mid, num[0], postOp).then((message) => {
      return self.raise(message);
    });
  });

  exports.NotANumber = NotANumber;
}());

(function () {
  var CheckerFailure = Exception._refine(str("Checker Failure"));

  CheckerFailure.object.Packet.prototype.nodeOrIfAbsent =
    rt.method("nodeOrIfAbsent", 1, function (action) {
      return rt.Action.assert(action).then(() => {
        return action.apply();
      });
    });

  addRaise(CheckerFailure, "() forNode()", [1, 1], function (msg, node) {
    msg = msg[0];
    node = node[0];

    return this.raise(msg).then(null, (packet) => {
      packet.object.node = node;

      packet.nodeOrIfAbsent = rt.method("nodeOrIfAbsent", 1, function (action) {
        return rt.Action.assert(action).then(() => {
          return node;
        });
      });

      throw packet;
    });
  });

  addRaise(CheckerFailure, "ForNode()", 1, function (node) {
    return this.raiseDefault().then(null, (packet) => {
      packet.object.node = node;

      packet.nodeOrIfAbsent = rt.method("nodeOrIfAbsent", 1, function (action) {
        return rt.Action.assert(action).then(() => {
          return node;
        });
      });

      throw packet;
    });
  });

  exports.CheckerFailure = CheckerFailure;
}());
