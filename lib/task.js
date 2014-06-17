// A Promise-like implementation of asynchronous tasks. Tasks are compatible
// with Promise's 'thenable' definition, but are not compliant with the Promises
// specification.

"use strict";

var util = require("./util");

// Pump the task dependency queue and remove both queues when done.
function pump(task, list, arg) {
  task.isPending = false;

  while (list.length > 0) {
    list.shift()(arg);
  }

  delete task.onFulfilled;
  delete task.onRejected;
}

// Handle the outcome of a task.
function then(task, next, passthrough, resolve, reject) {
  return function (result) {
    var rejected;

    if (typeof next === "function") {
      rejected = false;

      try {
        result = next.call(task.context, result);
      } catch (error) {
        rejected = true;
        reject(error);
      } finally {
        if (!rejected) {
          resolve(result);
        }
      }
    } else {
      passthrough(result);
    }
  };
}

// new Task(context : Object = null, func : (Object -> (), Error -> ()) -> ())
//   Build a new task, running the given function with a resolve and reject
//   callback, optionally in the given context.
function Task(context, func) {
  var task = this;

  if (arguments.length < 2) {
    func = context;
    context = null;
  }

  this.isPending = true;
  this.context = context;

  this.onFulfilled = [];
  this.onRejected = [];

  func.call(context, function (value) {
    if (task.isPending) {
      task.value = value;
      pump(task, task.onFulfilled, value);
    }
  }, function (reason) {
    if (task.isPending) {
      task.reason = reason;
      pump(task, task.onRejected, reason);
    }
  });
}

Task.prototype.then = function (onFulfilled, onRejected) {
  var fresh, task;

  task = this;
  fresh = null;

  fresh = new Task(task.context, function (resolve, reject) {
    function handle(value) {
      if (fresh !== null && value === fresh) {
        throw new TypeError("A task cannot resolve to itself");
      }

      if (value instanceof Task) {
        value.then(function (value) {
          resolve(value);
        }, function (reason) {
          reject(reason);
        });
      } else {
        resolve(value);
      }
    }

    if (task.isPending) {
      task.onFulfilled.push(then(task, onFulfilled, handle, handle, reject));
      task.onRejected.push(then(task, onRejected, reject, handle, reject));
    } else if (util.owns(task, "value")) {
      then(task, onFulfilled, handle, handle, reject)(task.value);
    } else {
      then(task, onRejected, reject, handle, reject)(task.reason);
    }
  });

  return fresh;
};

Task.prototype.callback = function (callback) {
  return this.then(function (value) {
    callback.call(this, null, value);
  }, function (reason) {
    callback.call(this, reason);
  });
};

Task.prototype.bind = function (context) {
  var task = this.then(util.id);
  task.context = context;
  return task;
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

// each(context : Object = null,
//     lists+ : [T], action : T+ -> Task<U>) -> Task<[U]>
//   Run an asynchronous action over lists of arguments in order, chaining each
//   non-undefined result of the action into a list. Multiple lists must have
//   matching lengths. The context must not be an array, otherwise it must be
//   bound manually.
Task.each = function (context, first) {
  var action, i, j, l, length, results, part, parts;

  function run(i, task) {
    if (i === length) {
      return task.then(function () {
        return results;
      });
    }

    return run(i + 1, task.then(function () {
      return action.apply(this, parts[i]);
    }).then(function (value) {
      if (value !== undefined) {
        results.push(value);
      }
    }));
  }

  if (util.isArray(context)) {
    first = context;
    context = null;
  } else {
    Array.prototype.shift.call(arguments);
  }

  length = first.length;
  results = [];

  l = arguments.length - 1;
  action = arguments[l];
  parts = [];

  for (i = 0; i < l; i += 1) {
    if (arguments[i].length !== length) {
      throw new TypeError("Mismatched list lengths");
    }
  }

  // This is here to allow the list length check above to occur first.
  if (length === 0) {
    return Task.resolve(context, []);
  }

  for (i = 0; i < length; i += 1) {
    part = [];

    for (j = 0; j < l; j += 1) {
      part.push(arguments[j][i]);
    }

    parts.push(part);
  }

  return run(0, Task.resolve(context, null));
};

// Translate a function that may return a Task into a function that takes a
// callback. If the function throws, the error is bundled into the callback.
Task.callbackify = function (func) {
  return function () {
    var args, callback, rejected, task;

    args = util.slice(arguments);
    callback = args.pop();
    rejected = false;

    try {
      task = func.apply(this, args);
    } catch (reason) {
      rejected = true;
      callback(reason);
    } finally {
      if (!rejected) {
        Task.resolve(task).callback(callback);
      }
    }
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

module.exports = Task;

