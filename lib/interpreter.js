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

var Task, ast, path, rt, util;

path = require("path");

require("setimmediate");

Task = require("./task");
ast = require("./ast");
rt = require("./runtime");
util = require("./util");

// new Interpreter(prelude : Object,
//     moduleLoader : Function<Path, Callback<Object>>)
//   A new interpreter, with internal state preserved between executions.
function Interpreter(prelude, moduleLoader) {
  util.makeCloneable(this, "scope");

  this.isHoisting = false;

  this.modules = {};
  this.load = Task.taskify(this, moduleLoader);

  this.scope = {
    outer: null,
    self: this.newVar("self", prelude)
  };

  util.extend(this.scope, prelude);
}

// Interprets a list of AST nodes asynchronously, passing the result of
// interpreting the final node in the list (or done, if the list is empty).
Interpreter.prototype.interpret = function (nodes) {
  if (nodes.length === 0) {
    this.isHoisting = false;
    return this.resolve(rt.done);
  }

  return this.imports(nodes).then(function () {
    // Methods and variables are hoisted to the top of their scope.
    return this.each(nodes, function (node) {
      var constructor = node.constructor;

      if (constructor === ast.Method || constructor === ast.Class) {
        return this.evaluate(node);
      }

      if (constructor === ast.Def || constructor === ast.Var) {
        return this.putVariable(node, rt.pattern(function () {
          // It's an error to assign to a hoisted var before its actual
          // location in code has been reached.
          return rt.UndefinedValue.raiseForName(rt.string(node.name.value));
        }));
      }
    });
  }).then(function () {
    return this.decls(nodes);
  }).then(function () {
    return this.annotations(nodes);
  }).then(function () {
    this.isHoisting = false;

    return this.each(nodes, function (node) {
      // Imports, methods, and types have already been hoisted. Variables still
      // need their contents to be evaluated.
      if (node.constructor !== ast.Dialect &&
          node.constructor !== ast.Import &&
          node.constructor !== ast.Method &&
          node.constructor !== ast.Class &&
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
  var interpreter, module;

  key = path.normalize(key);
  interpreter = this.clone();
  interpreter.modulePath = key;

  module = rt.object();

  return this.objectBody(nodes, module).then(function () {
    this.modules[path.normalize(key)] = module;
    return module;
  }, rt.handleInternalError);
};

Interpreter.prototype.evaluate = function (node) {
  var constructor = node.constructor;

  if (constructor === ast.Method) {
    return this.method(node);
  }

  if (constructor === ast.Class) {
    return this["class"](node);
  }

  if (constructor === ast.Def || constructor === ast.Var) {
    return this.variable(node, false);
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

  if (constructor === ast.Self) {
    if (this.isHoisting) {
      return rt.IncompleteObject.raiseForSelf()
        .bind(this).then(null, function (packet) {
          return this.report(packet, "self", null, node);
        });
    }

    return this.resolve(this.search("self", true).value);
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

  if (constructor === ast.BooleanLiteral) {
    return this.boolean(node);
  }

  if (constructor === ast.NumberLiteral) {
    return this.number(node);
  }

  if (constructor === ast.StringLiteral) {
    return this.string(node);
  }

  if (constructor === ast.Outer) {
    return this.outer(node);
  }

  return rt.InternalError
    .raise(rt.string("Unrecognised node of type " + constructor.name));
};

Interpreter.prototype.inheriting = function (node, inheriting) {
  var constructor = node.constructor;

  if (constructor === ast.Request) {
    return this.request(node, inheriting);
  }

  if (constructor === ast.BooleanLiteral) {
    return this.boolean(node, inheriting);
  }

  return rt.InternalError
    .raise(rt.string("Unrecognised node of type " +
      constructor.name + " in inheritance"));
};

Interpreter.prototype.imports = function (nodes) {
  return this.each(nodes, function (node) {
    var constructor = node.constructor;

    if (constructor === ast.Dialect) {
      return this.dialect(node);
    }

    if (constructor === ast.Import) {
      return this["import"](node);
    }
  });
};

Interpreter.prototype.dialect = function (node) {
  return this.load(node.path.value).bind(this).then(function (module) {
    var scope = { outer: null };

    util.extend(scope, module);

    this.scope.outer = scope;
  }, function (packet) {
    return this.report(packet, 'dialect "' + node.path.value + '"', null, node);
  });
};

Interpreter.prototype["import"] = function (node) {
  return this.load(node.path.value).bind(this).then(function (module) {
    var name = node.identifier.value;

    if (name !== "_") {
      return this.put(name, this.newVar(name, module), node);
    }
  }, function (packet) {
    return this.report(packet, 'import "' + node.path.value + '"', null, node);
  });
};

Interpreter.prototype.annotations = function (nodes) {
  return this.each(nodes, function (node) {
    return this.task(function () {
      if (node.constructor === ast.TypeDeclaration ||
          node.constructor === ast.Def || node.constructor === ast.Class) {
        return this.annotate([this.scope[node.name.value]], node.annotations,
          node.constructor === ast.Def ? "Def" :
              node.constructor === ast.Class ? "Class" : "Type");
      }

      if (node.constructor === ast.Method) {
        return this.annotate([this.scope[util.uglify(node.signature.name())]],
          node.annotations, "Method");
      }

      if (node.constructor === ast.Var) {
        return this.annotate([this.scope[node.name.value],
          this.scope[node.name.value + ":="]], node.annotations, "Var");
      }
    }).then(null, function (packet) {
      return this.reportNode(packet, node);
    });
  });
};

Interpreter.prototype.annotate = function (values, annotations, name) {
  return this.each(annotations, function (annotation) {
    return this.expression(annotation).then(function (annotation) {
      return this.assert(annotation, rt[name + "Annotator"])
        .then(function () {
          return this.apply(annotation, "annotate" + name, values);
        });
    });
  });
};

Interpreter.prototype.object = function (node, inheriting) {
  return this.objectBody(node.body, inheriting).then(function (object) {
    // This is the only set of annotations that is evaluated at the point where
    // it appears in the code. ALl other annotations are hoisted.
    return this.annotate([object], node.annotations, "Object")
      .then(function () {
        return object;
      });
  }).then(null, function (packet) {
    return this.report(packet, "object", null, node);
  });
};

Interpreter.prototype.objectBody = function (body, inheriting) {
  var object = inheriting || rt.object();

  return this.scoped(object, function () {
    this.isHoisting = true;
    return this.interpret(body);
  }).then(function () {
    return object;
  });
};

Interpreter.prototype.block = function (node) {
  var block, interpreter, parameters, pattern, signature;

  parameters = node.parameters;
  signature = [new ast.SignaturePart(new ast.Identifier("apply", false, node),
    [], parameters)];
  signature.pattern = null;

  interpreter = this.clone();

  block = rt.block([0, parameters.length], function () {
    var args = [util.slice(arguments)];

    return interpreter.clone().scoped(function () {
      return this.parts(signature, args, node).then(function () {
        return this.interpret(node.body);
      });
    });
  });

  if (parameters.length === 1) {
    pattern = parameters[0].pattern;

    if (pattern !== null) {
      block.match = rt.method("match()", 1, function (object) {
        return interpreter.pattern(pattern).then(function (pattern) {
          return pattern.match(object).then(function (match) {
            return match.andAlso(rt.block(0, function () {
              // TODO Don't retest the pattern on apply.
              return block.apply(object).then(function (result) {
                return rt.success(result);
              });
            }));
          });
        });
      });
    }
  }

  return block;
};

Interpreter.prototype.assert = function (value, pattern) {
  if (pattern !== rt.Unknown) {
    return rt.lookup(pattern, "assert()").bind(this).then(function (method) {
      return this.apply(pattern, method, [[value]]);
    }).then(null, function (packet) {
      packet.object.stackTrace = [];
      throw packet;
    });
  }

  return this.resolve(null);
};

Interpreter.prototype.decls = function (nodes) {
  return this.each(nodes, function (node) {
    if (node.constructor === ast.TypeDeclaration) {
      var name = node.name.value;

      return this.put(name, this.newType(name, node.generics.length), node)
        .then(function () {
          return node;
        });
    }
  }).then(function (decls) {
    return this.each(decls, this.decl);
  });
};

Interpreter.prototype.decl = function (node) {
  return this.task(function () {
    if (node.generics.length !== 0) {
      // TODO Build a better semantics for recursive types.
      return this.scoped(function () {
        return this.each(node.generics, function (parameter) {
          var name = parameter.value;
          return this.put(name, this.newVar(name, rt.Unknown), node);
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
      var decl, type;

      // This is safe because types cannot be overridden.
      decl = this.scope[node.name.value];
      type = decl.value;

      util.forAllProperties(value, function (name, value) {
        if (name !== "asString") {
          type[name] = value;
        }
      });
    }).then(null, function (packet) {
      return this.report(packet, "type " + node.name.value, null, node);
    });
  });
};

Interpreter.prototype.type = function (node) {
  var i, j, l, name, names, signatures;

  function report(packet) {
    return this.report(packet, "type", null, node);
  }

  signatures = node.signatures;
  names = [];

  for (i = 0, l = signatures.length; i < l; i += 1) {
    name = node.nameOf(i);

    for (j = 0; j < i; j += 1) {
      if (names[j] === name) {
        return rt.InvalidType.raiseDefault().bind(this).then(null, report);
      }
    }

    names.push(name);
  }

  return this.resolve(rt.type(names));
};

Interpreter.prototype.boolean = function (node, inheriting) {
  var method = rt[node.value ? "mtrue" : "mfalse"];

  if (inheriting !== undefined) {
    return this.inherit(null, method, inheriting);
  }

  return method();
};

Interpreter.prototype.number = function (node) {
  return this.resolve(rt.number(node.value));
};

Interpreter.prototype.string = function (node) {
  return this.resolve(rt.string(node.value));
};

Interpreter.prototype.outer = function (node) {
  var i, l, scope;

  i = 0;
  l = node.depth + 1;

  for (scope = this.scope; scope !== null; scope = scope.outer) {
    if (util.owns(scope, "self")) {
      if (i === l) {
        return this.resolve(scope.self.value);
      }

      i += 1;
    }
  }

  return rt.OuterLimit.raiseDefault().bind(this).then(null, function (packet) {
    return this.report(packet, "outer", null, node);
  });
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
    var l, method, overridden, ref, self;

    if (rnode === null) {
      return this.task(function () {
        ref = this.search(name, false);

        if (this.isHoisting &&
            util.owns(this.scope, name) && this.self() !== null) {
          return rt.IncompleteObject.raiseForName(rt.string(pretty));
        }

        if (ref === null) {
          // Don't complain about assignment not existing when the variable that
          // was supposed to be assigned to doesn't exist in the first place.
          l = name.length - 3;
          if (name.substring(l) === " :=") {
            name = name.substring(0, l);
          }

          return rt.UnresolvedRequest.raiseForName(rt.string(pretty));
        }

        return [null, ref];
      }).bind(this).then(null, function (packet) {
        return this.report(packet, pretty, null, node);
      });
    }

    if (rnode.constructor === ast.Super) {
      method = this.search("method", true);
      overridden = this.search("super", false);
      self = this.search("self", true).value;

      return this.task(function () {
        if (overridden === null) {
          // The overridden value is missing because there is no method with
          // that name in any of the inherited super objects.
          if (self[name] === undefined || self[name] === method) {
            return rt.InvalidSuper.raiseNoSuchMethodForName(rt.string(pretty));
          }

          // The overridden value is missing because the current execution isn't
          // even inside a method.
          return rt.InvalidSuper.raiseOutsideOfMethodForName(rt.string(pretty));
        }

        // There is such a super method, but it's not the one that was
        // overridden by the method that the current execution is in.
        if (method.identifier !== pretty) {
          return rt.InvalidSuper.raiseForName_inMethod([rt.string(pretty)],
            [rt.string(method.identifier)]);
        }

        return [self, overridden];
      }).bind(this).then(null, function (packet) {
        return this.report(packet, pretty, "super", node);
      });
    }

    return this.expression(rnode).then(function (receiver) {
      return rt.lookup(receiver, pretty, rnode.constructor === ast.Self)
        .bind(this).then(function (method) {
          return [receiver, method];
        }, function (packet) {
          return this.report(packet, pretty, receiver, node);
        });
    });
  }).then(function (pair) {
    var method, receiver;

    receiver = pair[0];
    method = pair[1];

    return this.each(node.signature, function (part) {
      if (method.isVariable && part.generics.length > 0) {
        return rt.InvalidRequest.raiseGenericsForVariable(rt.string(name));
      }

      return this.each(part.generics, function (param) {
        return this.expression(param);
      }).then(function (generics) {
        if (part.parameters.length > 0) {
          if (method.isVariable) {
            return rt.InvalidRequest.raiseArgumentsForVariable(rt.string(name));
          }

          if (method.isStatic) {
            return rt.InvalidRequest.raiseArgumentsForType(rt.string(name));
          }
        }

        return this.each(part.parameters, this.expression)
          .then(function (parameters) {
            parameters.generics = generics;
            return parameters;
          });
      });
    }).then(null, function (packet) {
      return this.report(packet, pretty, receiver, node);
    }).then(function (args) {
      if (inheriting !== undefined) {
        return this.inherit(receiver, method, inheriting, args);
      }

      return this.apply(receiver, method, args)
        .then(null, rt.handleInternalError).then(null, function (packet) {
          var stackTrace = packet.object.stackTrace;

          if (rnode !== null && rnode.constructor === ast.Super) {
            receiver = "super";
          }

          if (!method.isUntraced) {
            if (stackTrace.length > 0) {
              stackTrace = stackTrace[stackTrace.length - 1];

              stackTrace.object = receiver;
              stackTrace.location = {
                module: this.modulePath || null,
                line: node.location.line,
                column: node.location.column
              };
            } else {
              this.report(packet, pretty, receiver, node);
            }
          }

          throw packet;
        });
    });
  });
};

Interpreter.prototype["class"] = function (node) {
  var object = rt.object();

  return this.scoped(object, function () {
    return this.method(node);
  }).then(function () {
    var def, name;

    name = node.name.value;
    def = this.newVar(name, object, true);

    return this.put(name, def, node);
  });
};

Interpreter.prototype.method = function (node) {
  var body, constructor, init, interpreter, last, method, pretty, signature;

  pretty = node.signature.name();
  signature = node.signature;
  body = node.body;

  // Save the state of the surrounding scope at the point where the method
  // is defined.
  interpreter = this.clone();

  function buildMethod(isInherits, func) {
    return function (inheriting) {
      var argParts = util.slice(arguments, isInherits ? 1 : 0);

      if (signature.length === 1) {
        argParts = [argParts];
      }

      // Reclone the interpreter to get a unique scope for this execution.
      return interpreter.clone().scoped(function () {
        return new Task(this, function (resolve, reject) {
          this.parts(signature, argParts, node).then(function (pattern) {
            var exit, top;

            // Ensures that the postcondition of the method holds before
            // exiting the method.
            exit = function (value) {
              top["return"] = function () {
                return rt.InvalidReturn
                  .raiseForCompletedMethod(rt.string(pretty));
              };

              this.assert(value, pattern).then(function () {
                resolve(value);
              }, reject);

              return new Task(function () {
                return;
              });
            };

            top = this.scope;
            top["return"] = exit;
            top.method = method;
            top["super"] = method["super"] || null;

            return func.call(this, inheriting).bind(this).then(exit, reject);
          }, reject);
        });
      }).bind(null);
    };
  }

  return this.signature(signature, pretty).then(function (parts) {
    method = rt.method(pretty, parts,
      buildMethod(false, node.constructor === ast.Class ? function () {
        return this.objectBody(body).bind(null);
      } : function () {
        return this.interpret(body).bind(null);
      }));

    // Build inheritance mechanism.
    if (node.constructor === ast.Class) {
      method.inherit = rt.inheritor(pretty, parts,
        buildMethod(true, function (inheriting) {
          return this.objectBody(body, inheriting);
        }));
    } else if (body.length > 0) {
      last = body[body.length - 1];
      constructor = last.constructor;

      if (constructor === ast.Return) {
        last = last.expression;

        if (last !== null) {
          constructor = last.constructor;
        }
      }

      if (constructor === ast.ObjectConstructor) {
        body = body.concat();
        body.pop();
        init = body;
        body = init.concat([last]);

        method.inherit = rt.inheritor(pretty, parts,
          buildMethod(true, function (inheriting) {
            return this.interpret(init).then(function () {
              return this.object(last, inheriting);
            });
          }));
      }
    }

    // Put the resulting method in the local scope and run annotations.
    return this.put(pretty, method, node);
  });
};

// Process a method signature into a runtime parameter count list.
Interpreter.prototype.signature = function (signature, pretty) {
  var hasVarArg, i, j, k, l, param, params, part, parts;

  function report(packet) {
    return this.report(packet, "method", null, part);
  }

  parts = [];

  for (i = 0, l = signature.length; i < l; i += 1) {
    part = signature[i];
    params = part.parameters;
    hasVarArg = false;

    for (j = 0, k = params.length; j < k; j += 1) {
      param = params[j];
      if (param.isVarArg) {
        if (hasVarArg) {
          return rt.InvalidMethod
            .raiseMultipleVariadicParametersForName(rt.string(pretty))
            .bind(this).then(null, report);
        }

        hasVarArg = true;
      }
    }

    parts.push([part.generics.length,
      hasVarArg ? rt.gte(params.length - 1) : params.length]);
  }

  return this.resolve(parts);
};

// Handle the joining of a method and a request by adding generics, evaluating
// patterns, and adding parameters, then producing the return pattern.
Interpreter.prototype.parts = function (msig, rsig, node) {
  return this.each(msig, rsig, function (mpart, rpart) {
    return this.part(mpart, rpart, node);
  }).then(function () {
    return this.pattern(msig.pattern);
  });
};

// Handle the joining of individual parts of a method and a request.
Interpreter.prototype.part = function (mpart, rpart, node) {
  var genLength = mpart.generics.length;

  // Add generics, and test if they are patterns.
  return this.generics(mpart.generics, rpart.slice(0, genLength), node)
    .then(function () {
      return this.parameters(mpart.parameters, rpart.slice(genLength), node);
    });
};

// Join a method's generic parameters with the values given by a request.
Interpreter.prototype.generics = function (mgens, rgens, node) {
  return this.each(mgens, rgens, function (mgen, rgen) {
    if (mgen.value !== "_") {
      return this.put(mgen.value, this.newVar(mgen.value, rgen), node);
    }
  });
};

// Evaluate a method part's parameters and join them with part of a request.
Interpreter.prototype.parameters = function (params, args, node) {
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
        return this.arguments(names, patterns, args, node);
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
Interpreter.prototype.arguments = function (names, patterns, args, node) {
  return this.each(names, patterns, args, function (name, pattern, arg) {
    return this.assert(arg, pattern).then(function () {
      if (name !== "_") {
        return this.put(name, this.newVar(name, arg), node);
      }
    });
  });
};

Interpreter.prototype.variable = function (node) {
  return this.pattern(node.pattern).then(function (pattern) {
    var name, variable;

    name = node.name.value;
    variable = this.scope[name];
    variable.pattern = pattern;

    if (node.value !== null) {
      return this.expression(node.value).then(function (value) {
        return this.assert(value, pattern).then(function () {
          variable.value = value;
        });
      });
    }
  }).then(function () {
    return rt.done;
  }, function (packet) {
    return this.reportNode(packet, node);
  });
};

Interpreter.prototype.putVariable = function (node, pattern) {
  var name, variable;

  name = node.name.value;
  variable = this.newVar(name);

  return this.put(name, variable, node).then(function () {
    var self, setter;

    if (node.constructor === ast.Var) {
      self = this;
      variable.pattern = pattern;

      setter = rt.method(name + " :=", 1, function (value) {
        return self.assert(value, variable.pattern).then(function () {
          variable.value = value;
          return rt.done;
        });
      });

      setter.isConfidential = true;

      return this.put(name + " :=", setter, node);
    }
  }).then(function () {
    return variable;
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
    var exit = this.search("return", false);

    if (exit === null) {
      return rt.InvalidReturn.raiseInsideOfObject();
    }

    return exit.call(this, expression).bind(this);
  }).then(null, function (packet) {
    return this.report(packet, "return", null, node);
  });
};

Interpreter.prototype.inherits = function (node) {
  var self = this;

  return this.inheriting(node.request, this.self())
    .then(null, function (packet) {
      return self.report(packet, "inherits " + node.request.name(), null, node);
    });
};

// Create a new variable accessor that stores the value it is accessing as a
// property.
Interpreter.prototype.newVar = function (name, value, isPublic) {
  var variable = rt.method(name, 0, function () {
    if (util.owns(variable, "value")) {
      return variable.value;
    }

    return rt.UndefinedValue.raiseForName(rt.string(name));
  });

  if (value !== undefined) {
    variable.value = value;
  }

  variable.isVariable = true;
  variable.isConfidential = !isPublic;
  variable.identifier = name;
  variable.modulePath = this.modulePath;

  return variable;
};

// Create a new type accessor that stores the number of generics as a property.
Interpreter.prototype.newType = function (name, generics) {
  var type, value;

  value = rt.proxy(name);

  type = rt.method(name, [[generics, 0]], function () {
    return rt.withGenerics
      .apply(null, [name, value].concat(util.slice(arguments)));
  });

  type.value = value;
  type.isStatic = true;
  type.modulePath = this.modulePath;

  return type;
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

Interpreter.prototype.put = function (pretty, method, node) {
  var existing, name, self, sub, top;

  name = util.uglify(pretty);
  top = this.scope;

  // Because method creation happens bottom upwards, if an invalid override
  // occurs it can't be detected until the super method is evaluated. By saving
  // the node with the method, the lower, erroneous method can be reported
  // rather than the non-erroneous super method.
  method.node = node;

  return this.task(function () {
    if (util.owns(top, name)) {
      existing = (top[name] && top[name].identifier) || pretty;

      return rt.Redefinition.raiseForName(rt.string(existing));
    }

    top[name] = method;

    self = this.self();
    if (self !== null) {
      if (util.owns(self, name)) {
        if (method.isStatic) {
          return rt.InvalidMethod.raiseStaticOverrideForName(rt.string(pretty));
        }

        sub = self[name];

        while (util.owns(sub, "super")) {
          sub = sub["super"];
        }

        if (sub.isConfidential && !method.isConfidential) {
          node = sub.node;
          return rt.InvalidMethod
            .raiseConfidentialOverrideForName(rt.string(pretty));
        }

        sub["super"] = method;
      } else {
        self[name] = method;
      }
    }
  }).bind(this).then(null, function (packet) {
    return this.reportNode(packet, node);
  });
};

Interpreter.prototype.push = function (self) {
  var frame;

  frame = {};

  if (self !== undefined) {
    frame.self = this.newVar("self", self);
  }

  frame.outer = this.scope;
  this.scope = frame;
};

Interpreter.prototype.pop = function () {
  this.scope = this.scope.outer;
};

// Search for a value with the given name on self or in scope.
Interpreter.prototype.search = function (name, scopeOnly) {
  var frame, self;

  for (frame = this.scope; frame !== null; frame = frame.outer) {
    if (!scopeOnly && util.owns(frame, "self")) {
      if (name === "return" || name === "super") {
        return null;
      }

      self = frame.self.value;

      if (self[name] !== undefined) {
        return self[name];
      }

      scopeOnly = true;
    }

    if (util.owns(frame, name)) {
      return frame[name];
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
  return this.resolve(null).then(function () {
    return action.call(this);
  });
};

Interpreter.prototype.report = function (packet, name, object, node) {
  return this.task(function () {
    return rt.handleInternalError(packet);
  }).then(null, function (packet) {
    packet.object.stackTrace.push(rt.trace(name, object, {
      module: this.modulePath || null,
      line: node.location.line,
      column: node.location.column
    }));

    throw packet;
  });
};

Interpreter.prototype.reportNode = function (packet, node) {
  var type;

  if (node.constructor === ast.Def) {
    type = "def " + node.name.value;
  } else if (node.constructor === ast.Var) {
    type = "var " + node.name.value;
  } else if (node.constructor === ast.Method) {
    type = "method " + node.signature.name();
  } else if (node.constructor === ast.Class) {
    type = "class " + node.name.value;
  } else if (node.constructor === ast.TypeDeclaration) {
    type = "type " + node.name.value;
  } else if (node.constructor === ast.Import) {
    type = 'import "..." as ' + node.identifier.value;
  } else {
    type = node.toString();
  }

  return this.report(packet, type, null, node);
};

exports.Interpreter = Interpreter;

