// A Promise-like implementation of asynchronous tasks. Tasks are compatible
// with Promise's 'thenable' definition, but are not compliant with the Promises
// specification.

"use strict";

var asap, timer, util;

require("setimmediate");

asap = require("asap");

util = require("./util");

timer = Date.now();

function DeferralError(message) {
  var error;

  if (message !== undefined) {
    this.message = message;
  }

  error = new TypeError(this.message);
  error.name = this.name;
  this.stack = error.stack;
}

util.inherits(DeferralError, TypeError);

DeferralError.prototype.name = "DeferralError";

DeferralError.prototype.message = "A purely asynchronous task cannot be forced";

function InterruptError(message) {
  var error;

  if (message !== undefined) {
    this.message = message;
  }

  error = new Error(this.message);
  error.name = this.name;
  this.stack = error.stack;
}

util.inherits(InterruptError, Error);

InterruptError.prototype.name = "InterruptError";

InterruptError.prototype.message = "A task was stopped before it completed";

// Pump the task dependency queue and remove both queues when done.
function pump(task, list, arg) {
  task.isPending = false;

  while (list.length > 0) {
    list.shift()(arg);
  }

  delete task.onFulfilled;
  delete task.onRejected;
}

// Handle passing the outcome of a task to the next.
function completion(task, fresh, next, passthrough, resolve, reject) {
  return function (result) {
    // Regardless of whether or not the fresh task still depended on the outcome
    // of the previous task, it can't be waiting on it any longer (because it's
    // finished). This property may be reinstated by the call to 'next' below,
    // as the fresh task can now depend on the result of one of the functions
    // passed to 'next' (or 'now').
    delete fresh.waitingOn;

    // Due to the presence of 'stop', the fresh task may have already completed
    // before the task it depended on did. In this case, don't perform the next
    // action.
    if (fresh.isPending) {
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
    }
  };
}

// new Task(context : Object = null, func : (Object -> (), Error -> ()) -> ())
//   Build a new task, running the given function with a resolve and reject
//   callback, optionally in the given context.
function Task(context, func) {
  var self = this;

  if (arguments.length < 2) {
    func = context;
    context = null;
  }

  this.isPending = true;
  this.context = context;

  this.onFulfilled = [];
  this.onRejected = [];

  func.call(context, function (value) {
    if (self.isPending) {
      self.value = value;
      pump(self, self.onFulfilled, value);
    }
  }, function (reason) {
    if (self.isPending) {
      self.reason = reason;
      pump(self, self.onRejected, reason);
    }
  }, this);
}

function then(task, run) {
  return new Task(task.context, function (resolve, reject, fresh) {
    // A task can be waiting on one of two tasks: either it is waiting for a
    // value to be produced by the original task the 'then' method was called
    // on, or it is waiting for the task created by the function passed to
    // 'then'. In this case, it is waiting for the former. Note that the
    // original task may have already completed, in which case it will switch to
    // waiting on the latter.
    fresh.waitingOn = task;

    run.call(task, function (value, force) {
      if (value === fresh) {
        throw new TypeError("A task must not resolve to itself");
      }

      if (value instanceof Task) {
        if (value.isPending) {
          // The original task is done, and the function that ran as a result
          // has produced a new task, meaning the fresh task now depends on that
          // instead. Note that we cannot get here if the fresh task is stopped
          // before the original task completes.
          fresh.waitingOn = value;
          value[force ? "now" : "then"](resolve).then(null, reject);
        } else if (util.owns(value, "value")) {
          resolve(value.value);
        } else {
          reject(value.reason);
        }
      } else {
        resolve(value);
      }
    }, reject, fresh);
  });
}

Task.prototype.then = function (onFulfilled, onRejected) {
  return then(this, function (res, reject, fresh) {
    var deferred, self;

    self = this;

    deferred = util.once(function (force) {
      delete fresh.deferred;

      function resolve(value) {
        res(value, force);
      }

      function fulfiller() {
        return completion(self, fresh, onFulfilled, resolve, resolve, reject);
      }

      function rejecter() {
        return completion(self, fresh, onRejected, reject, resolve, reject);
      }

      if (force && util.owns(self, "deferred")) {
        self.deferred(force);
      }

      if (self.isPending) {
        self.onFulfilled.push(fulfiller());
        self.onRejected.push(rejecter());
      } else if (util.owns(self, "value")) {
        fulfiller()(self.value);
      } else {
        rejecter()(self.reason);
      }
    });

    fresh.deferred = deferred;

    if (Date.now() - timer > 10) {
      setImmediate(function () {
        timer = Date.now();
        deferred();
      });
    } else {
      asap(deferred);
    }
  });
};

// Execute the callbacks immediately if this task is complete. If this task is
// still pending, attempt to force the task to finish. If the task cannot be
// forced, then the resulting task is rejected with a DeferralError.
Task.prototype.now = function (onFulfilled, onRejected) {
  if (util.owns(this, "deferred")) {
    this.deferred(true);
  }

  if (this.isPending) {
    return Task.reject(new DeferralError());
  }

  return then(this, function (res, reject, fresh) {
    function resolve(value) {
      res(value, true);
    }

    if (util.owns(this, "value")) {
      completion(this,
        fresh, onFulfilled, resolve, resolve, reject)(this.value);
    } else {
      completion(this, fresh, onRejected, reject, resolve, reject)(this.reason);
    }
  });
};

Task.prototype.callback = function (callback) {
  return this.then(callback && function (value) {
    callback.call(this, null, value);
  }, callback);
};

Task.prototype.bind = function (context) {
  var task = this.then(util.id);
  task.context = context;
  return task;
};

// Halt the execution of this task and tasks it depends on. If the task has not
// already completed, called this method causes this task and its dependencies
// to be rejected with an InterruptError. This method does not guarantee an
// immediate stop, as tasks may yield outside of the internal task machinery,
// and their resumption may have side-effects before completing their
// surrounding task.
//
// Note that tasks that have been spawned by the task dependency chain that are
// not included in the dependency chain (ie concurrent executions) will not be
// stopped by this method. They must be managed separately.
Task.prototype.stop = function () {
  var dependency;

  if (!this.isPending) {
    // If the task is already completed, stopping has no effect.
    return;
  }

  // It's possible to be waiting on a task that isn't pending, when this task
  // is being synchronously stopped after the task it depends on has completed,
  // but before the asynchronous chaining can occur. If this is the case, we'll
  // pump now, setting this task to a completed state, and when the asynchronous
  // completion runs in the future the waitingOn dependency will be deleted but
  // no other action will be taken.
  if (this.waitingOn !== undefined && this.waitingOn.isPending) {
    // The rejection of this task will occur once the dependency chain is also
    // rejected.
    dependency = this.waitingOn;
    asap(function () {
      dependency.stop();
    });
  } else {
    this.reason = new InterruptError();
    pump(this, this.onRejected, this.reason);
  }
};

// A utility method to produce a function that will stop this task when called.
Task.prototype.stopify = function () {
  var self = this;

  return function () {
    return self.stop();
  };
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

Task.DeferralError = DeferralError;
Task.InterruptError = InterruptError;
Task.Async = Async;

module.exports = Task;
