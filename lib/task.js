// A Promise-like implementation of asynchronous tasks.

"use strict";

var util = require("./util");

exports.never = function (context) {
  if (arguments.length < 1) {
    context = null;
  }

  return new Promise(() => {});
};

// each(context : Object = null,
//     lists+ : [T], action : T+ -> Promise<U>) -> Promise<[U]>
//   Run an asynchronous action over lists of arguments in order, chaining each
//   non-undefined result of the action into a list. Multiple lists must have
//   matching lengths. The context must not be an array, otherwise it must be
//   bound manually.
exports.each = function (context, first) {
  var action, i, j, l, length, part, parts, results;

  function run(k, task) {
    if (k === length) {
      return task.then(() => {
        return results;
      });
    }

    return run(k + 1, task.then(() => {
      return action.apply(this, parts[k]);
    }).then((value) => {
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
    return Promise.resolve([]);
  }

  return run(0, Promise.resolve(null));
};

exports.callback = function (task, callback) {
  return task.then(callback && ((value) => {
    return callback(null, value);
  }), (reason) => {
    return callback(reason);
  });
};

// Translate a function that may return a task into a function that takes a
// callback. If the function throws, the error is bundled into the callback.
exports.callbackify = function (func) {
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

    return exports.callback(Promise.resolve(task), callback);
  };
};

// Translate a function that takes a callback into a function that returns a
// Promise. If the function throws, the task automatically rejects.
exports.taskify = function (context, func) {
  if (arguments.length < 2) {
    func = context;
    context = null;
  }

  return function () {
    var args, self;

    self = this;
    args = util.slice(arguments);

    return new Promise((resolve, reject) => {
      args.push((reason, value) => {
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
  return Promise.resolve(value);
};

Async.prototype.reject = function (reason) {
  return Promise.reject(reason);
};

Async.prototype.task = function (action) {
  return Promise.resolve(null).then(() => action.call(this));
};

Async.prototype.each = function () {
  return exports.each.apply(null, [this].concat(util.slice(arguments)));
};

exports.Async = Async;
