// A Promise-like implementation of asynchronous tasks.

"use strict";

var asap, timer, util;

require("setimmediate");

asap = require("asap");

util = require("./util");

timer = Date.now();

// new Task(context : Object = null, func : (Object -> (), Error -> ()) -> ())
//   Build a new task, running the given function with a resolve and reject
//   callback, optionally in the given context.
function Task(context, func) {
  if (arguments.length < 2) {
    func = context;
    context = null;
  }

  this.context = context;

  if (func instanceof Promise) {
    this.promise = func;
  } else {
    this.promise = new Promise(func.bind(this.context));
  }
}

Task.prototype.then = function (onResolved, onRejected) {
  var promise = this.promise;

  onResolved = onResolved && onResolved.bind(this.context);
  onRejected = onRejected && onRejected.bind(this.context);

  if (Date.now() - timer > 10) {
    return new Task(this.context, function (resolve, reject) {
      setImmediate(function () {
        timer = Date.now();
        promise.then(function (result) {
          if (onResolved) {
            try {
              Promise.resolve(onResolved(result)).then(resolve, reject);
            } catch (error) {
              reject(error);
            }
          } else {
            resolve(result);
          }
        }, function (reason) {
          if (onRejected) {
            try {
              Promise.resolve(onRejected(reason)).then(resolve, reject);
            } catch (error) {
              reject(error);
            }
          } else {
            reject(reason);
          }
        });
      });
    });
  }

  return new Task(this.context, promise.then(onResolved, onRejected));
};

Task.prototype.callback = function (callback) {
  return this.then(callback && function (value) {
    callback.call(this, null, value);
  }, callback);
};

Task.prototype.bind = function (context) {
  return new Task(context, this.promise);
};

Task.resolve = function (context, value) {
  if (arguments.length < 2) {
    value = context;
    context = null;
  }

  if (value instanceof Task) {
    return value;
  }

  return new Task(context, function (resolve) {
    resolve(value);
  });
};

Task.reject = function (context, reason) {
  if (arguments.length < 2) {
    reason = context;
    context = null;
  }

  return new Task(context, function (resolve, reject) {
    reject(reason);
  });
};

Task.never = function (context) {
  if (arguments.length < 1) {
    context = null;
  }

  return new Task(context, function () {
    return;
  });
};

// each(context : Object = null,
//     lists+ : [T], action : T+ -> Task<U>) -> Task<[U]>
//   Run an asynchronous action over lists of arguments in order, chaining each
//   non-undefined result of the action into a list. Multiple lists must have
//   matching lengths. The context must not be an array, otherwise it must be
//   bound manually.
Task.each = function (context, first) {
  var action, i, j, l, length, part, parts, results;

  function run(k, task) {
    if (k === length) {
      return task.then(function () {
        return results;
      });
    }

    return run(k + 1, task.then(function () {
      return action.apply(this, parts[k]);
    }).then(function (value) {
      if (value !== undefined) {
        results.push(value);
      }
    }));
  }

  if (util.isArray(context) ||
      typeof context === "number" || typeof context === "string") {
    first = context;
    context = null;
  } else {
    Array.prototype.shift.call(arguments);
  }

  results = [];
  parts = [];
  l = arguments.length - 1;
  action = arguments[l];

  if (typeof first === "number") {
    length = first;

    for (i = 0; i < length; i += 1) {
      parts.push([i]);
    }
  } else {
    length = first.length;

    for (i = 0; i < l; i += 1) {
      if (arguments[i].length !== length) {
        throw new TypeError("Mismatched list lengths");
      }
    }

    for (i = 0; i < length; i += 1) {
      part = [];

      for (j = 0; j < l; j += 1) {
        part.push(arguments[j][i]);
      }

      part.push(i);
      parts.push(part);
    }
  }

  // This is here to allow the list length check above to occur first.
  if (length === 0) {
    return Task.resolve(context, []);
  }

  return run(0, Task.resolve(context, null));
};

// Translate a function that may return a task into a function that takes a
// callback. If the function throws, the error is bundled into the callback.
// The resulting function returns another function which will call 'stop' on the
// underlying task.
Task.callbackify = function (func) {
  return function () {
    var args, callback, task;

    args = util.slice(arguments);
    callback = args.pop();

    try {
      task = func.apply(this, args);
    } catch (reason) {
      callback(reason);

      return function () {
        return false;
      };
    }

    return Task.resolve(task).callback(callback).stopify();
  };
};

// Translate a function that takes a callback into a function that returns a
// Task. If the function throws, the task automatically rejects.
Task.taskify = function (context, func) {
  if (arguments.length < 2) {
    func = context;
    context = null;
  }

  return function () {
    var args, self;

    self = this;
    args = util.slice(arguments);

    return new Task(context, function (resolve, reject) {
      args.push(function (reason, value) {
        if (reason !== null) {
          reject(reason);
        } else {
          resolve(value);
        }
      });

      try {
        func.apply(self, args);
      } catch (reason) {
        reject(reason);
      }
    });
  };
};

// An abstract constructor that includes helpers for maintaining the state of
// the 'this' context while performing task operations.
function Async() {
  return this;
}

// Resolve to a task with this object as the context.
Async.prototype.resolve = function (value) {
  return Task.resolve(this, value);
};

Async.prototype.reject = function (reason) {
  return Task.reject(this, reason);
};

Async.prototype.task = function (action) {
  return Task.resolve(this, null).then(function () {
    return action.call(this);
  });
};

Async.prototype.each = function () {
  return Task.each.apply(Task, [this].concat(util.slice(arguments)));
};

Task.Async = Async;

module.exports = Task;
