// Built-in method definitions.

"use strict";

var Task, defs, ffi, rt, sequence, types, util;

Task = require("../task");
rt = require("../runtime");
util = require("../util");

defs = require("./definitions");
types = require("./types");

exports.print = rt.method("print()", 1, function (object) {
  return types.String.match(object).then(function (isString) {
    return isString.ifTrue_ifFalse([
      defs.block(0, function () {
        return object;
      })
    ], [
      defs.block(0, function () {
        return rt.apply(object, "asString");
      })
    ]);
  }).then(function (string) {
    return types.String.cast(string).then(function () {
      return string.asPrimitiveString();
    });
  }).then(function (string) {
    console.log(string);
    return defs.done;
  });
});

exports.while_do = rt.method("while() do()", [ 1, 1 ], function (pWbl, pDbl) {
  return types.Action.cast(pWbl[0]).then(function (wbl) {
    return types.Action.cast(pDbl[0]).then(function (dbl) {
      return new Task(function (resolve, reject, task) {
        var ifFalse, ifTrue;

        function apply() {
          if (!task.isStopped) {
            task.waitingOn = wbl.apply().then(function (bool) {
              return bool.ifTrue_ifFalse([ ifTrue ], [ ifFalse ]);
            }).then(null, reject);
          }
        }

        ifTrue = defs.block(0, function () {
          return dbl.apply().then(function () {
            apply();
            return defs.done;
          });
        });

        ifFalse = defs.block(0, function () {
          resolve(defs.done);
          return defs.done;
        });

        // Stopping the inner task may happen too late to avoid triggering a new
        // iteration, which will cause the outer task to report that it has
        // stopped while the loop actually continues. Overriding stop ensures
        // that the no new task is spawned, and the outer task is successfully
        // rejected with the appropriate error.
        task.stop = function () {
          this.isStopped = true;
          Task.prototype.stop.call(task);
        };

        apply();
      });
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

        if (object[name] === undefined &&
            typeof value === "function" && !value.isConfidential) {
          method = function () {
            return value.apply(this || object, arguments);
          };

          util.extend(method, value);

          object[name] = method;
        }
      });
    }).then(function () {
      return object;
    });
  });

sequence = defs.object();

function withAll(object, T, seq) {
  var part = rt.part([ T ], [ seq ]);

  if (object !== null) {
    return this.withAll.inherit.call(this, object, part);
  }

  return this.withAll(part);
}

sequence.empty = rt.constructor("empty", [ [ 1, 0 ] ], function (object, T) {
  return withAll.call(this, object, T, defs.sequence([]));
});

sequence["with"] = rt.constructor("with", [ [ 1, rt.gte(0) ] ],
  function (object, T) {
    return withAll.call(this, object, T,
      defs.sequence(util.slice(arguments, 2)));
  });

sequence.withAll = rt.constructor("withAll", [ [ 1, 1 ] ],
  function (object, T, rawColl) {
    var elements = [];

    return rt.Do.cast(rawColl).then(function (coll) {
      return coll["do"](rt.block(1, function (element) {
        return T.assert(element).then(function () {
          elements.push(element);
          return rt.done;
        });
      }));
    }).then(function () {
      var seq = rt.sequence(elements);

      if (object !== null) {
        util.extendAll(object, seq);
      }

      return seq;
    });
  });

sequence.asString = rt.method("asString", 0, function () {
  return rt.string("sequence");
});

exports.sequence = rt.method("sequence", 0, function () {
  return sequence;
});

ffi = defs.object();

ffi.global = rt.method("global", 0, function () {
  return global;
});

ffi["new"] = rt.method("new()", rt.gte(1), function (Constructor) {
  return util.newApply(Constructor, util.slice(arguments, 1));
});

ffi["delete"] = rt.method("delete()", 2, function (object, rawName) {
  return defs.String.cast(rawName).then(function (name) {
    if (defs.isGraceObject(object)) {
      return defs.RuntimeError
        .raise(defs.string("Cannot delete methods from Grace objects"));
    }

    return name.asPrimitiveString().then(function (primName) {
      delete object[primName];
      return defs.done;
    });
  });
});

ffi.asString = rt.method("asString", 0, function () {
  return rt.string("ffi");
});

exports.ffi = ffi;

function generate(i, func) {
  var l;

  for (l = 20 + i; i < l; i += 1) {
    func(i);
  }
}

function makeIfThens(tail) {
  generate(0, function (i) {
    var name, parts, pretty;

    pretty = "if() then()" + util.replicate(i, " elseIf() then()").join("") +
      (tail ? " else()" : "");

    name = util.uglify(pretty);

    if (tail) {
      parts = [ 1, [ 1, 1 ] ].concat(util.repeat(i, [ 1, [ 1, 1 ] ]));
      parts.push([ 1, 1 ]);
    } else {
      parts = [ 1, 1 ].concat(util.replicate(i * 2, 1));
    }

    exports[name] = rt.method(pretty, parts, function (pCond) {
      var rawArgs = util.slice(arguments, 1);

      return defs.Boolean.cast(pCond[0]).then(function (cond) {
        var l = rawArgs.length - 1;

        return Task.each(rawArgs, function (arg, j) {
          if (tail && (j === l || j % 2 === 0)) {
            return defs.Action.cast(arg[1]).then(function (action) {
              return [ arg[0], action ];
            });
          }

          return defs.Action.cast(arg[0]);
        }).then(function (args) {
          function repeat(currCond, j) {
            var action;

            action = tail ? rt.block(0, function () {
              return args[j][1].apply().then(function (result) {
                return args[j][0].assert(result).then(function () {
                  return result;
                });
              });
            }) : args[j];

            return currCond.ifTrue_ifFalse([ action ], rt.block(0, function () {
              if (tail && j + 1 === l) {
                return args[l][1].apply().then(function (result) {
                  return args[l][0].assert(result).then(function () {
                    return result;
                  });
                });
              }

              if (j === l) {
                return rt.done;
              }

              return args[j + 1].apply().then(function (nextCond) {
                return defs.Boolean.cast(nextCond);
              }).then(function (nextCond) {
                return repeat(nextCond, j + 2);
              });
            }));
          }

          return repeat(cond, 0).then(tail ? null : function () {
            return rt.done;
          });
        });
      });
    });
  });
}

makeIfThens(false);
makeIfThens(true);

generate(1, function (i) {
  var name, parts, pretty;

  pretty = "match()" + util.replicate(i, " case()").join("");
  name = util.uglify(pretty);

  parts = [ [ i, 1 ] ].concat(util.replicate(i, [ 1, 1 ]));

  exports[name] = rt.method(pretty, parts, function (match) {
    var args, l, pattern;

    pattern = match[0];
    args = util.slice(arguments, 1);

    l = match.length - 1;

    return Task.each(match.slice(0, l), function (pat) {
      return pattern["|"](pat).then(function (orPat) {
        pattern = orPat;
      });
    }).then(function () {
      match = match[l];
      return pattern.assert(match);
    }).then(function () {
      return Task.each(args, function (arg) {
        return defs.Function.cast(arg[1]).then(function (func) {
          return [ arg[0], func ];
        });
      }).then(function (cases) {
        function repeat(j) {
          if (j === cases.length) {
            return defs.MatchFailure.raiseForObject(match);
          }

          return cases[j][1].match(match).then(function (result) {
            return result
              .ifTrue_ifFalse(rt.part(cases[j][0], rt.block(0, function () {
                return result.value();
              })), [
                rt.block(0, function () {
                  return repeat(j + 1);
                })
              ]);
          });
        }

        return repeat(0);
      });
    });
  });
});

function makeTryCatches(tail) {
  generate(0, function (i) {
    var name, parts, pretty;

    pretty = "try()" + util.replicate(i, " catch()").join("") +
      (tail ? " finally()" : "");

    name = util.uglify(pretty);

    parts = [ [ 1, 1 ] ].concat(util.replicate(i, [ 1, 1 ]));

    if (tail) {
      parts.push(1);
    }

    exports[name] = rt.method(pretty, parts, function (trybl) {
      var args, rawFin;

      args = util.slice(arguments, 1);

      if (tail) {
        rawFin = args.pop();
      }

      return defs.Action.cast(trybl[1]).then(function (action) {
        return Task.each(args, function (arg) {
          return defs.Function.cast(arg[1]).then(function (cat) {
            return [ arg[0], cat ];
          });
        }).then(function (catches) {
          function next(onFin) {
            return action.apply().then(null, rt.handleInternalError)
              .then(function (value) {
                return trybl[0].assert(value).then(function () {
                  return value;
                });
              }, function (packet) {
                function repeat(j) {
                  if (j === catches.length) {
                    return packet.raise();
                  }

                  return catches[j][1].match(packet).then(function (result) {
                    return result.ifTrue_ifFalse([
                      rt.block(0, function () {
                        return result.value().then(function (value) {
                          return catches[j][0].assert(value).then(function () {
                            return value;
                          });
                        });
                      })
                    ], [
                      rt.block(0, function () {
                        return repeat(j + 1);
                      })
                    ]);
                  });
                }

                return repeat(0);
              }).then(onFin, function (packet) {
                function raise() {
                  return packet.raise();
                }

                return onFin().then(raise, raise);
              });
          }

          if (tail) {
            return defs.Action.cast(rawFin).then(function (fin) {
              return next(function (value) {
                return fin.apply().then(function () {
                  return value;
                }, function () {
                  return value;
                });
              });
            });
          }

          return next(Task.resolve);
        });
      });
    });
  });
}

makeTryCatches(false);
makeTryCatches(true);
