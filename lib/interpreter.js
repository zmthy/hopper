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

var Task, ast, path, rt, util, varUnknown;

path = require("path");

require("setimmediate");

Task = require("./task");
ast = require("./ast");
rt = require("./runtime");
util = require("./util");

// Create a new variable accessor that stores the value it is accessing as a
// property.
function newVar(name, value) {
  function variable() {
    return Task.resolve(variable.value);
  }

  variable.value = value;
  variable.variable = true;
  variable.identifier = name;
  variable.isUndefined = false;

  return variable;
}

// Create a new type accessor that stores the number of generics as a property.
function newType(generics) {
  var value = rt.proxy();

  function type() {
    return Task.resolve(value);
  }

  type.value = value;
  type.generics = generics;

  return type;
}

// Create a variable accessor that throws an error when it is accessed.
function undefError(name) {
  function error() {
    throw "The contents of '" + name + "' have not been defined";
  }

  error.variable = true;
  error.identifier = name;
  error.isUndefined = true;

  return error;
}

varUnknown = newVar("Unknown", rt.Unknown);

// new Interpreter(moduleLoader : Function<Path, Callback<Object>>)
//   A new interpreter, with internal state preserved between executions.
function Interpreter(moduleLoader) {
  function Clone(scope) {
    this.scope = scope;
  }

  Clone.prototype = this;

  this.clone = function () {
    return new Clone(this.scope);
  };

  this.modules = {};
  this.load = Task.taskify(this, moduleLoader);

  this.scope = {
    outer: null,
    done: newVar("done", rt.done),
    "true": newVar("true", rt.bool(true)),
    "false": newVar("false", rt.bool(false)),
    Unknown: varUnknown
  };
}

// Interprets a list of AST nodes asynchronously, passing the result of
// interpreting the final node in the list (or done, if the list is empty).
Interpreter.prototype.interpret = function (nodes) {
  if (nodes.length === 0) {
    return this.resolve(rt.done);
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
          name = node.name.value;
          varError = undefError(name);

          this.put(name, varError);

          if (constructor === ast.Var) {
            this.put(name + " :=", varError);
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

      return rt.done;
    });
  }).then(function (results) {
    return results.pop();
  });
};

// Enter into an object scope and stay in that state, returning the newly
// created self value. This is useful for an interactive mode.
Interpreter.prototype.enter = function () {
  var self = rt.object();
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
    module.outer = self.scope;
    self.scope = module;
  });
};

Interpreter.prototype["import"] = function (node) {
  var self = this;

  return this.load(node.path.value).then(function (module) {
    var name = node.identifier.value;

    if (name !== "_") {
      self.put(name, newVar(name, module));
    }
  });
};

Interpreter.prototype.object = function (node, inheriting) {
  var self = inheriting || rt.object();

  return this.each(node.annotations, this.expression).then(function () {
    return this.scoped(self, function () {
      return this.interpret(node.body);
    });
  }).then(function () {
    return self;
  });
};

function noMatch() {
  throw "Match against a block without exactly one parameter";
}

Interpreter.prototype.block = function (node) {
  var block, interpreter, match, parameters, signature;

  parameters = node.parameters;
  signature =
    [new ast.SignaturePart(new ast.Identifier("apply"), [], parameters)];
  signature.pattern = null;

  interpreter = this.clone();

  block = rt.block([0, parameters.length], function () {
    var args = [util.slice(arguments)];

    return interpreter.clone().scoped(function () {
      return this.parts(signature, args).then(function () {
        return this.interpret(node.body);
      });
    });
  });

  match = parameters.length === 1 ? function (value) {
    return interpreter.pattern(parameters[0].pattern).then(function (pattern) {
      return pattern.match(value);
    });
  } : noMatch;

  block.match = rt.newMethod("match()", 1, match);

  return block;
};

Interpreter.prototype.assert = function (value, pattern) {
  if (pattern !== rt.Unknown) {
    return this.apply(pattern,
      rt.lookup(pattern, "assert()"), [[value]]);
  }

  return this.resolve(null);
};

Interpreter.prototype.decls = function (nodes) {
  return this.each(nodes, function (node) {
    if (node.constructor === ast.TypeDeclaration) {
      this.put(node.name.value, newType(node.generics.length));
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
          this.put(parameter.value, varUnknown);
        }).then(function () {
          return this.expression(node.value);
        });
      });
    }

    return this.expression(node.value);
  }).then(function (value) {
    // TODO Should assert that the value is statically known, not just
    // that it is a pattern.
    return this.assert(value, rt.Pattern).then(function () {
      // We need to retain the references of the hoisted values, so we
      // need to copy the properties of the resulting expression into
      // the referenced value.
      var type = this.search(node.name.value).value;

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

  return this.resolve(rt.type(names));
};

Interpreter.prototype.string = function (node) {
  return this.resolve(rt.string(node.value));
};

Interpreter.prototype.number = function (node) {
  return this.resolve(rt.number(node.value));
};

// Handles both synchronous and asynchronous requests.
Interpreter.prototype.apply = function () {
  return rt.apply.apply(null, arguments).bind(this);
};

// Handles both synchronous and asynchronous inherit requests.
Interpreter.prototype.inherit = function () {
  return rt.inherit.apply(null, arguments).bind(this);
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

      return [this.search("self").value, overridden];
    }

    return this.expression(rnode).then(function (receiver) {
      return [receiver, rt.lookup(receiver, pretty)];
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
      if (inheriting !== undefined) {
        return this.inherit(inheriting, method, args);
      }

      return this.apply(receiver, method, args);
    });
  });
};

Interpreter.prototype.method = function (node) {
  var body, constructor, init, interpreter, last, method, pretty, signature;

  pretty = node.name();
  signature = node.signature;
  body = node.body;

  // Save the state of the surrounding scope at the point where the method
  // is defined.
  interpreter = this.clone();

  function buildMethod(func) {
    return function () {
      var argParts, self;

      self = this;
      argParts = util.slice(arguments);

      if (signature.length === 1) {
        argParts = [argParts];
      }

      // Reclone the interpreter to get a unique scope for this execution.
      return interpreter.clone().scoped(function () {
        return new Task(this, function (resolve, reject) {
          this.parts(signature, argParts).then(function (pattern) {
            var exit, top;

            // Ensures that the postcondition of the method holds before
            // exiting the method.
            exit = util.once(function (reason, value) {
              top["return"] = null;

              if (reason !== null) {
                reject(reason);
              } else {
                this.assert(value, pattern).then(function () {
                  resolve(value);
                }, reject);
              }
            });

            top = this.scope;
            top["return"] = exit;
            top["super"] = method["super"] || null;

            return func.call(this, self).bind(this).callback(exit);
          }, reject);
        });
      }).bind(null);
    };
  }

  method = rt.newMethod(pretty, this.signature(signature, pretty),
    buildMethod(function () {
      return this.interpret(body).bind(null);
    }));

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

      method.inherit = buildMethod(function (inheriting) {
        return this.interpret(init).then(function () {
          return this.object(last, inheriting);
        });
      });
    }
  }

  return this.each(signature.annotations, this.expression)
    .then(function (annotations) {
      method.annotations = annotations;

      // Put the resulting method in the local scope and complete.
      this.put(pretty, method);
    });
};

// Process a method signature into a runtime parameter count list.
Interpreter.prototype.signature = function (signature, pretty) {
  var hasVarArg, i, j, k, l, param, params, part, parts;

  parts = [];

  for (i = 0, l = signature.length; i < l; i += 1) {
    part = signature[i];
    params = part.parameters;
    hasVarArg = false;

    for (j = 0, k = params.length; j < k; j += 1) {
      param = params[j];
      if (param.isVarArg) {
        if (hasVarArg) {
          throw 'Multiple variadic arguments in method "' + pretty + '"';
        }

        hasVarArg = true;
      }
    }

    parts.push([part.generics.length,
      hasVarArg ? rt.gte(params.length - 1) : params.length]);
  }

  return parts;
};

// Handle the joining of a method and a request by adding generics, evaluating
// patterns, and adding parameters, then producing the return pattern.
Interpreter.prototype.parts = function (msig, rsig) {
  return this.each(msig, rsig, function (mpart, rpart) {
    return this.part(mpart, rpart);
  }).then(function () {
    return this.pattern(msig.pattern);
  });
};

// Handle the joining of individual parts of a method and a request.
Interpreter.prototype.part = function (mpart, rpart) {
  var genLength = mpart.generics.length;

  // Add generics, and test if they are patterns.
  return this.generics(mpart.generics, rpart.slice(0, genLength))
    .then(function () {
      return this.parameters(mpart.parameters, rpart.slice(genLength));
    });
};

// Join a method's generic parameters with the values given by a request.
Interpreter.prototype.generics = function (mgens, rgens) {
  return this.each(mgens, rgens, function (mgen, rgen) {
    if (mgen.value !== "_") {
      this.put(mgen.value, newVar(mgen.value, rgen));
    }
  });
};

// Evaluate a method part's parameters and join them with part of a request.
Interpreter.prototype.parameters = function (params, args) {
  return this.each(params, function (param, i) {
    var varArgSize = args.length - params.length + 1;
    if (param.isVarArg) {
      args.splice(i, 0, rt.list(args.splice(i, varArgSize)));
    }
  }).then(function () {
    return this.patterns(params).then(function (patterns) {
      return this.each(params, function (param) {
        return param.name.value;
      }).then(function (names) {
        return this.arguments(names, patterns, args);
      });
    });
  });
};

// Evaluate a method part's patterns in the scope of its generic arguments.
Interpreter.prototype.patterns = function (parameters) {
  return this.each(parameters, function (parameter) {
    var name = parameter.name.value;

    return this.pattern(parameter.pattern).then(function (pattern) {
      return rt.named(name, parameter.isVarArg ? rt.listOf(pattern) : pattern);
    });
  });
};

Interpreter.prototype.pattern = function (expression) {
  if (expression === null) {
    // No pattern given, default to Unknown.
    return this.resolve(rt.Unknown);
  }

  return this.expression(expression).then(function (pattern) {
    // Check that it's actually a pattern.
    return this.assert(pattern, rt.Pattern).then(function () {
      return pattern;
    });
  });
};

// Join parameters and arguments together.
Interpreter.prototype.arguments = function (names, patterns, args) {
  return this.each(names, patterns, args, function (name, pattern, arg) {
    return this.assert(arg, pattern).then(function () {
      if (name !== "_") {
        this.put(name, newVar(name, arg));
      }
    });
  });
};

Interpreter.prototype.variable = function (node) {
  return this.each(node.annotations, this.expression).then(function () {
    if (node.value === null) {
      return rt.done;
    }

    return this.expression(node.value);
  }).then(function (value) {
    var name, variable;

    name = node.name.value;
    variable = newVar(name, value);

    this.put(name, variable);

    if (node.constructor === ast.Var) {
      this.put(name + " :=", function (value) {
        variable.value = value;
      });
    }

    return rt.done;
  });
};

Interpreter.prototype["return"] = function (node) {
  var expression = node.expression;

  return this.task(function () {
    if (expression === null) {
      return rt.done;
    }

    return this.expression(expression);
  }).then(function (expression) {
    var exit, frame;

    frame = this.scope;
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

      frame = this.scope;
      this.pop();
    }

    throw "Return from outside a method";
  });
};

Interpreter.prototype.inherits = function (node) {
  return this.request(node.request, this.self());
};

// scoped(self : Object, action : () -> T) -> Task<T>
//   Push a new layer and a new self context on to the scope stack, execute an
//   action, and then pop it off.
//
// scoped(action : () -> T) -> Task<T>
//   Push a new layer on to the scope stack, execute an action, and then pop it
//   off.
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

Interpreter.prototype.each = function () {
  return Task.each.apply(Task, [this].concat(util.slice(arguments)));
};

Interpreter.prototype.self = function () {
  if (util.owns(this.scope, "self")) {
    return this.scope.self.value;
  }

  return null;
};

Interpreter.prototype.put = function (pretty, method) {
  var name, self, top;

  name = util.uglify(pretty);
  top = this.scope;

  if (util.owns(top, name) && !top[name].isUndefined) {
    throw "'" + pretty + "' is already defined";
  }

  top[name] = method;

  self = this.self();
  if (self !== null) {
    if (util.owns(self, name) && !self[name].isUndefined) {
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
    frame.self = newVar("self", self);
  }

  frame.outer = this.scope;
  this.scope = frame;
};

Interpreter.prototype.pop = function () {
  this.scope = this.scope.outer;
};

// Search for a value with the given name on self or in scope.
Interpreter.prototype.search = function (name) {
  var frame, self;

  self = null;

  for (frame = this.scope; frame !== null; frame = frame.outer) {
    if (util.owns(frame, name)) {
      return frame[name];
    }

    if (self === null && util.owns(frame, "self")) {
      self = frame.self.value;

      if (typeof self[name] === "function") {
        return self[name];
      }
    }
  }

  return null;
};

// Resolve to a task with this Interperter as the context.
Interpreter.prototype.resolve = function (value) {
  return Task.resolve(this, value);
};

// Safely wrap an action as a task.
Interpreter.prototype.task = function (action) {
  return this.resolve().then(function () {
    return action.call(this);
  });
};

exports.Interpreter = Interpreter;

