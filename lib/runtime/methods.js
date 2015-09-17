// Built-in method definitions.

"use strict";

var Task, defs, dictionary, list, pattern, prim, rt, set, types, util;

Task = require("../task");
rt = require("../runtime");
util = require("../util");

defs = require("./definitions");
prim = require("./primitives");
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

exports.while_do = rt.method("while() do()", [1, 1], function (pWbl, pDbl) {
  return types.Action.cast(pWbl[0]).then(function (wbl) {
    return types.Action.cast(pDbl[0]).then(function (dbl) {
      return new Task(function (resolve, reject, task) {
        var ifFalse, ifTrue;

        function apply() {
          if (!task.isStopped) {
            task.waitingOn = wbl.apply().then(function (bool) {
              return bool.ifTrue_ifFalse([ifTrue], [ifFalse]);
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

list = defs.object();

function withAll(object, generics, coll) {
  var part = rt.part(generics, [coll]);

  if (object !== null) {
    return this.withAll.inherit.call(this, object, part);
  }

  return this.withAll(part);
}

list.empty = rt.constructor("empty", [[1, 0]], function (object, T) {
  return withAll.call(this, object, [T], defs.list([]));
});

list["with"] = rt.constructor("with", [[1, rt.gte(0)]],
  function (object, T) {
    return withAll.call(this, object, [T],
      defs.list(util.slice(arguments, 2)));
  });

list.withAll = rt.constructor("withAll", [[1, 1]],
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
      var seq = rt.list(elements);

      if (object !== null) {
        util.extendAll(object, seq);
      }

      return seq;
    });
  });

list.asString = rt.method("asString", 0, function () {
  return rt.string("list");
});

exports.list = rt.method("list", 0, function () {
  return list;
});

set = defs.object();

set.empty = rt.constructor("empty", [[1, 0]], function (object, T) {
  return withAll.call(this, object, [T], defs.set([]));
});

set["with"] = rt.constructor("with", [[1, rt.gte(0)]],
  function (object, T) {
    return withAll
      .call(this, object, [T], defs.set(util.slice(arguments, 2)));
  });

set.withAll = rt.constructor("withAll", [[1, 1]],
  function (object, T, rawColl) {
    var aSet = defs.set([]);

    return rt.Do.cast(rawColl).then(function (coll) {
      return coll["do"](rt.block(1, function (add) {
        return T.assert(add).then(function () {
          return aSet.internalPush(add);
        });
      }));
    }).then(function () {
      if (object !== null) {
        util.extendAll(object, aSet);
      }

      return aSet;
    });
  });

set.asString = rt.method("asString", 0, function () {
  return rt.string("set");
});

exports.set = rt.method("set", 0, function () {
  return set;
});

dictionary = defs.object();

dictionary.empty = rt.constructor("empty", [[2, 0]],
  function (object, K, V) {
    return withAll.call(this, object, [K, V], defs.dictionary([]));
  });

dictionary["with"] = rt.constructor("with", [[2, rt.gte(0)]],
  function (object, K, V) {
    return withAll
      .call(this, object, [K, V], defs.dictionary(util.slice(arguments, 3)));
  });

dictionary.withAll = rt.constructor("withAll", [[2, 1]],
  function (object, K, V, rawColl) {
    var aDict = defs.dictionary([]);

    return rt.Do.cast(rawColl).then(function (coll) {
      return coll["do"](rt.block(1, function (rawAdd) {
        return defs.Entry.cast(rawAdd).then(function (add) {
          return add.key().then(function (key) {
            return add.value().then(function (value) {
              return aDict.internalPush(defs.entry(key, value));
            });
          });
        });
      }));
    }).then(function () {
      if (object !== null) {
        util.extendAll(object, aDict);
      }

      return aDict;
    });
  });

dictionary.asString = rt.method("asString", 0, function () {
  return rt.string("dictionary");
});

exports.dictionary = rt.method("dictionary", 0, function () {
  return dictionary;
});

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
      parts = [1, [1, 1]].concat(util.repeat(i, [1, [1, 1]]));
      parts.push([1, 1]);
    } else {
      parts = [1, 1].concat(util.replicate(i * 2, 1));
    }

    exports[name] = rt.method(pretty, parts, function (pCond) {
      var rawArgs = util.slice(arguments, 1);

      return defs.Boolean.cast(pCond[0]).then(function (cond) {
        var l = rawArgs.length - 1;

        return Task.each(rawArgs, function (arg, j) {
          if (tail && (j === l || j % 2 === 0)) {
            return defs.Action.cast(arg[1]).then(function (action) {
              return [arg[0], action];
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

            return currCond.ifTrue_ifFalse([action], rt.block(0, function () {
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

  parts = [[i, 1]].concat(util.replicate(i, [1, 1]));

  exports[name] = rt.method(pretty, parts, function (match) {
    var args, l, patt;

    patt = match[0];
    args = util.slice(arguments, 1);

    l = match.length - 1;

    return Task.each(match.slice(0, l), function (pat) {
      return patt["|"](pat).then(function (orPat) {
        patt = orPat;
      });
    }).then(function () {
      match = match[l];
      return patt.assert(match);
    }).then(function () {
      return Task.each(args, function (arg) {
        return defs.Function.cast(arg[1]).then(function (func) {
          return [arg[0], func];
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

    parts = [[1, 1]].concat(util.replicate(i, [1, 1]));

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
            return [arg[0], cat];
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

pattern = defs.object();

pattern["abstract"] = rt.constructor("abstract", 0, function (object) {
  var abs = new prim.AbstractPattern();

  if (!object) {
    return defs.Pattern.assert(abs);
  }

  util.extendAll(object, abs);
  return object;
});

pattern.singleton = rt.constructor("singleton", 0, function (object) {
  var sing = new prim.Singleton();

  if (object) {
    util.extendAll(object, sing);
    return object;
  }

  return sing;
});

pattern.asString = rt.method("asString", 0, function () {
  return defs.string("pattern");
});

exports.pattern = rt.method("pattern", 0, function () {
  return pattern;
});
