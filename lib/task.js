// A Promise-like implementation of asynchronous tasks. Tasks are compatible
// with Promise's 'thenable' definition, but are not compliant with the Promises
// specification.

"use strict";

var asap, util;

asap = require("asap");

util = require("./util");

function DeferralError() {
  var error = new TypeError(this.message);
  error.name = this.name;
  this.stack = error.stack;
}

util.inherits(DeferralError, TypeError);

DeferralError.prototype.name = "DeferralError";

DeferralError.prototype.message = "A purely asynchronous task cannot be forced";

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
function completion(task, next, passthrough, resolve, reject) {
  return function (result) {
    if (typeof next === "function") {
      try {
        result = next.call(task.context, result);
      } catch (error) {
        reject(error);
        return;
      }

      resolve(result);
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

function then(task, run) {
  var fresh, reject, resolve;

  fresh = new Task(task.context, function (res, rej) {
    // We need to get back out of the task in order to allow it to refer to
    // itself.
    resolve = res;
    reject = rej;
  });

  run.call(task, function (value, force) {
    if (value === fresh) {
      throw new TypeError("A task must not resolve to itself");
    }

    if (value instanceof Task) {
      if (value.isPending) {
        value[force ? "now" : "then"](resolve).then(null, reject);
      } else {
        if (util.owns(value, "value")) {
          resolve(value.value);
        } else {
          reject(value.reason);
        }
      }
    } else {
      resolve(value);
    }
  }, reject, fresh);

  return fresh;
}

Task.prototype.then = function (onFulfilled, onRejected) {
  return then(this, function (res, reject, fresh) {
    var task = this;

    fresh.deferred = util.once(function (force) {
      delete fresh.deferred;

      function resolve(value) {
        res(value, force);
      }

      function fulfiller(task) {
        return completion(task, onFulfilled, resolve, resolve, reject);
      }

      function rejecter(task) {
        return completion(task, onRejected, reject, resolve, reject);
      }

      if (force && util.owns(task, "deferred")) {
        task.deferred(force);
      }

      if (task.isPending) {
        task.onFulfilled.push(fulfiller(task));
        task.onRejected.push(rejecter(task));
      } else {
        if (util.owns(task, "value")) {
          fulfiller(task)(task.value);
        } else {
          rejecter(task)(task.reason);
        }
      }
    });

    asap(fresh.deferred);
  });
};

// Execute the callbacks immediately if this task is complete. If this task is
// still pending, attempt to force the task to finish. If the task cannot be
// forced, then the resulting task is rejected.
Task.prototype.now = function (onFulfilled, onRejected) {
  if (util.owns(this, "deferred")) {
    this.deferred(true);
  }

  if (this.isPending) {
    return Task.reject(new DeferralError());
  }

  return then(this, function (res, reject) {
    function resolve(value) {
      res(value, true);
    }

    if (util.owns(this, "value")) {
      completion(this, onFulfilled, resolve, resolve, reject)(this.value);
    } else {
      completion(this, onRejected, reject, resolve, reject)(this.reason);
    }
  });
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

/*jslint unparam: true*/
Task.reject = function (context, reason) {
  if (arguments.length < 2) {
    reason = context;
    context = null;
  }

  return new Task(context, function (resolve, reject) {
    reject(reason);
  });
};
/*jslint unparam: false*/

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

  if (util.isArray(context) || typeof context === "number") {
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

