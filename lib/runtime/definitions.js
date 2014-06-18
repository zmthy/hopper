// Individual objects and helper methods for the runtime.

"use strict";

var Action, Exception, Num, Pattern, Unknown, bools, done, prim, rt, util;

prim = require("./primitives");
rt = require("../runtime");
util = require("../util");

function object() {
  return new prim.GraceObject();
}

exports.object = object;

exports.isGraceObject = function (value) {
  return value instanceof prim.GraceObject;
};

exports.base = prim.GraceObject.prototype;

function bool(value) {
  if (value) {
    return bools[true];
  }

  return bools[false];
}

exports.bool = bool;

exports.number = function (value) {
  return new prim.GraceNumber(value);
};

function string(value) {
  return new prim.GraceString(value);
}

exports.string = string;

function type(name, names) {
  return new prim.Type(name, names);
}

exports.type = type;

exports.proxy = function () {
  return new prim.TypeProxy();
};

exports.named = function (name, pattern) {
  return new prim.NamedPattern(name, pattern);
};

function success(value) {
  return new prim.Success(value);
}

exports.success = success;

function failure(value) {
  return new prim.Failure(value);
}

exports.failure = failure;

exports.match = function (bool, value) {
  return bool ? success(value) : failure(value);
};

exports.list = function (elements) {
  return new prim.List(elements);
};

exports.listOf = function (pattern) {
  return new prim.ListPattern(pattern || Unknown);
};

bools = {
  "true": new prim.True(),
  "false": new prim.False()
};

done = object();

done.asString = rt.newMethod("asString", 0, function () {
  return string("done");
});

exports.done = done;

Unknown = new prim.AbstractPattern();

Unknown.match = rt.newMethod("match()", 1, function () {
  return bool(true);
});

Unknown.asString = rt.newMethod("asString", 0, function () {
  return string("Unknown");
});

exports.Unknown = Unknown;

Exception = new prim.Exception(string("Exception"), prim.ExceptionPacket);

exports.Exception = Exception;

Exception.refine(string("Internal Error")).then(function (InternalError) {
  var match = InternalError.match;

  InternalError.match = rt.newMethod("match()", 1, function (value) {
    if (value instanceof Error) {
      return success(value);
    }

    return match.call(this, value);
  });

  exports.InternalError = InternalError;
});

Exception.refine(string("Assertion Failure")).then(function (AssertionFailure) {
  var message = string(" does not match pattern ");

  AssertionFailure.raiseForValue_againstPattern =
    rt.newMethod("raiseForValue() againstPattern()",
      [1, 1], function (value, pattern) {
        var self = this;

        return value[0].asString().then(function (value) {
          return value["++"](message).then(function (string) {
            return string["++"](pattern[0]).then(function (string) {
              return self.raiseMessage(string);
            });
          });
        });
      });

  exports.AssertionFailure = AssertionFailure;
});

Exception
  .refine_withDefaultMessage([string("Uninstantiated Type")],
    [string("Type is not yet instantiated")])
  .then(function (UninstantiatedType) {
    exports.UninstantiatedType = UninstantiatedType;
  });

Exception.refine(string("Out Of Bounds")).then(function (OutOfBounds) {
  var message = string("Index ");

  OutOfBounds.raiseForIndex =
    rt.newMethod("raiseForIndex()", 1, function (index) {
      var self = this;

      return Num.assert(index).then(function () {
        return message["++"](index).then(function (string) {
          return self.raiseMessage(string);
        });
      });
    });

  exports.OutOfBounds = OutOfBounds;
});

Action = type("Action", ["apply"]);

// TODO Implement this in a way that does not cause a stack overflow from the
// re-assertion in orElse().
Action.assert = rt.newMethod("assert()", 1, function () {
  return done;
});

exports.Action = Action;

exports.Any = type("Object", []);

exports.Boolean = type("Boolean",
  ["andAlso orElse", "andAlso", "orElse", "&&", "||", "prefix!"]);

exports.Match = type("Match",
  ["andAlso orElse", "andAlso", "orElse", "&&", "||", "prefix!", "value"]);

Num = type("Number", ["asPrimitiveNumber"]);

exports.Number = Num;

exports.List = type("List", ["doForEach", "++"]);

exports.String = type("String", ["asPrimitiveString", "++"]);

Pattern = type("Pattern", ["match", "&", "|"]);

exports.Pattern = Pattern;

