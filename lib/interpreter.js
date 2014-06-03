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

var ast, hop, proto, runtime, varUnknown;

require("setimmediate");

ast = require("./ast");
runtime = require("./runtime");

proto = Object.prototype;
hop = proto.hasOwnProperty;

function id(x) {
  return x;
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
  variable.variable = true;
  return variable;
}

// Create a new type accessor that stores the number of generics as a property.
function newType(node) {
  var value = new runtime.TypeProxy();
  function type() { return value; }
  type.generics = node.generics.length;
  return type;
}

// Create a variable accessor that throws an error when it is accessed.
function undefError(name) {
  return function () {
    throw "The contents of '" + name + "' have not been defined";
  };
}

// new Interpreter(asynchronous : Boolean = true)
//   A new interpreter, with internal state preserved between executions.
function Interpreter(asynchronous, stack) {
  this.asynchronous = asynchronous !== false;
  this.stack = stack || {
    self: newVar(new runtime.Object()),
    outer: {
      done: newVar(runtime.done),
      "true": newVar(runtime.Boolean(true)),
      "false": newVar(runtime.Boolean(false)),
      Unknown: newVar(runtime.Unknown)
    }
  };
}

// Interprets a list of AST nodes asynchronously, passing the result of
// interpreting the final node in the list (or done, if the list is empty).
Interpreter.prototype.interpret = function (nodes, callback) {
  var outcome;

  function interpret(error) {
    if (error !== null) {
      callback.call(this, error);
    } else {
      this.each(nodes, function (node, callback) {
        // Methods and types have already been hoisted.
        if (node.constructor !== ast.Method &&
            node.constructor !== ast.TypeDeclaration) {
          this.evaluate(node, callback);
        } else {
          callback.call(this, null, runtime.done);
        }
      }, function (error, results) {
        var result;

        if (error === null) {
          result = results.pop();

          if (result === undefined) {
            result = runtime.done;
          }
        }

        callback.call(this, error, result);
      });
    }
  }

  if (!this.asynchronous) {
    outcome = runtime.done;
    callback = callback || function (error, result) {
      if (error !== null) {
        throw error;
      }

      outcome = result;
    };
  }

  if (nodes.length === 0) {
    callback.call(this, null, runtime.done);
  } else {
    this.decls(nodes, function (error) {
      var self;

      if (error !== null) {
        callback.call(this, error);
      } else {
        self = this.self();

        if (self !== null) {
          // Methods and variables are hoisted to the top of an object.
          this.each(nodes, function (node, callback) {
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
      }
    });
  }

  return outcome;
};

Interpreter.prototype.evaluate = function (node, callback) {
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
};

Interpreter.prototype.expression = function (node, callback) {
  var constructor = node.constructor;

  if (constructor === ast.Request) {
    this.request(node, callback);
  } else if (constructor === ast.ObjectConstructor) {
    this.object(node, callback);
  } else if (constructor === ast.Block) {
    this.block(node, callback);
  } else if (constructor === ast.Type) {
    this.type(node, callback);
  } else if (constructor === ast.StringLiteral) {
    this.string(node, callback);
  } else if (constructor === ast.NumberLiteral) {
    this.number(node, callback);
  } else {
    callback.call(this, "Unrecognised node of type " + constructor.name);
  }
};

Interpreter.prototype.object = function (node, callback, inheriting) {
  var self = inheriting || new runtime.Object();

  this.each(node.annotations, this.expression, function (error) {
    if (error !== null) {
      callback.call(this, error);
    } else {
      this.scoped(self, function (callback) {
        this.interpret(node.body, callback);
      }, function (error) {
        callback.call(this, error, error === null ? self : undefined);
      });
    }
  });
};

Interpreter.prototype.block = function (node, callback) {
  var interpreter, name, parameters, signature;

  function withApply(apply) {
    var object = new runtime.Object();

    apply.asynchronous = true;
    object.apply = apply;

    return object;
  }

  if (typeof node === "function") {
    return withApply(node);
  }

  parameters = node.parameters;
  signature =
    [new ast.SignaturePart(new ast.Identifier("apply"), [], parameters)];
  signature.pattern = null;

  interpreter = this.clone();
  name = "apply" + (parameters.length === 0 ? "" : "()");

  callback.call(this, null, withApply(function () {
    var args, l;

    l = arguments.length - 1;
    args = slice(arguments, 0, l);
    args.generics = [];
    args = [args];

    interpreter.clone().scoped(function (callback) {
      this.parts(name, signature, args, function (error) {
        if (error !== null) {
          callback.call(this, error);
        } else {
          this.interpret(node.body, callback);
        }
      });
    }, arguments[l]);
  }));
};

Interpreter.prototype.assert = function (value, pattern, callback) {
  if (pattern === runtime.Unknown ||
      (pattern instanceof runtime.NamedPattern &&
      pattern.pattern() === runtime.Unknown)) {
    callback.call(this, null);
  } else {
    this.apply(pattern, "match", [[value]], function (error, result) {
      if (error !== null) {
        callback.call(this, error);
      } else {
        this.apply(result, "orElse", [[this.block(function (callback) {
          callback.call(this, value + " does not match pattern " + pattern);
        })]], callback);
      }
    });
  }
};

Interpreter.prototype.decls = function (nodes, callback) {
  this.each(nodes, function (node, callback) {
    if (node.constructor === ast.TypeDeclaration) {
      this.put(node.name.value, newType(node), function (error) {
        if (error !== null) {
          callback.call(this, error);
        } else {
          callback.call(this, null, node);
        }
      });
    } else {
      // Filter out non-type declarations.
      callback.call(this, null);
    }
  }, function (error, decls) {
    if (error !== null) {
      callback.call(this, error);
    } else {
      this.each(decls, this.decl, callback);
    }
  });
};

Interpreter.prototype.decl = function (node, callback) {
  function evaluate(callback) {
    this.expression(node.value, function (error, value) {
      if (error !== null) {
        callback.call(this, error);
      } else {
        // TODO Should assert that the value is statically known, not just
        // that it is a pattern.
        this.assert(value, runtime.Pattern, function (error) {
          var name, type;

          if (error !== null) {
            callback.call(this, error);
          } else {
            // We need to retain the references of the hoisted values, so we
            // need to copy the properties of the resulting expression into
            // the referenced value.
            type = this.search(node.name.value)();

            for (name in value) {
              if (value.hasOwnProperty(name)) {
                type[name] = value[name];
              }
            }

            type.match = value.match;
            type.asString = value.asString;

            callback.call(this, null);
          }
        });
      }
    });
  }

  this.each(node.annotations, this.expression, function (error) {
    if (error !== null) {
      callback.call(this, error);
    } else {
      if (node.generics.length === 0) {
        evaluate.call(this, callback);
      } else {
        // TODO Build a better semantics for recursive types.
        this.scoped(function (callback) {
          this.each(node.generics, function (parameter, callback) {
            this.put(parameter.value, newVar(runtime.Unknown), callback);
          }, function (error) {
            if (error !== null) {
              callback.call(this, error);
            } else {
              evaluate.call(this, callback);
            }
          });
        }, callback);
      }
    }
  });
};

Interpreter.prototype.type = function (node, callback) {
  var i, j, l, name, names, signatures;

  signatures = node.signatures;
  names = [];

  for (i = 0, l = signatures.length; i < l; i += 1) {
    name = node.nameOf(i);

    for (j = 0; j < i; j += 1) {
      if (names[j] === name) {
        callback.call(this, 'Duplicate method name "' + name + '" in type');
        return;
      }
    }

    names.push(name);
  }

  callback.call(this, null, new runtime.Type(names));
};

Interpreter.prototype.string = function (node, callback) {
  callback.call(this, null, runtime.String(node.value));
};

Interpreter.prototype.number = function (node, callback) {
  callback.call(this, null, runtime.Number(node.value));
};

// Handles both synchronous and asynchronous requests.
Interpreter.prototype.apply =
  function (receiver, method, args, callback, inheriting) {
    var exception, interpreter, result;

    function exit() {
      callback.apply(interpreter, arguments);
    }

    function applyMethod(args) {
      if (inheriting === undefined) {
        return method.apply(receiver, args);
      }

      if (typeof method.inherit !== "function") {
        throw "Method does not tail-return an object constructor";
      }

      return method.inherit(receiver, this.self(), args);
    }

    // Internal helper that assumes the method exists.
    // TODO Should probably be removed (factor out the lookup in 'request').
    if (typeof method === "string") {
      method = receiver[method];
    }

    interpreter = this;

    if (args.length === 1) {
      args = args[0];

      if (method.asynchronous) {
        exit.generics = args.generics;
      }
    }

    if (method.asynchronous) {
      args.push(exit);

      if (this.asynchronous) {
        setImmediate(function () {
          applyMethod.call(interpreter, args);
        });
      } else {
        applyMethod.call(this, args);
      }
    } else {
      exception = null;

      try {
        result = applyMethod.call(this, args);
      } catch (error) {
        exception = error;
      } finally {
        callback.call(this, exception, result);
      }
    }
  };

Interpreter.prototype.request = function (node, callback, inheriting) {
  var l, method, name, overridden, ref, rnode;

  function withMethod(receiver, method) {
    this.each(node.signature, function (part, callback) {
      if (part.generics.length !== 0 &&
          method.generics > part.generics.length) {
        callback.call(this,
          "Not enough generic arguments for method '" + name + "'");
      } else if (method.generics < part.generics.length) {
        callback.call(this,
          "Too many generic arguments for method '" + name + "'");
      } else {
        this.each(part.generics, function (param, callback) {
          if (method.variable) {
            callback.call(this,
              "Generic arguments when requesting variable '" + name + "'");
          } else {
            this.expression(param, callback);
          }
        }, function (error, generics) {
          if (error !== null) {
            callback.call(this, error);
          } else {
            this.each(part.parameters, function (param, callback) {
              if (method.variable || typeof method.generics === "number") {
                callback.call(this,
                  "Arguments when requesting variable '" + name + "'");
              } else {
                this.expression(param, callback);
              }
            }, function (error, parameters) {
              if (error !== null) {
                callback.call(this, error);
              } else {
                parameters.generics = generics;
                callback.call(this, null, parameters);
              }
            });
          }
        });
      }
    }, function (error, args) {
      if (error !== null) {
        callback.call(this, error);
      } else {
        this.apply(receiver, method, args, callback, inheriting);
      }
    });
  }

  name = node.name();
  rnode = node.receiver;
  method = null;

  if (rnode === null) {
    ref = this.search(name);

    if (ref === null) {
      name = node.name(true);
      l = name.length - 3;
      if (name.substring(l) === " :=") {
        name = name.substring(0, l);
      }

      callback.call(this, '"' + name + '" is not defined');
    } else {
      withMethod.call(this, null, ref);
    }
  } else if (rnode.constructor === ast.Super) {
    overridden = this.search("super");

    if (overridden === null) {
      callback.call(this,
        'No super method "' + node.name(true) + '" to request');
    } else if (overridden.identifier !== name) {
      callback.call(this,
        "Super requests must request the surrounding method");
    } else {
      withMethod.call(this, this.self(true), overridden);
    }
  } else {
    this.expression(rnode, function (error, receiver) {
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
                method = function (args) {
                  receiver[name] = args[0];
                };
              }
            } else {
              method = receiver[name];

              if (method !== "undefined") {
                if (typeof method !== "function") {
                  method = function () {
                    return receiver[name];
                  };
                }
              } else {
                method = runtime.Object.prototype[name];
              }
            }
          }
        }

        if (typeof method !== "function" ||
            (ours && method === proto[name]) ||
                (typeof method === "function" && method.internal)) {
          callback.call(this,
            "No such method '" + node.name(true) + "' in " + receiver);
        } else {
          withMethod.call(this, receiver, method);
        }
      }
    });
  }
};

Interpreter.prototype.method = function (node, callback) {
  var body, constructor, init, interpreter, last, name, signature;

  function method() {
    var args, inheriting, l, metadata;

    l = arguments.length - 1;
    args = slice(arguments, 0, l);
    metadata = arguments[l];
    inheriting = metadata.inheriting;

    // Single-part methods have their arguments passed normally, in order to
    // replicate the behaviour of an ordinary JavaScript function.
    if (signature.length === 1) {
      args.generics = metadata.generics || [];
      args = [args];
    }

    // Reclone the interpreter to get a unique stack for this execution.
    interpreter.clone().scoped(function (callback) {
      this.parts(name, signature, args, function (error, pattern) {
        var top;

        // Ensures that the postcondition of the method holds before
        // exiting the method.
        function exit(error, result) {
          top["return"] = null;

          if (error !== null) {
            callback.call(this, error);
          } else {
            this.assert(result, pattern, function (error) {
              if (error !== null) {
                callback.call(this, error);
              } else {
                callback.call(this, null, result);
              }
            });
          }
        }

        if (error !== null) {
          callback.call(this, error);
        } else {
          top = this.stack;
          top["return"] = exit;
          top["super"] = method["super"] || null;

          if (inheriting === undefined) {
            this.interpret(body, exit);
          } else {
            this.interpret(init, function (error) {
              if (error !== null) {
                exit.call(this, error);
              } else {
                this.object(last, exit, inheriting);
              }
            });
          }
        }
      });
    }, metadata);
  }

  name = node.name(true);
  signature = node.signature;
  body = node.body;

  // Save the state of the surrounding scope at the point where the method
  // is defined.
  interpreter = this.clone();

  method.identifier = node.name();
  method.asynchronous = true;

  // Build inheritance mechanism.
  if (body.length > 0) {
    last = body[body.length - 1];
    constructor = last.constructor;

    if (constructor === ast.Return) {
      last = last.expression;

      if (last !== null) {
        constructor = last.constructor;
      }
    }

    if (constructor === ast.ObjectConstructor) {
      body.pop();
      init = body;
      body = init.concat([last]);

      method.inherit = function (receiver, inheriting, args) {
        args[args.length - 1].inheriting = inheriting;
        method.apply(receiver, args);
      };
    }
  }

  this.each(signature.annotations, this.expression, function (error, anns) {
    if (error !== null) {
      callback.call(this, error);
    } else {
      method.annotations = anns;

      // Put the resulting method in the local scope and complete.
      this.put(node.name(), method, callback);
    }
  });
};

// Handle the joining of a method and a request by adding generics, evaluating
// patterns, and adding parameters, then producing the return pattern.
Interpreter.prototype.parts = function (name, msig, rsig, callback) {
  this.validateParts(name, msig, rsig, function (error) {
    if (error !== null) {
      callback.call(this, error);
    } else {
      this.each(msig, rsig, function (mpart, rpart, callback) {
        this.part(mpart, rpart, callback);
      }, function (error) {
        if (error !== null) {
          callback.call(this, error);
        } else {
          this.pattern(msig.pattern, id, callback);
        }
      });
    }
  });
};

// Ensure the generic and parameter counts match up for a method request.
Interpreter.prototype.validateParts = function (name, msig, rsig, callback) {
  this.each(msig, rsig, function (mpart, rpart, callback) {
    var args, mgens, params, rgens;

    mgens = mpart.generics.length;
    rgens = rpart.generics.length;

    if (rgens !== 0 && rgens < mgens) {
      callback.call(this,
        'Not enough generic arguments for method "' + name + '"');
    } else if (rgens > mgens) {
      callback.call(this,
        'Too many generic arguments for method "' + name + '"');
    } else {
      params = mpart.parameters.length;
      args = rpart.length;

      if (args < params) {
        callback.call(this,
          'Not enough arguments for method "' + name + '"');
      } else if (args > params) {
        callback.call(this,
          'Too many arguments for method "' + name + '"');
      } else {
        callback.call(this, null);
      }
    }
  }, callback);
};

// Handle the joining of individual parts of a method and a request.
Interpreter.prototype.part = function (mpart, rpart, callback) {
  // Add generics, and test if they are patterns.
  this.generics(mpart.generics, rpart.generics, function (error) {
    if (error !== null) {
      callback.call(this, error);
    } else {
      this.parameters(mpart.parameters, rpart, callback);
    }
  });
};

// Join a method's generic parameters with the values given by a request.
Interpreter.prototype.generics = function (mgens, rgens, callback) {
  if (rgens.length !== 0) {
    this.each(mgens, rgens, function (mgen, rgen, callback) {
      var pattern = new runtime.NamedPattern(mgen.value, runtime.Pattern);

      // Ensure that the generic value is a pattern.
      this.assert(rgen, pattern, function (error) {
        if (error !== null) {
          callback.call(this, error);
        } else {
          this.put(mgen.value, newVar(rgen), callback);
        }
      });
    }, callback);
  } else {
    // No generics given in the request. Default to Unknown.
    this.each(mgens, function (mgen, callback) {
      this.put(mgen.value, varUnknown, callback);
    }, callback);
  }
};

// Evaluate a method part's parameters and join them with part of a request.
Interpreter.prototype.parameters = function (params, args, callback) {
  this.patterns(params, function (error, patterns) {
    var i, l, names;

    if (error !== null) {
      callback.call(this, error);
    } else {
      names = [];

      // Collect parameter names.
      for (i = 0, l = params.length; i < l; i += 1) {
        names.push(params[i].name);
      }

      this.arguments(names, patterns, args, callback);
    }
  });
};

// Evaluate a method part's patterns in the scope of its generic arguments.
Interpreter.prototype.patterns = function (parameters, callback) {
  this.each(parameters, function (parameter, callback) {
    var name = parameter.name.value;

    this.pattern(parameter.pattern, function (pattern) {
      return new runtime.NamedPattern(name, pattern);
    }, callback);
  }, callback);
};

Interpreter.prototype.pattern = function (expression, wrapper, callback) {
  if (expression === null) {
    // No pattern given, default to Unknown.
    callback.call(this, null, wrapper(runtime.Unknown));
  } else {
    this.expression(expression, function (error, pattern) {
      if (error !== null) {
        callback.call(this, error);
      } else {
        // Check that it's actually a pattern.
        this.assert(pattern, runtime.Pattern, function (error) {
          if (error !== null) {
            callback.call(this, error);
          } else {
            callback.call(this, null, wrapper(pattern));
          }
        });
      }
    });
  }
};

// Join parameters and arguments together.
Interpreter.prototype.arguments = function (names, patterns, args, callback) {
  this.each(names, patterns, args, function (name, pattern, arg, callback) {
    this.assert(arg, pattern, function (error) {
      if (error !== null) {
        callback.call(this, error);
      } else if (name !== "_") {
        this.put(name, newVar(arg), callback);
      } else {
        callback.call(this, null);
      }
    });
  }, callback);
};

Interpreter.prototype.variable = function (node, callback) {
  function withValue(error, value) {
    var name, variable;

    if (error !== null) {
      callback.call(this, error);
    } else {
      name = node.name;
      variable = newVar(value);

      this.put(name, variable, function (error) {
        if (error !== null) {
          callback.call(this, error);
        } else if (node.constructor === ast.Var) {
          this.put(name + " :=", function (value) {
            variable.value = value;
          }, callback);
        } else {
          callback.call(this, null);
        }
      });
    }
  }

  this.each(node.annotations, this.expression, function (error) {
    if (error !== null) {
      callback.call(this, error);
    } else {
      if (node.value === null) {
        withValue.call(this, null, runtime.done);
      } else {
        this.expression(node.value, withValue);
      }
    }
  });
};

Interpreter.prototype["return"] = function (node, callback) {
  var expression;

  function withExpression(error, expression) {
    var exit, frame;

    if (error !== null) {
      callback.call(this, error);
    } else {
      frame = this.stack;
      this.pop();

      while (frame !== undefined) {
        if (hop.call(frame, "return")) {
          exit = frame["return"];

          if (exit === null) {
            callback.call(this, "Return from completed method");
          } else {
            exit.call(this, null, expression);
          }

          return;
        }

        if (hop.call(frame, "self")) {
          callback.call(this, "Return from inside an object");
          return;
        }

        frame = this.stack;
        this.pop();
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
};

Interpreter.prototype.inherits = function (node, callback) {
  this.request(node.request, callback, this.self());
};

// Clone the interpreter to preserve the local stack.
Interpreter.prototype.clone = function () {
  return new Interpreter(this.asynchronous, this.stack);
};

// scoped(self : Object, action : Callback<T*> -> (), callback : Callback<T*>)
//   Push a new layer and a new self context on to the stack, execute an
//   action, and then pop it off.
//
// scoped(action : Callback<T*> -> (), callback : Callback<T*>)
//   Push a new layer on to the stack, execute an action, and then pop it off.
Interpreter.prototype.scoped = function (self, action, callback) {
  if (typeof self === "function") {
    callback = action;
    action = self;
    self = undefined;
  }

  this.push(self);
  action.call(this, function () {
    this.pop();
    callback.apply(this, arguments);
  });
};

// each(lists+ : [T], action : T+ -> Callback<U>, Callback<[U]>)
// Run an asynchronous action over lists of arguments in order, passing the
// result of the each action to the given callback, if it did not return
// undefined. Multiple lists must have matching lengths.
Interpreter.prototype.each = function (first) {
  var action, callback, i, j, l, length, results, part, parts;

  function run() {
    if (i === length) {
      callback.call(this, null, results);
    } else {
      i += 1;
      action.apply(this, parts[i - 1]);
    }
  }

  function eachCallback(error, result) {
    if (error !== null) {
      callback.call(this, error);
    } else {
      if (result !== undefined) {
        results.push(result);
      }

      run.call(this);
    }
  }

  length = first.length;
  results = [];

  l = arguments.length - 2;

  action = arguments[l];
  callback = arguments[l + 1];

  parts = [];

  for (i = 0; i < l; i += 1) {
    if (arguments[i].length !== length) {
      callback.call(this, "Mismatched list lengths");
      return;
    }
  }

  for (i = 0; i < length; i += 1) {
    part = [];

    for (j = 0; j < l; j += 1) {
      part.push(arguments[j][i]);
    }

    part.push(eachCallback);
    parts.push(part);
  }

  i = 0;
  run.call(this);
};

Interpreter.prototype.self = function (search) {
  var self = this.stack.self || (search && this.search("self"));

  return (self && self.value) || null;
};

Interpreter.prototype.put = function (name, pretty, method, callback) {
  var self, top;

  if (typeof pretty !== "string") {
    callback = method;
    method = pretty;
    pretty = name;
  }

  top = this.stack;

  if (hop.call(top, name)) {
    callback.call(this, "'" + pretty + "' is already defined");
  } else {
    top[name] = method;

    self = this.self();
    if (self !== null) {
      if (hop.call(self, name)) {
        self[name]["super"] = method;
      } else {
        self[name] = method;
      }
    }

    callback.call(this, null);
  }
};

Interpreter.prototype.push = function (self) {
  var frame;

  frame = {};

  if (self !== undefined) {
    frame.self = newVar(self);
  }

  frame.outer = this.stack;
  this.stack = frame;
};

Interpreter.prototype.pop = function () {
  this.stack = this.stack.outer;
};

// Search for a value with the given name on self or in the stack.
Interpreter.prototype.search = function (name) {
  var frame, self;

  self = null;

  for (frame = this.stack; hop.call(frame, "outer"); frame = frame.outer) {
    if (hop.call(frame, name)) {
      return frame[name];
    }

    if (self === null && hop.call(frame, "self")) {
      self = frame.self();

      if (typeof self[name] === "function") {
        return self[name];
      }
    }
  }

  return null;
};

// interpret(nodes : [Node], callback : Callback<Object> = null)
//   Interpret a list of nodes standalone. Leaving off a callback will cause the
//   whole interpreter to run synchronously.
function interpret(nodes, callback) {
  var asynchronous, outcome;

  // If the callback is null or undefined, then the execution should be
  // synchronous.
  asynchronous = callback !== null && callback !== undefined;

  if (asynchronous && typeof callback !== "function") {
    throw "Improper callback provided to interpreter";
  }

  new Interpreter(asynchronous).interpret(nodes, callback ||
    function (error, result) {
      if (error !== null) {
        throw error;
      }

      outcome = result;
    });

  return outcome;
}

varUnknown = newVar(runtime.Unknown);

exports.interpret = interpret;
exports.Interpreter = Interpreter;

