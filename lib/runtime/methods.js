// Built-in method definitions.

"use strict";

var Task, defs, rt, sequence, types, util;

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
      return rt.apply(object, "asString");
    })]);
  }).then(function (string) {
    return types.String.cast(string).then(function () {
      return string.asPrimitiveString();
    });
  }).then(function (string) {
    console.log(string);
    return defs.done;
  });
});

exports.while_do = rt.method("while() do()", [1, 1], function (wbl, dbl) {
  wbl = wbl[0];
  dbl = dbl[0];

  return types.Action.cast(wbl).then(function (wbl) {
    return types.Action.cast(dbl).then(function (dbl) {
      var ifFalse, ifTrue;

      function apply() {
        return wbl.apply().then(function (bool) {
          return bool.ifTrue_ifFalse([ifTrue], [ifFalse]);
        });
      }

      ifTrue = defs.block(0, function () {
        return dbl.apply().then(function () {
          return apply();
        });
      });

      ifFalse = defs.block(0, function () {
        return defs.done;
      });

      return apply();
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

function withAll(object, part) {
  if (object !== null) {
    return rt.inherit(sequence, "withAll", object, [part]);
  }

  return sequence.withAll(part);
}

sequence.empty = rt.constructor("empty", [[1, 0]], function (object, T) {
  return withAll(object, rt.part([T], [defs.sequence([])]));
});

sequence["with"] = rt.constructor("with", [[1, rt.gte(0)]],
  function (object, T) {
    return withAll(object, rt.part([T],
      [defs.sequence(util.slice(arguments, 2))]));
  });

sequence.withAll = rt.constructor("withAll", [[1, 1]],
  function (object, T, coll) {
    var elements = [];

    return rt.Do.cast(coll).then(function (coll) {
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

    exports[name] = rt.method(pretty, parts, function (cond) {
      var args = util.slice(arguments, 1);

      return defs.Boolean.cast(tail ? cond[0] : cond).then(function (cond) {
        var l = args.length - 1;

        return Task.each(args, function (arg, i) {
          if (tail) {
            if (i === l || i % 2 === 0) {
              return defs.Action.cast(arg[1]).then(function (action) {
                return [arg[0], action];
              });
            }

            return defs.Action.cast(arg[0]);
          }

          return defs.Action.cast(arg);
        }).then(function (args) {
          function repeat(cond, j) {
            var action;

            action = tail ? rt.block(0, function () {
              return args[j][1].apply().then(function (result) {
                return args[j][0].assert(result).then(function () {
                  return result;
                });
              });
            }) : args[j];

            return cond.ifTrue_ifFalse([action], rt.block(0, function () {
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

              return args[j + 1].apply().then(function (cond) {
                return defs.Boolean.cast(cond);
              }).then(function (cond) {
                return repeat(cond, j + 2);
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
    var args, l, pattern;

    pattern = match[0];
    args = util.slice(arguments, 1);

    l = match.length - 1;

    return Task.each(match.slice(0, l), function (pat) {
      return pattern["|"](pat).then(function (pat) {
        pattern = pat;
      });
    }).then(function () {
      match = match[l];
      return pattern.assert(match);
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
              })), [rt.block(0, function () {
                return repeat(j + 1);
              })]);
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
      var catches, fin;

      catches = util.slice(arguments, 1);

      if (tail) {
        fin = catches.pop();
      }

      return defs.Action.cast(trybl[1]).then(function (action) {
        return Task.each(catches, function (arg) {
          return defs.Function.cast(arg[1]).then(function (cat) {
            return [arg[0], cat];
          });
        }).then(function (catches) {
          function next(fin) {
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
                    return result.ifTrue_ifFalse([rt.block(0, function () {
                      return result.value().then(function (value) {
                        return catches[j][0].assert(value).then(function () {
                          return value;
                        });
                      });
                    })], [rt.block(0, function () {
                      return repeat(j + 1);
                    })]);
                  });
                }

                return repeat(0);
              }).then(fin, function (packet) {
                return fin().then(function () {
                  return packet.raise();
                }, function () {
                  return packet.raise();
                });
              });
          }

          if (tail) {
            return defs.Action.cast(fin).then(function (fin) {
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

