// Built-in method definitions.

"use strict";

var Task, defs, rt, types, util;

Task = require("../task");
rt = require("../runtime");
util = require("../util");

defs = require("./definitions");
types = require("./types");

exports.print = rt.method("print()", 1, function (object) {
  return types.String.match(object).then(function (isString) {
    return isString.ifTrue_ifFalse([defs.block(0, function () {
      return object;
    })], [defs.block(0, function () {
      return object.asString();
    })]);
  }).then(function (string) {
    return string.asPrimitiveString();
  }).then(function (string) {
    console.log(string);
    return defs.done;
  });
});

exports.while_do = rt.method("while() do()", [1, 1], function (wbl, dbl) {
  wbl = wbl[0];
  dbl = dbl[0];

  return types.Action.match(wbl).then(function () {
    return types.Action.match(dbl);
  }).then(function () {
    var ifFalse, ifTrue;

    function apply() {
      return rt.apply(wbl, "apply", []).then(function (bool) {
        return bool.ifTrue_ifFalse([ifTrue], [ifFalse]);
      });
    }

    ifTrue = defs.block(0, function () {
      return rt.apply(dbl, "apply", []).then(function () {
        return apply();
      });
    });

    ifFalse = defs.block(0, function () {
      return defs.done;
    });

    return apply();
  });
});


exports.try_catch = rt.method("try() catch()", [1, 1], function (tbl, cbl) {
  tbl = tbl[0];
  cbl = cbl[0];

  return types.Action.match(tbl).then(function () {
    return types.Action.match(cbl);
  }).then(function () {
    return tbl.apply();
  }).then(null, function (packet) {
    return cbl.match(packet).then(function (match) {
      return match.ifTrue_ifFalse([defs.block(0, function () {
        return match.result();
      })], [defs.block(0, function () {
        return packet.raise();
      })]);
    });
  });
});

exports.delegateTo = rt.constructor("delegateTo()", rt.gte(1),
  function (object) {
    var delegates;

    object = object || rt.object();

    delegates = util.slice(arguments, 1);

    return Task.each(delegates, function (delegate) {
      util.forProperties(delegate, function (name, value) {
        var method;

        if (object[name] === undefined && typeof value === "function") {
          method = function () {
            return value.apply(object, arguments);
          };

          util.extend(method, value);

          object[name] = method;
        }
      });
    }).then(function () {
      return object;
    });
  });

