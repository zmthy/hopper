// A Promise-like implementation of asynchronous tasks. Tasks are compatible
// with Promise's 'thenable' definition, but are not compliant with the Promises
// specification.

"use strict";

var hop = Object.prototype.hasOwnProperty;

// Standard slice utility.
function slice(list, from, to) {
  return Array.prototype.slice.call(list, from, to);
}

// Pump the task dependency queue and remove both queues when done.
function pump(task, list, arg) {
  task.pending = false;

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

  this.pending = true;
  this.context = context;

  this.onFulfilled = [];
  this.onRejected = [];

  func.call(context, function (value) {
    if (task.pending) {
      task.value = value;
      pump(task, task.onFulfilled, value);
    }
  }, function (reason) {
    if (task.pending) {
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

    if (task.pending) {
      task.onFulfilled.push(then(task, onFulfilled, handle, handle, reject));
      task.onRejected.push(then(task, onRejected, reject, handle, reject));
    } else if (hop.call(task, "value")) {
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

// Translate a function that may return a Task into a function that takes a
// callback. If the function throws, the error is bundled into the callback.
Task.callbackify = function (func) {
  return function () {
    var args, callback, rejected, task;

    args = slice(arguments);
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
    args = slice(arguments);

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

