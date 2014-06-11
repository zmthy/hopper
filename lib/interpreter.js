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

var Task, ast, path, runtime, util, varUnknown;

path = require("path");

require("setimmediate");

Task = require("./task");
ast = require("./ast");
runtime = require("./runtime");
util = require("./util");

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

varUnknown = newVar(runtime.Unknown);

// new Interpreter(asynchronous : Boolean,
//     moduleLoader : Function<Path, Callback<Object>>)
//   A new interpreter, with internal state preserved between executions.
function Interpreter(asynchronous, moduleLoader) {
  function Clone(stack) {
    this.stack = stack;
  }

  Clone.prototype = this;

  this.clone = function () {
    return new Clone(this.stack);
  };

  this.asynchronous = asynchronous !== false;

  this.modules = {};
  this.load = Task.taskify(this, moduleLoader);

  this.stack = {
    outer: null,
    done: newVar(runtime.done),
    "true": newVar(runtime.Boolean(true)),
    "false": newVar(runtime.Boolean(false)),
    Unknown: newVar(runtime.Unknown)
  };
}

// Interprets a list of AST nodes asynchronously, passing the result of
// interpreting the final node in the list (or done, if the list is empty).
Interpreter.prototype.interpret = function (nodes) {
  if (nodes.length === 0) {
    return this.resolve(runtime.done);
  }

  return this.decls(nodes).then(function () {
    var self;

    self = this.self();

    if (self !== null) {
      // Methods and variables are hoisted to the top of an object.
      return this.each(nodes, function (node) {
        var constructor, name, varError;

        constructor = node.constructor;

        if (constructor === ast.Method) {
          return this.evaluate(node);
        }

        if (constructor === ast.Def || constructor === ast.Var) {
          name = node.name;
          varError = undefError(name);

          self[name] = varError;

          if (constructor === ast.Var) {
            self[name + " :="] = varError;
          }
        }
      });
    }
  }).then(function () {
    return this.each(nodes, function (node) {
      // Methods and types have already been hoisted.
      if (node.constructor !== ast.Method &&
          node.constructor !== ast.TypeDeclaration) {
        return this.evaluate(node);
      }

      return runtime.done;
    });
  }).then(function (results) {
    return results.pop();
  });
};

// Enter into an object scope and stay in that state, returning the newly
// created self value. This is useful for an interactive mode.
Interpreter.prototype.enter = function () {
  var self = new runtime.Object();
  this.push(self);
  return self;
};

// Interpret a list of nodes as a module body and cache it based on a path so a
// request for the same module does not occur again.
Interpreter.prototype.module = function (key, nodes) {
  return this.object(new ast.ObjectConstructor([], nodes))
    .then(function (module) {
      this.modules[path.normalize(key)] = module;
      return module;
    });
};

Interpreter.prototype.evaluate = function (node) {
  var constructor = node.constructor;

  if (constructor === ast.Method) {
    return this.method(node);
  }

  if (constructor === ast.Def || constructor === ast.Var) {
    return this.variable(node);
  }

  if (constructor === ast.Return) {
    return this["return"](node);
  }

  if (constructor === ast.Inherits) {
    return this.inherits(node);
  }

  if (constructor === ast.Import) {
    return this["import"](node);
  }

  if (constructor === ast.Dialect) {
    return this.dialect(node);
  }

  return this.expression(node);
};

Interpreter.prototype.expression = function (node) {
  var constructor = node.constructor;

  if (constructor === ast.Request) {
    return this.request(node);
  }

  if (constructor === ast.ObjectConstructor) {
    return this.object(node);
  }

  if (constructor === ast.Block) {
    return this.task(function () {
      return this.block(node);
    });
  }

  if (constructor === ast.Type) {
    return this.type(node);
  }

  if (constructor === ast.StringLiteral) {
    return this.string(node);
  }

  if (constructor === ast.NumberLiteral) {
    return this.number(node);
  }

  throw "Unrecognised node of type " + constructor.name;
};

Interpreter.prototype.dialect = function (node) {
  var self = this;

  return this.load(node.path.value).then(function (module) {
    module.outer = self.stack;
    self.stack = module;
  });
};

Interpreter.prototype["import"] = function (node) {
  var self = this;

  return this.load(node.path.value).then(function (module) {
    var name = node.identifier.value;

    if (name !== "_") {
      self.put(node.identifier.value, newVar(module));
    }
  });
};

Interpreter.prototype.object = function (node, inheriting) {
  var self = inheriting || new runtime.Object();

  return this.each(node.annotations, this.expression).then(function () {
    return this.scoped(self, function () {
      return this.interpret(node.body);
    });
  }).then(function () {
    return self;
  });
};

Interpreter.prototype.block = function (node) {
  var apply, interpreter, name, object, parameters, signature;

  // Internal helper to convert a function into a block.
  if (typeof node === "function") {
    apply = node;
  } else {
    parameters = node.parameters;
    signature =
      [new ast.SignaturePart(new ast.Identifier("apply"), [], parameters)];
    signature.pattern = null;

    interpreter = this.clone();
    name = "apply" + (parameters.length === 0 ? "" : "()");

    apply = function () {
      var args, l;

      l = arguments.length - 1;
      args = util.slice(arguments, 0, l);
      args.generics = [];
      args = [args];

      interpreter.clone().scoped(function () {
        return this.parts(name, signature, args).then(function () {
          return this.interpret(node.body);
        });
      }).callback(arguments[l]);
    };
  }

  object = new runtime.Object();

  apply.asynchronous = true;
  apply.identifier = "apply";
  object.apply = apply;

  return object;
};

Interpreter.prototype.assert = function (value, pattern) {
  return this.unless(pattern === runtime.Unknown ||
    (pattern instanceof runtime.NamedPattern &&
    pattern.pattern() === runtime.Unknown), function () {
      return this.apply(pattern, "match", [[value]]).then(function (result) {
        return this.apply(result, "orElse", [[this.block(function (callback) {
          callback.call(this, value + " does not match pattern " + pattern);
        })]]);
      });
    });
};

Interpreter.prototype.decls = function (nodes) {
  return this.each(nodes, function (node) {
    if (node.constructor === ast.TypeDeclaration) {
      this.put(node.name.value, newType(node));
      return node;
    }
  }).then(function (decls) {
    return this.each(decls, this.decl);
  });
};

Interpreter.prototype.decl = function (node) {
  return this.each(node.annotations, this.expression).then(function () {
    if (node.generics.length !== 0) {
      // TODO Build a better semantics for recursive types.
      return this.scoped(function () {
        return this.each(node.generics, function (parameter) {
          this.put(parameter.value, newVar(runtime.Unknown));
        }).then(function () {
          return this.expression(node.value);
        });
      });
    }

    return this.expression(node.value);
  }).then(function (value) {
    // TODO Should assert that the value is statically known, not just
    // that it is a pattern.
    return this.assert(value, runtime.Pattern).then(function () {
      // We need to retain the references of the hoisted values, so we
      // need to copy the properties of the resulting expression into
      // the referenced value.
      var type = this.search(node.name.value)();

      util.extend(type, value);

      type.match = value.match;
      type.asString = value.asString;
    });
  });
};

Interpreter.prototype.type = function (node) {
  var i, j, l, name, names, signatures;

  signatures = node.signatures;
  names = [];

  for (i = 0, l = signatures.length; i < l; i += 1) {
    name = node.nameOf(i);

    for (j = 0; j < i; j += 1) {
      if (names[j] === name) {
        throw 'Duplicate method name "' + name + '" in type';
      }
    }

    names.push(name);
  }

  return this.resolve(new runtime.Type(names));
};

Interpreter.prototype.string = function (node) {
  return this.resolve(runtime.String(node.value));
};

Interpreter.prototype.number = function (node) {
  return this.resolve(runtime.Number(node.value));
};

// Handles both synchronous and asynchronous requests.
Interpreter.prototype.apply =
  function (receiver, method, args, inheriting) {
    // Internal helper to apply a method based on its name.
    if (typeof method === "string") {
      method = runtime.lookup(receiver, method);
    }

    if (args.length === 1) {
      args = args[0];
    }

    return new Task(this, function (resolve, reject) {
      var task;

      function exit(reason, value) {
        if (reason !== null) {
          reject(reason);
        } else {
          resolve(value);
        }
      }

      if (method.asynchronous) {
        args.push(exit);

        if (args.length === 1) {
          exit.generics = args.generics;
        }
      }

      task = new Task(this, function (resolve) {
        if (this.asynchronous && method.asynchronous) {
          setImmediate(function () {
            resolve();
          });
        } else {
          resolve();
        }
      }).then(function () {
        if (inheriting !== undefined) {
          if (typeof method.inherit !== "function") {
            throw "Method does not tail-return an object constructor";
          }

          return method.inherit(receiver, this.self(), args);
        }

        return method.apply(receiver, args);
      });

      if (!method.asynchronous) {
        task.then(resolve, reject);
      }
    });
  };

Interpreter.prototype.request = function (node, inheriting) {
  var name, pretty, rnode;

  pretty = node.name();
  name = util.uglify(pretty);
  rnode = node.receiver;

  return this.task(function () {
    var l, overridden, ref;

    if (rnode === null) {
      ref = this.search(name);

      if (ref === null) {
        // Don't complain about assignment not existing when the variable that
        // was supposed to be assigned to doesn't exist in the first place.
        l = name.length - 3;
        if (name.substring(l) === " :=") {
          name = name.substring(0, l);
        }

        throw '"' + name + '" is not defined';
      }

      return [null, ref];
    }

    if (rnode.constructor === ast.Super) {
      overridden = this.search("super");

      if (overridden === null) {
        throw 'No super method "' + pretty + '" to request';
      }

      if (overridden.identifier !== name) {
        throw "Super requests must request the surrounding method";
      }

      return [this.self(true), overridden];
    }

    return this.expression(rnode).then(function (receiver) {
      return [receiver, runtime.lookup(receiver, pretty)];
    });
  }).then(function (pair) {
    var method, receiver;

    receiver = pair[0];
    method = pair[1];

    return this.each(node.signature, function (part) {
      if (part.generics.length !== 0 &&
          method.generics > part.generics.length) {
        throw 'Not enough generic arguments for method "' + pretty + '"';
      }

      if (method.generics < part.generics.length) {
        throw 'Too many generic arguments for method "' + pretty + '"';
      }

      return this.each(part.generics, function (param) {
        if (method.variable) {
          throw 'Generic arguments when requesting variable "' + pretty + '"';
        }

        return this.expression(param);
      }).then(function (generics) {
        return this.each(part.parameters, function (param) {
          if (method.variable || typeof method.generics === "number") {
            throw 'Arguments when requesting variable "' + pretty + '"';
          }

          return this.expression(param);
        }).then(function (parameters) {
          parameters.generics = generics;
          return parameters;
        });
      });
    }).then(function (args) {
      return this.apply(receiver, method, args, inheriting);
    });
  });
};

Interpreter.prototype.method = function (node) {
  var body, constructor, init, interpreter, last, name, signature;

  function method() {
    var args, inheriting, l, metadata;

    l = arguments.length - 1;
    args = util.slice(arguments, 0, l);
    metadata = arguments[l];
    inheriting = metadata.inheriting;

    // Single-part methods have their arguments passed normally, in order to
    // replicate the behaviour of an ordinary JavaScript function.
    if (signature.length === 1) {
      args.generics = metadata.generics || [];
      args = [args];
    }

    // Reclone the interpreter to get a unique stack for this execution.
    interpreter.clone().scoped(function () {
      return new Task(this, function (resolve, reject) {
        this.parts(name, signature, args).then(function (pattern) {
          var top;

          // Ensures that the postcondition of the method holds before
          // exiting the method.
          function exit(reason, value) {
            top["return"] = null;

            if (reason !== null) {
              reject(reason);
            } else {
              this.assert(value, pattern).then(function () {
                resolve(value);
              }, reject);
            }
          }

          top = this.stack;
          top["return"] = exit;
          top["super"] = method["super"] || null;

          (inheriting === undefined ? this.interpret(body) :
              this.interpret(init).then(function () {
                return this.object(last, inheriting);
              })).callback(exit);
        }, reject);
      });
    }).callback(metadata);
  }

  name = util.uglify(node.name());
  signature = node.signature;
  body = node.body;

  // Save the state of the surrounding scope at the point where the method
  // is defined.
  interpreter = this.clone();

  method.identifier = name;
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

  return this.each(signature.annotations, this.expression)
    .then(function (annotations) {
      method.annotations = annotations;

      // Put the resulting method in the local scope and complete.
      this.put(name, method);
    });
};

// Handle the joining of a method and a request by adding generics, evaluating
// patterns, and adding parameters, then producing the return pattern.
Interpreter.prototype.parts = function (name, msig, rsig) {
  return this.validateParts(name, msig, rsig).then(function () {
    return this.each(msig, rsig, function (mpart, rpart) {
      return this.part(mpart, rpart);
    });
  }).then(function () {
    return this.pattern(msig.pattern);
  });
};

// Ensure the generic and parameter counts match up for a method request.
Interpreter.prototype.validateParts = function (name, msig, rsig) {
  return this.each(msig, rsig, function (mpart, rpart) {
    var args, mgens, params, rgens;

    mgens = mpart.generics.length;
    rgens = rpart.generics.length;

    if (rgens !== 0 && rgens < mgens) {
      throw 'Not enough generic arguments for method "' + name + '"';
    }

    if (rgens > mgens) {
      throw 'Too many generic arguments for method "' + name + '"';
    }

    params = mpart.parameters.length;
    args = rpart.length;

    if (args < params) {
      throw 'Not enough arguments for method "' + name + '"';
    }

    if (args > params) {
      throw 'Too many arguments for method "' + name + '"';
    }
  });
};

// Handle the joining of individual parts of a method and a request.
Interpreter.prototype.part = function (mpart, rpart) {
  // Add generics, and test if they are patterns.
  return this.generics(mpart.generics, rpart.generics).then(function () {
    return this.parameters(mpart.parameters, rpart);
  });
};

// Join a method's generic parameters with the values given by a request.
Interpreter.prototype.generics = function (mgens, rgens) {
  if (rgens.length !== 0) {
    return this.each(mgens, rgens, function (mgen, rgen) {
      var pattern = new runtime.NamedPattern(mgen.value, runtime.Pattern);

      // Ensure that the generic value is a pattern.
      return this.assert(rgen, pattern).then(function () {
        this.put(mgen.value, newVar(rgen));
      });
    });
  }

  // No generics given in the request. Default to Unknown.
  return this.each(mgens, function (mgen) {
    this.put(mgen.value, varUnknown);
  });
};

// Evaluate a method part's parameters and join them with part of a request.
Interpreter.prototype.parameters = function (params, args) {
  return this.patterns(params).then(function (patterns) {
    return this.each(params, function (param) {
      return param.name.value;
    }).then(function (names) {
      return this.arguments(names, patterns, args);
    });
  });
};

// Evaluate a method part's patterns in the scope of its generic arguments.
Interpreter.prototype.patterns = function (parameters) {
  return this.each(parameters, function (parameter) {
    var name = parameter.name.value;

    return this.pattern(parameter.pattern).then(function (pattern) {
      return new runtime.NamedPattern(name, pattern);
    });
  });
};

Interpreter.prototype.pattern = function (expression) {
  if (expression === null) {
    // No pattern given, default to Unknown.
    return this.resolve(runtime.Unknown);
  }

  return this.expression(expression).then(function (pattern) {
    // Check that it's actually a pattern.
    return this.assert(pattern, runtime.Pattern).then(function () {
      return pattern;
    });
  });
};

// Join parameters and arguments together.
Interpreter.prototype.arguments = function (names, patterns, args) {
  return this.each(names, patterns, args, function (name, pattern, arg) {
    return this.assert(arg, pattern).then(function () {
      if (name !== "_") {
        this.put(name, newVar(arg));
      }
    });
  });
};

Interpreter.prototype.variable = function (node) {
  return this.each(node.annotations, this.expression).then(function () {
    if (node.value === null) {
      return runtime.done;
    }

    return this.expression(node.value);
  }).then(function (value) {
    var name, variable;

    name = node.name.value;
    variable = newVar(value);

    this.put(name, variable);

    if (node.constructor === ast.Var) {
      this.put(name + " :=", function (value) {
        variable.value = value;
      });
    }
  });
};

Interpreter.prototype["return"] = function (node) {
  var expression = node.expression;

  return this.task(function () {
    if (expression === null) {
      return runtime.done;
    }

    return this.expression(expression);
  }).then(function (expression) {
    var exit, frame;

    frame = this.stack;
    this.pop();

    while (frame !== undefined) {
      if (util.owns(frame, "return")) {
        exit = frame["return"];

        if (exit === null) {
          throw "Return from completed method";
        }

        exit.call(this, null, expression);
        return;
      }

      if (util.owns(frame, "self")) {
        throw "Return from inside an object";
      }

      frame = this.stack;
      this.pop();
    }

    throw "Return from outside a method";
  });
};

Interpreter.prototype.inherits = function (node) {
  return this.request(node.request, this.self());
};

// scoped(self : Object, action : () -> T) -> Task<T>
//   Push a new layer and a new self context on to the stack, execute an
//   action, and then pop it off.
//
// scoped(action : () -> T) -> Task<T>
//   Push a new layer on to the stack, execute an action, and then pop it off.
Interpreter.prototype.scoped = function (self, action) {
  if (typeof self === "function") {
    action = self;
    self = undefined;
  }

  this.push(self);
  return this.task(action).then(function (value) {
    this.pop();
    return value;
  }, function (reason) {
    this.pop();
    throw reason;
  });
};

// each(lists+ : [T], action : T+ -> Task<U>) -> Task<[U]>
//   Run an asynchronous action over lists of arguments in order, chaining each
//   non-undefined result of the action into a list. Multiple lists must have
//   matching lengths.
Interpreter.prototype.each = function (first) {
  var action, i, j, l, length, results, part, parts;

  function run() {
    i += 1;

    if (i === length) {
      return results;
    }

    return this.task(function () {
      return action.apply(this, parts[i]);
    }).then(function (value) {
      if (value !== undefined) {
        results.push(value);
      }

      return run.call(this);
    });
  }

  length = first.length;
  results = [];

  l = arguments.length - 1;
  action = arguments[l];
  parts = [];

  for (i = 0; i < l; i += 1) {
    if (arguments[i].length !== length) {
      throw "Mismatched list lengths";
    }
  }

  // This is here to allow the list length check above to occur first.
  if (length === 0) {
    return this.resolve([]);
  }

  for (i = 0; i < length; i += 1) {
    part = [];

    for (j = 0; j < l; j += 1) {
      part.push(arguments[j][i]);
    }

    parts.push(part);
  }

  i = -1;
  return run.call(this);
};

Interpreter.prototype.self = function (search) {
  var self = this.stack.self || (search && this.search("self"));

  return (self && self.value) || null;
};

Interpreter.prototype.put = function (pretty, method) {
  var name, self, top;

  name = util.uglify(pretty);
  top = this.stack;

  if (util.owns(top, name)) {
    throw "'" + pretty + "' is already defined";
  }

  top[name] = method;

  self = this.self();
  if (self !== null) {
    if (util.owns(self, name)) {
      self[name]["super"] = method;
    } else {
      self[name] = method;
    }
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

  for (frame = this.stack; frame !== null; frame = frame.outer) {
    if (util.owns(frame, name)) {
      return frame[name];
    }

    if (self === null && util.owns(frame, "self")) {
      self = frame.self();

      if (typeof self[name] === "function") {
        return self[name];
      }
    }
  }

  return null;
};

Interpreter.prototype.resolve = function (value) {
  return Task.resolve(this, value);
};

// Safely wrap an action as a task.
Interpreter.prototype.task = function (action) {
  return this.resolve().then(function () {
    return action.call(this);
  });
};

Interpreter.prototype.when = function (condition, action) {
  return this.task(condition ? action : function () {
    return;
  });
};

Interpreter.prototype.unless = function (condition, action) {
  return this.when(!condition, action);
};

exports.Interpreter = Interpreter;

