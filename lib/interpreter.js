// The Grace interpreter. Exposes both the Interpreter constructor and the
// helper function 'interpret' which executes on an anonymous Interpreter.
//
// Almost every function in the interpreter runs asynchronously, taking a
// callback as its last argument that expects an error and a result as its
// parameters. This asynchronous behaviour allows the interpreter to take
// single-tick breaks on each method request, freeing up the event loop.
// Standard JavaScript functions can be marked as asynchronous by attaching an
// 'asynchronous' property with a truthy value to the function. All functions
// built by the interpreter from Method nodes in the AST are asynchronous by
// default, but a user will be able to disable this in the future with an
// annotation (this functionality is necessary for interacting with standard
// JavaScript).
//
// The asynchronous behaviour of the whole interpreter can be turned off
// wholesale by passing false to the constructor or by setting the
// 'asynchronous' property to false. The interface will still asynchronous, but
// the 'asynchronous' property of functions will be ignored and the interpreter
// will not take single-tick breaks. This can also be achieved with the
// 'interpret' helper by simply not passing a callback.

"use strict";

var ast, hop, proto, runtime, undefined;

require("setimmediate");

ast = require("./ast");
runtime = require("./runtime");

proto = Object.prototype;
hop = proto.hasOwnProperty;

// interpret(nodes : List<Node>, callback : Function<Error, Object> = null)
//   Interpret a list of nodes standalone. Leaving off a callback will cause the
//   whole interpreter to run synchronously.
function interpret(nodes, callback) {
  var asynchronous, outcome;

  // If the callback is null or undefined, then the execution should be
  // synchronous.
  asynchronous = callback != null;

  if (asynchronous && typeof callback !== "function") {
    throw "Improper callback provided to interpreter";
  }

  new Interpreter(asynchronous)
      .interpret(nodes, callback || function(error, result) {
    if (error !== null) {
      throw error;
    }

    outcome = result;
  });

  return outcome;
}

// new Interpreter(asynchronous : Boolean = true)
//   A new interpreter, with internal state preserved between executions.
function Interpreter(asynchronous, stack) {
  this.asynchronous = asynchronous !== false;
  this.stack = stack || [{ self: newVar(new runtime.Object()) }];
}

Interpreter.prototype = {

  // Interprets a list of AST nodes asynchronously, passing the result of
  // interpreting the final node in the list (or done, if the list is empty).
  interpret: function(nodes, callback) {
    var outcome, self;

    function interpret(error) {
      if (error !== null) {
        callback.call(this, error);
      } else {
        this.inOrder(nodes, function (node, callback) {
          // Methods have already been hoisted.
          if (node.constructor !== ast.Method) {
            this.evaluate(node, callback);
          } else {
            callback.call(this, null, runtime.done);
          }
        }, function(error, results) {
          if (error === null) {
            outcome = results.pop();
          }

          if (this.asynchronous) {
            callback.call(this, error, outcome);
          } else if (error !== null) {
            throw error;
          }
        });
      }
    }

    if (nodes.length === 0) {
      if (typeof callback === "function") {
        callback.call(this, null, runtime.done);
      }

      if (!this.asynchronous) {
        return runtime.done;
      }
    } else {
      self = this.self();

      if (self !== null) {
        // Methods and variables are hoisted to the top of an object.
        this.inOrder(nodes, function(node, callback) {
          var constructor, name, varError;

          constructor = node.constructor;

          if (constructor === ast.Method) {
            this.evaluate(node, callback);
          } else {
            if (constructor === ast.Def || constructor === ast.Var) {
              name = node.name;
              varError = undefError(name);

              self[name] = varError;

              if (constructor === ast.Var) {
                self[name + " :="] = varError;
              }
            }

            callback.call(this, null);
          }
        }, interpret);
      } else {
        interpret.call(this, null);
      }

      return outcome;
    }
  },

  evaluate: function(node, callback) {
    var constructor = node.constructor;

    if (constructor === ast.Method) {
      this.method(node, callback);
    } else if (constructor === ast.Def || constructor === ast.Var) {
      this.variable(node, callback);
    } else if (constructor === ast.Return) {
      this["return"](node, callback);
    } else if (constructor === ast.Inherits) {
      this.inherits(node, callback);
    } else {
      this.expression(node, callback);
    }
  },

  expression: function(node, callback) {
    var constructor = node.constructor;

    if (constructor === ast.Request) {
      this.request(node, callback);
    } else if (constructor === ast.ObjectConstructor) {
      this.object(node, callback);
    } else if (constructor === ast.Block) {
      this.block(node, callback);
    } else if (constructor === ast.StringLiteral) {
      this.string(node, callback);
    } else if (constructor === ast.NumberLiteral) {
      this.number(node, callback);
    } else {
      callback.call(this, "Unrecognised node of type " + constructor);
    }
  },

  object: function(node, callback, inheriting) {
    var self = inheriting || new runtime.Object();

    this.scoped(self, function(callback) {
      this.interpret(node.body, callback);
    }, function(error, result) {
      callback.call(this, error, error === null ? self : undefined);
    });
  },

  block: function(node, callback) {
    var parameters = node.parameters;

    this.patterns(node.parameters, function(error, patterns) {
      var block, interpreter, name;

      function apply(args, callback) {
        interpreter.clone().scoped(function(callback) {
          this.addParts(name, parameters, args, function (error) {
            if (error !== null) {
              callback.call(this, error);
            } else {
              this.interpret(node.body, callback);
            }
          });
        }, callback);
      }

      if (error !== null) {
        callback.call(this, error);
      } else {
        apply.asynchronous = true;

        name = "apply" + (parameters.length === 0 ? "" : "()");
        interpreter = this.clone();

        block = new runtime.Object();
        block.apply = apply;

        callback.call(this, null, block);
      }
    });
  },

  string: function(node, callback) {
    // TODO Implement these in the runtime.
    callback.call(this, "Strings are not yet implemented");
  },

  number: function(node, callback) {
    // TODO Implement these in the runtime.
    callback.call(this, "Numbers are not yet implemented");
  },

  request: function(node, callback, inheriting) {
    var l, method, name, receiver, ref;

    function withMethod(receiver, method) {
      this.inOrder(node.signature, function(part, callback) {
        this.inOrder(part.parameters, function(param, callback) {
          this.expression(param, callback);
        }, callback);
      }, function(error, args) {
        var outcome, interpreter;

        function apply(receiver, args) {
          if (inheriting === undefined) {
            return method.apply(receiver, args);
          } else {
            if (typeof method.inherit !== "function") {
              throw "Method does not tail-return an object constructor"
            }

            return method.inherit(receiver, this.self(), args);
          }
        }

        if (error) {
          callback.call(this, error);
        } else {
          if (method.asynchronous) {
            interpreter = this;
            args.push(this.asynchronous ? function(error, result) {
              callback.call(interpreter, error, outcome = result);
            } : function() {
              callback.apply(interpreter, arguments);
            });
          }

          if (this.asynchronous && method.asynchronous) {
            setImmediate(function() {
              apply.call(interpreter, receiver, args);
            });
          } else {
            try {
              callback.call(this, null, apply.call(this, receiver, args));
            } catch(error) {
              callback.call(this, error);
            }
          }
        }
      });
    }

    name = node.name();
    receiver = node.receiver;

    if (receiver === null) {
      ref = this.search(name);

      if (ref === null) {
        name = node.name(true);
        l = name.length - 3;
        if (name.substring(l) === " :=") {
          name = name.substring(0, l);
        }

        callback.call(this, "'" + name + "' is not defined");
      } else {
        // TODO Pull out actual receiver?
        withMethod.call(this, null, ref);
      }
    } else {
      this.expression(receiver, function(error, receiver) {
        var ours;

        if (error !== null) {
          callback.call(this, error);
        } else {
          method = receiver[name];
          ours = receiver instanceof runtime.Object;

          // This is a normal object, so it needs to mimic a Grace object.
          // Function properties are considered the same as methods, and cannot
          // be assigned to.
          if (!ours && typeof method !== "function") {
            if (name === "asString") {
              method = receiver.toString;

              if (method === proto.toString) {
                method = runtime.Object.prototype.asString;
              }
            } else {
              l = name.length - 3;
              if (name.substring(l) === " :=") {
                name = name.substring(0, l);

                if (typeof receiver[name] !== "function") {
                  method = function(args) {
                    receiver[name] = args[0];
                  };
                }
              } else if (typeof (method = receiver[name]) !== "undefined") {
                method = receiver[name];

                if (typeof method !== "function") {
                  method = function() {
                    return receiver[name];
                  };
                }
              } else {
                method = runtime.Object.prototype[name];
              }
            }
          }

          if (typeof method !== "function" || ours && method === proto[name] ||
                method != null && method.internal) {
            callback.call(this,
              "No such method '" + node.name(true) + "' in " + receiver);
          } else {
            withMethod.call(this, receiver, method);
          }
        }
      });
    }
  },

  method: function(node, callback) {
    var name, signature;

    name = node.name();
    signature = node.signature;

    this.inOrder(signature, function(part, callback) {
      this.patterns(part.parameters, callback);
    }, function(error, patterns) {
      var body, constructor, init, interpreter, last;

      // The runtime representation of the method.
      function method() {
        var args, callback, inheriting, l, outcome, self;

        outcome = runtime.done;

        l = patterns.length;
        callback = arguments[l];
        args = slice(arguments, 0, l);

        inheriting = callback.inheriting;

        interpreter.clone().scoped(function(callback) {
          var argPart, i, sigPart;

          this.inOrder(zip(signature, args), function(parts, callback) {
            this.addParts(node.name(true), parts[0].parameters, parts[1],
              callback);
          }, function(error) {
            var stack;

            if (error !== null) {
              callback.call(this, error);
            } else {
              stack = this.stack;
              stack[stack.length - 1].$callback = callback;

              // TODO Perform pattern matching check.
              if (inheriting === undefined) {
                this.interpret(body, callback);
              } else {
                this.interpret(init, function(error) {
                  if (error !== null) {
                    callback.call(this, error);
                  } else {
                    this.object(last, callback, inheriting);
                  }
                });
              }
            }
          });
        }, callback || function(error, result) {
          // If we get to here, the interpreter must be synchronous.
          if (error !== null) {
            throw error;
          }

          outcome = result;
        });

        // If the interpreter is asynchronous, this will be still be 'done'.
        return outcome;
      }

      if (error !== null) {
        callback.call(this, error);
      } else {
        method.asynchronous = true;
        interpreter = this.clone();

        body = node.body;
        if (body.length > 0 &&
            (last = body[body.length - 1], constructor = last.constructor,
              constructor === ast.ObjectConstructor ||
              constructor === ast.Return && (last = last.expression,
                last !== null && last.constructor === ast.ObjectConstructor))) {
          body.pop();
          init = body;
          body = init.concat([last]);

          method.inherit = function(receiver, inheriting, args) {
            var callback = args[args.length - 1];
            callback.inheriting = inheriting;
            method.apply(receiver, args);
          };
        }

        this.put(name, node.name(true), method, callback);
      }
    });
  },

  patterns: function(parameters, callback) {
    this.inOrder(parameters, function(parameter, callback) {
      var pattern = parameter.pattern;

      if (pattern !== null) {
        // TODO Include variable names.
        this.expression(pattern, callback);
      } else {
        // TODO Include Unknown pattern.
        callback.call(this, null, null);
      }
    }, callback);
  },

  addParts: function(name, sigPart, argPart, callback) {
    // TODO Handle argvars
    if (sigPart.length > argPart.length) {
      callback.call(this,
        "Not enough arguments for method '" + name + "'");
    } else if (sigPart.length < argPart.length) {
      callback.call(this,
        "Too many arguments for method '" + name + "'");
    } else {
      this.inOrder(zip(sigPart, argPart), function(param, callback) {
        // TODO Perform pattern matching check.
        this.put(param[0].name, newVar(param[1]), callback);
      }, callback);
    }
  },

  variable: function(node, callback) {
    function withValue(error, value) {
      var name, variable;

      if (error !== null) {
        callback.call(this, error);
      } else {
        name = node.name;
        variable = newVar(value);

        this.put(name, variable, function(error) {
          if (error !== null) {
            callback.call(this, error);
          } else if (node.constructor == ast.Var) {
            this.put(name + " :=", function(args) {
              variable.value = args[0];
            }, callback);
          } else {
            callback.call(this, null);
          }
        });
      }
    }

    if (node.value === null) {
      withValue.call(this, null, runtime.done);
    } else {
      this.expression(node.value, withValue);
    }
  },

  "return": function(node, callback) {
    var expression;

    function withExpression(error, expression) {
      var i, methodCallback, stack;

      if (error !== null) {
        callback.call(this, error);
      } else {
        stack = this.stack;

        for (i = stack.length - 1; i >= 0; i--) {
          methodCallback = stack[i].$callback;

          if (typeof methodCallback === "function") {
            return methodCallback.call(this, null, expression);
          } else {
            stack.pop();
          }
        }

        callback.call(this, "Return from outside a method");
      }
    }

    expression = node.expression;

    if (expression === null) {
      withExpression.call(this, null, runtime.done);
    } else {
      this.expression(expression, withExpression);
    }
  },

  inherits: function(node, callback) {
    this.request(node.request, callback, this.self());
  },

  clone: function() {
    return new Interpreter(this.asynchronous, this.stack.concat());
  },

  // scoped(self : Object, action : Function, callback : Function)
  //   Push a new layer and a new self context on to the stack, execute an
  //   action, and then pop it off.
  //
  // scoped(action : Function, callback : Function)
  //   Push a new layer on to the stack, execute an action, and then pop it off.
  scoped: function(self, action, callback) {
    var result;

    if (typeof self === "function") {
      callback = action;
      action = self;
      self = undefined;
    }

    this.push(self);
    action.call(this, function() {
      this.pop();
      callback.apply(this, arguments);
    });
  },

  // Run an asynchronous action over a list of arguments in order, passing the
  // result of the final action call to the given callback.
  inOrder: function(list, action, callback) {
    var l, results;

    l = list.length;
    results = [];

    function run(i) {
      if (i === l) {
        callback.call(this, null, results);
      } else {
        action.call(this, list[i], function (error, result) {
          if (error !== null) {
            callback.call(this, error);
          } else {
            results.push(result);
            run.call(this, i + 1, result);
          }
        });
      }
    }

    // Note that the result will be undefined if there is nothing in the list.
    run.call(this, 0);
  },

  self: function() {
    var self, stack;

    stack = this.stack;
    self = stack[stack.length - 1].self;

    return self && self.value || null;
  },

  put: function(name, pretty, method, callback) {
    var self, stack, top;

    if (typeof pretty !== "string") {
      callback = method;
      method = pretty;
      pretty = name;
    }

    stack = this.stack;
    top = stack[stack.length - 1];

    if (hop.call(top, name)) {
      callback.call(this, "'" + pretty + "' is already defined");
    } else {
      top[name] = method;

      self = this.self();
      if (self !== null) {
        self[name] = method;
      }

      callback.call(this, null);
    }
  },

  push: function(self) {
    var frame, variable;

    frame = {};

    if (self !== undefined) {
      frame["self"] = newVar(self);
    }

    this.stack.push(frame);
  },

  pop: function() {
    this.stack.pop();
  },

  // Search for a value with the given name in the stack.
  search: function(name) {
    var def, frame, i, stack;

    stack = this.stack;

    for (i = stack.length - 1; i >= 0; i--) {
      frame = stack[i];
      def = frame[name];
      if (def !== undefined) {
        return def;
      }
    }

    return null;
  }

};

// Zip two lists together into a list of two-element lists. Assumes the lists
// are the same length;
function zip(a, b) {
  var i, l, zipped;

  zipped = [];
  for (i = 0, l = a.length; i < l; i++) {
    zipped.push([a[i], b[i]]);
  }

  return zipped;
}

// Standard not-quite-list slicer.
function slice(list, from, to) {
  return Array.prototype.slice.call(list, from, to);
}

// Create a new variable accessor that stores the value it is accessing as a
// property.
function newVar(value) {
  function variable() { return variable.value; }
  variable.value = value;
  return variable;
}

// Create a variable accessor that throws an error when it is accessed.
function undefError(name) {
  return function() {
    throw "The contents of '" + name + "' have not been defined";
  };
}

exports.interpret = interpret;
exports.Interpreter = Interpreter;

