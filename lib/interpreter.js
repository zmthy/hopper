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

Task = require("./task");
ast = require("./ast");
rt = require("./runtime");
util = require("./util");

// new Interpreter(prelude : Object,
//     moduleLoader : Function<Path, Callback<Object>>)
//   A new interpreter, with internal state preserved between executions.
function Interpreter(prelude, moduleLoader) {
  util.makeCloneable(this, "scope");

  this.modules = {};
  this.load = Task.taskify(this, moduleLoader);

  this.scope = {
    "outer": null,
    "self": prelude
  };
}

// Interprets a list of AST nodes asynchronously, passing the result of
// interpreting the final node in the list (or done, if the list is empty).
Interpreter.prototype.interpret = function (nodes) {
  function handleObject() {
    var context, isConfidential, method, name, outer;

    if (this.scope.object &&
        (nodes.length === 0 || nodes[0].constructor !== ast.Inherits)) {
      delete this.scope.object;

      context = this.self();

      for (name in context) {
        if (typeof context[name] === "function") {
          method = context[name];

          isConfidential = method.isConfidential;

          while (util.owns(method, "super")) {
            method = method["super"];

            if (method.isConfidential) {
              isConfidential = true;
            } else if (isConfidential) {
              name = rt.string(method.identifier);
              return rt.InvalidMethod.raiseConfidentialOverrideForName(name);
            }
          }
        }
      }

      if (context.asString === rt.base.asString) {
        outer = this.searchScope("self", true);
        method = this.searchScope("method", true);

        if (method !== null) {
          name = method.identifier;

          context.asString = rt.method("asString", 0, function () {
            return outer.asString().then(function (string) {
              return string.asPrimitiveString().then(function (pstring) {
                return rt.string("object(" + pstring + "." + name + ")");
              });
            });
          });
        } else if (this.modulePath !== undefined) {
          name = this.modulePath;

          context.asString = rt.method("asString", 0, function () {
            return rt.string("object(" + name + ")");
          });
        }
      }
    }

    return this.resolve(rt.done);
  }

  if (nodes.length === 0) {
    return handleObject.call(this);
  }

  return this.imports(nodes).then(function () {
    // Methods and variables are hoisted to the top of their scope.
    return this.each(nodes, function (node) {
      var constructor = node.constructor;

      if (constructor === ast.Method || constructor === ast.Class) {
        return this.evaluate(node);
      }

      if (constructor === ast.Def || constructor === ast.Var) {
        return this.putVariable(node, rt.pattern("Uninitialized", function () {
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
  }).then(handleObject).then(function () {
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
  var object = rt.object();
  this.push(object);
  return object;
};

// Interpret a list of nodes as a module body and cache it based on a path so a
// request for the same module does not occur again.
Interpreter.prototype.module = function (nodes, key) {
  var interpreter, module;

  key = path.normalize(key);
  interpreter = this.clone();
  interpreter.modulePath = key;

  module = rt.object();

  module.asString = rt.method("asString", 0, function () {
    return rt.string(key);
  });

  return interpreter.objectBody(nodes, module).bind(this).then(function () {
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

  return this.expression(node);
};

Interpreter.prototype.expression = function (node) {
  var constructor = node.constructor;

  if (constructor === ast.UnqualifiedRequest ||
      constructor === ast.QualifiedRequest) {
    return this.request(node);
  }

  if (constructor === ast.Self) {
    if (this.scope.object) {
      return rt.IncompleteObject.raiseForSelf()
        .bind(this).then(null, function (packet) {
          return this.report(packet, "self", null, node);
        });
    }

    return this.resolve(this.searchScope("self"));
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
    return this.bool(node);
  }

  if (constructor === ast.NumberLiteral) {
    return this.number(node);
  }

  if (constructor === ast.StringLiteral) {
    return this.string(node);
  }

  return this.raise("Unrecognised node of type " + constructor.name);
};

Interpreter.prototype.inheriting = function (node, inheriting) {
  var constructor = node.constructor;

  if (constructor === ast.UnqualifiedRequest ||
      constructor === ast.QualifiedRequest) {
    return this.request(node, inheriting);
  }

  if (constructor === ast.BooleanLiteral) {
    return this.bool(node, inheriting);
  }

  return this.raise(rt.string("Unrecognised node of type " +
      constructor.name + " in inheritance")).bind(this);
};

Interpreter.prototype.imports = function (nodes) {
  return this.each(nodes, function (node) {
    var constructor = node.constructor;

    if (constructor === ast.Dialect) {
      return this.dialect(node, nodes);
    }

    if (constructor === ast.Import) {
      return this["import"](node);
    }
  });
};

Interpreter.prototype.check = function (nodes) {
  var name;

  if (nodes.length > 0 && nodes[0].constructor === ast.Dialect) {
    name = nodes[0].path.value;

    return this.dialect(nodes[0], nodes).then(function () {
      return nodes;
    }, function (packet) {
      if (packet instanceof rt.CheckerFailure.object.Packet &&
          packet.object.module === name) {
        return packet;
      }

      throw packet;
    });
  }

  return Task.resolve(nodes);
};

Interpreter.prototype.dialect = function (node, nodes) {
  var name = node.path.value;

  return this.load(name).bind(this).then(function (module) {
    return this.task(function () {
      if (typeof module.check === "function") {
        return module.check(rt.list(nodes));
      }
    }).then(function () {
      this.scope.outer = {
        "outer": null,
        "self": module
      };
    }, function (packet) {
      var object = packet.object;

      if (packet instanceof rt.CheckerFailure.object.Packet &&
          object.module === undefined) {
        object.stackTrace = [];
        object.module = name;

        if (object.node) {
          return this.reportNode(packet, object.node);
        }
      }

      throw packet;
    });
  }).then(null, function (packet) {
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
      var scope = this.scope;

      function getDefinition(name) {
        return scope[name || node.name.value];
      }

      if (node.constructor === ast.TypeDeclaration ||
          node.constructor === ast.Def || node.constructor === ast.Class) {
        return this.annotate([getDefinition()], node.annotations,
          node.constructor === ast.Def ? "Def" :
              node.constructor === ast.Class ? "Class" : "Type");
      }

      if (node.constructor === ast.Method) {
        return this
          .annotate([getDefinition(util.uglify(node.signature.name()))],
            node.annotations, "Method");
      }

      if (node.constructor === ast.Var) {
        return this.annotate([
          getDefinition(),
          getDefinition(node.name.value + ":=")
        ], node.annotations, "Var");
      }
    }).then(null, function (packet) {
      return this.reportNode(packet, node);
    });
  });
};

Interpreter.prototype.annotate = function (values, annotations, name) {
  return this.each(annotations, function (annNode) {
    return this.expression(annNode).then(function (annotation) {
      return this.assert(annotation, rt[name + "Annotator"])
        .then(function () {
          return this.apply(annotation, "annotate" + name, [values]);
        });
    });
  });
};

Interpreter.prototype.object = function (node, inheriting) {
  return this.objectBody(node.body, inheriting).then(function (object) {
    // This is the only set of annotations that is evaluated at the point where
    // it appears in the code. All other annotations are hoisted.
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
    this.scope.object = true;

    return this.interpret(body);
  }).then(function () {
    return object;
  });
};

Interpreter.prototype.block = function (node) {
  var block, interpreter, parameter, parameters, patternNode, signature;

  parameters = node.parameters;
  signature = new ast.Signature([
    new ast.SignaturePart(new ast.Identifier("apply", false, node),
      [], parameters)
  ], null, node);

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
    parameter = parameters[0];
    patternNode = parameter.pattern;

    if (patternNode !== null) {
      block.match = rt.method("match()", 1, function (object) {
        return interpreter.pattern(patternNode).then(function (pattern) {
          return pattern.match(object).then(function (match) {
            return match.andAlso(rt.block(0, function () {
              // Reimplement apply(), without testing the pattern.
              return interpreter.clone().scoped(function () {
                var name = parameter.name.value;

                return this.task(function () {
                  if (name !== "_") {
                    return this.put(name, this.newVar(name, object), parameter);
                  }
                }).then(function () {
                  return this.interpret(node.body).then(function (result) {
                    return rt.success(result, block);
                  });
                });
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
    return this.apply(pattern, "assert()", [[value]]);
  }

  return this.resolve(null);
};

Interpreter.prototype.decls = function (nodes) {
  return this.each(nodes, function (node) {
    var name;

    if (node.constructor === ast.TypeDeclaration) {
      name = node.name.value;

      return this.put(name, this.newType(name, node.generics.length), node)
        .then(function () {
          return node;
        });
    }
  }).then(function (declNodes) {
    return this.each(declNodes, this.decl).then(function (decls) {
      return this.each(declNodes, decls, this.putDecl);
    }).then(function () {
      return this.each(declNodes, function (node) {
        if (this.scope[node.name.value].value.object.become) {
          return rt.InvalidType
            .raiseSelfDependencyForType(rt.string(node.name.value))
            .bind(this).then(null, this.reportDecl(node));
        }
      });
    });
  });
};

Interpreter.prototype.decl = function (node) {
  function evaluate() {
    if (node.value.constructor === ast.Type) {
      return this.type(node.value, node.name.value);
    }

    return this.expression(node.value);
  }

  return this.task(function () {
    if (node.generics.length !== 0) {
      // TODO Build a better semantics for recursive types.
      return this.scoped(function () {
        return this.each(node.generics, function (parameter) {
          var name = parameter.value;
          return this.put(name, this.newVar(name, rt.Unknown), node);
        }).then(evaluate);
      });
    }

    return evaluate.call(this);
  }).then(null, this.reportDecl(node));
};

Interpreter.prototype.putDecl = function (node, pattern) {
  // TODO Should assert that the value is statically known, not just
  // that it is a pattern.
  return this.assert(pattern, rt.Pattern).then(function () {
    // We need to retain the references of the hoisted values, so we
    // need to copy the properties of the resulting expression into
    // the referenced value.
    var decl, proxy;

    // This is safe because types cannot be overridden.
    decl = this.scope[node.name.value];
    proxy = decl.value;

    return proxy.object.become(pattern);
  }).then(null, this.reportDecl(node));
};

Interpreter.prototype.reportDecl = function (node) {
  return function (packet) {
    var trace;

    // Remove the report about the anonymous type when it appears directly in a
    // type alias declaration.
    if (typeof packet.object === "object") {
      trace = packet.object.stackTrace;
      if (trace.length > 0 && trace[0].name === "type") {
        trace.shift();
      }
    }

    return this.report(packet, "type " + node.name.value, null, node);
  };
};

Interpreter.prototype.type = function (node, decl) {
  var i, j, l, name, names, nsignatures, tsignatures;

  function report(packet) {
    return this.report(packet, "type", null, node);
  }

  nsignatures = node.signatures;
  names = [];
  tsignatures = [];

  for (i = 0, l = nsignatures.length; i < l; i += 1) {
    name = node.nameOf(i);

    for (j = 0; j < i; j += 1) {
      if (names[j] === name) {
        decl = decl === undefined ? node : rt.string(decl);

        return rt.InvalidType
          .raiseDuplicateMethodName_inType([rt.string(name)], [decl])
          .bind(this).then(null, report);
      }
    }

    names.push(name);

    tsignatures.push(this.typeSignature(nsignatures[i]));
  }

  return this.resolve(rt.type(tsignatures));
};

Interpreter.prototype.typeSignature = function (signature) {
  var generics, hasVarArg, i, l, parameters, part, parts;

  function getValue(node) {
    return node.value;
  }

  function getName(node) {
    if (node.isVarArg) {
      hasVarArg = true;
      return "*" + node.name.value;
    }

    return node.name.value;
  }

  parts = [];

  for (i = 0, l = signature.parts.length; i < l; i += 1) {
    hasVarArg = false;
    part = signature.parts[i];
    generics = util.map(part.generics, getValue);
    parameters = util.map(part.parameters, getName);

    parts.push(rt.sigPart(part.name.value, hasVarArg, generics, parameters));
  }

  return rt.signature(parts);
};

Interpreter.prototype.bool = function (node, inheriting) {
  var method = rt[node.value ? "mtrue" : "mfalse"];

  if (inheriting !== undefined) {
    return this.inherit(null, method, inheriting);
  }

  return method().bind(this);
};

Interpreter.prototype.number = function (node) {
  return this.resolve(rt.number(node.value));
};

Interpreter.prototype.string = function (node) {
  return this.resolve(rt.string(node.value));
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
  var name, pretty;

  pretty = node.name();
  name = util.uglify(pretty);

  return this.task(function () {
    if (node.constructor === ast.UnqualifiedRequest) {
      return this.unqualifiedRequest(node, name, pretty);
    }

    return this.qualifiedRequest(node, name, pretty);
  }).then(function (pair) {
    var method, receiver;

    receiver = pair[0];
    method = pair[1];

    return this.each(node.parts, function (part) {
      if (method.isVariable && part.generics.length > 0) {
        return rt.InvalidRequest.raiseGenericsForVariable(rt.string(name));
      }

      return this.each(part.generics, function (param) {
        return this.expression(param);
      }).then(function (generics) {
        if (part.arguments.length > 0) {
          if (method.isVariable) {
            return rt.InvalidRequest.raiseArgumentsForVariable(rt.string(name));
          }

          if (method.isStatic) {
            return rt.InvalidRequest.raiseArgumentsForType(rt.string(name));
          }
        }

        return this.each(part.arguments, this.expression)
          .then(function (args) {
            args.generics = generics;
            return args;
          });
      });
    }).then(function (args) {
      return this.task(function () {
        if (inheriting !== undefined) {
          return this.inherit(receiver, method, inheriting, args);
        }

        return this.apply(receiver, method, args);
      }).then(null, rt.handleInternalError).then(null, function (packet) {
        if (node.constructor === ast.QualifiedRequest &&
            node.receiver.constructor === ast.Super) {
          receiver = "super";
        }

        packet.object.stackTrace.pop();
        return this.report(packet, pretty, receiver, node);
      });
    });
  });
};

Interpreter.prototype.unqualifiedRequest = function (node, name, pretty) {
  return this.search(name).then(function (pair) {
    var l, rec, ref;

    if (pair === null) {
      // Produce a more specific error message for missing assignment.
      l = name.length - 2;
      if (name.substring(l) === ":=") {

        // The pretty name has a space in it that moves the index to split
        // at forward by one, but the increased length of the total string
        // means that 'l' is still the correct index.
        pretty = rt.string(pretty.substring(0, l));

        return this.search(name.substring(0, l)).then(function (found) {
          if (found === null) {
            return rt.UnresolvedRequest
              .raiseForAssignToUnresolvedName(pretty);
          }

          return rt.UnresolvedRequest.raiseForAssignToName(pretty);
        });
      }

      return rt.UnresolvedRequest.raiseForName(rt.string(pretty));
    }

    rec = pair[0];
    ref = pair[1];

    if (rec !== null && this.scope.object &&
        rec === this.searchScope("self") && !util.owns(ref, "value")) {
      return rt.IncompleteObject.raiseForName(rt.string(pretty));
    }

    return pair;
  }).then(null, function (packet) {
    return this.report(packet, pretty, null, node);
  });
};

Interpreter.prototype.qualifiedRequest = function (node, name, pretty) {
  var context, method, rnode, sup;

  rnode = node.receiver;

  if (rnode.constructor === ast.Super) {
    sup = this.searchScope("super", false);
    context = this.searchScope("self");

    return this.task(function () {
      if (sup !== null) {
        if (util.owns(sup, name)) {
          // This super is attempting to request the method above the one that
          // was defined when this scope was first entered.
          method = sup[name]["super"];
        } else {
          // No method with that name had appeared in the object when the
          // inheritance at this level ocurred. Attempt to recover by pulling
          // the method directly out of self: if it appears there, then it
          // must have been defined further up the inheritance chain, so it's
          // safe to say it's a super method.
          method = context[name];
        }
      }

      if (method === undefined) {
        // Either the method didn't appear on the object at all, or there was
        // no overridden method to request.
        return rt.UnresolvedSuperRequest
          .raiseForName_inObject([rt.string(pretty)], [context]);
      }

      return [context, method];
    }).bind(this).then(null, function (packet) {
      return this.report(packet, pretty, "super", node);
    });
  }

  if (rnode.constructor === ast.Outer) {
    method = this.searchScope(name, true);

    if (method === null) {
      return rt.UnresolvedRequest.raiseForName(rt.string(pretty))
        .bind(this).then(null, function (packet) {
          return this.report(packet, pretty, "outer", node);
        });
    }

    return [null, method];
  }

  return this.expression(rnode).then(function (receiver) {
    return rt.lookup(receiver, pretty, rnode.constructor === ast.Self)
      .bind(this).then(function (foundMethod) {
        return [receiver, foundMethod];
      }, function (packet) {
        return this.report(packet, pretty, receiver, node);
      });
  });
};

Interpreter.prototype["class"] = function (node) {
  var object = rt.object();

  return this.scoped(object, function () {
    return this.method(node);
  }).then(function () {
    var def, name, string;

    name = node.name.value;
    def = this.newVar(name, object, true);
    string = rt.string(name);

    object.asString = rt.method("asString", 0, function () {
      return string;
    });

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
      var argParts, clone;

      argParts = util.slice(arguments, isInherits ? 1 : 0);

      if (signature.parts.length === 1) {
        argParts = [argParts];
      }

      // Reclone the interpreter to get a unique scope for this execution.
      clone = interpreter.clone();
      if (this !== null && this !== global && this !== clone.scope.self) {
        clone.scope.self = this;
      }

      return clone.scoped(function () {
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
              }, function (packet) {
                return this.reportNode(packet, signature.pattern)
                  .then(null, reject);
              });

              return new Task(function () {
                return;
              });
            };

            top = this.scope;
            top["return"] = exit;
            top.method = method;

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

  for (i = 0, l = signature.parts.length; i < l; i += 1) {
    part = signature.parts[i];
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

    parts.push([
      part.generics.length,
      hasVarArg ? rt.gte(params.length - 1) : params.length
    ]);
  }

  return this.resolve(parts);
};

// Handle the joining of a method and a request by adding generics, evaluating
// patterns, and adding parameters, then producing the return pattern.
Interpreter.prototype.parts = function (msig, rsig, node) {
  return this.each(msig.parts, rsig, function (mpart, rpart) {
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
        return this.args(names, patterns, args, node);
      });
    });
  });
};

// Evaluate a method part's patterns in the scope of its generic arguments.
Interpreter.prototype.patterns = function (parameters) {
  return this.each(parameters, function (parameter) {
    var name = parameter.name.value;

    return this.pattern(parameter.pattern).then(function (pattern) {
      return rt.named(name,
        parameter.isVarArg ? rt.listOf(pattern) : pattern);
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
Interpreter.prototype.args = function (names, patterns, args, node) {
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

    while (!variable.isVariable) {
      variable = variable["super"];
    }

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
  var exprNode = node.expression;

  return this.task(function () {
    if (exprNode === null) {
      return rt.done;
    }

    return this.expression(exprNode);
  }).then(function (expression) {
    var exit = this.searchScope("return", false);

    if (exit === null) {
      return rt.InvalidReturn.raiseInsideOfObject();
    }

    return exit.call(this, expression).bind(this);
  }).then(null, function (packet) {
    return this.report(packet, "return", null, node);
  });
};

Interpreter.prototype.inherits = function (node) {
  var context, sup;

  context = this.self();
  sup = {};

  util.forProperties(context, function (name, method) {
    while (method["super"] !== undefined) {
      method = method["super"];
    }

    sup[name] = method;
  });

  this.scope["super"] = sup;

  return this.inheriting(node.request, context).then(function (value) {
    delete this.scope.object;
    return value;
  }, function (packet) {
    return this.report(packet, "inherits " + node.request.name(), null, node);
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
Interpreter.prototype.scoped = function (context, action) {
  if (typeof context === "function") {
    action = context;
    context = undefined;
  }

  this.push(context);
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
    return this.scope.self;
  }

  return null;
};

Interpreter.prototype.put = function (pretty, method, node) {
  var context, existing, name, sub, top;

  name = util.uglify(pretty);
  top = this.scope;

  // Because method creation happens bottom upwards, if an invalid override
  // occurs it can't be detected until the super method is evaluated. By saving
  // the node with the method, the lower, erroneous method can be reported
  // rather than the non-erroneous super method.
  method.node = node;

  return this.task(function () {
    if (util.owns(top, name)) {
      existing = top[name] && top[name].identifier || pretty;

      return rt.Redefinition.raiseForName(rt.string(existing));
    }

    context = this.self();
    if (context === null) {
      top[name] = method;
    } else if (context[name] !== undefined) {
      if (util.owns(context, name)) {
        sub = context[name];
      } else {
        sub = method;
        method = context[name];
        context[name] = sub;
      }

      if (method.isStatic) {
        node = sub.node;
        return rt.InvalidMethod.raiseStaticOverrideForName(rt.string(pretty));
      }

      if (sub.isVariable) {
        node = sub.node;
        return rt.InvalidMethod
          .raiseOverridingVariableForName(rt.string(pretty));
      }

      while (util.owns(sub, "super")) {
        sub = sub["super"];
      }

      if (!rt.isSubMethod(sub.parts, method.parts)) {
        node = sub.node;
        return rt.InvalidMethod
          .raiseMismatchedParametersForName(rt.string(pretty));
      }

      sub["super"] = method;
    } else {
      context[name] = method;
    }

    top[name] = method;
  }).bind(this).then(null, function (packet) {
    return this.reportNode(packet, node);
  });
};

Interpreter.prototype.push = function (context) {
  var frame = {};

  if (context !== undefined) {
    frame.self = context;
  }

  frame.outer = this.scope;
  this.scope = frame;
};

Interpreter.prototype.pop = function () {
  this.scope = this.scope.outer;
};

// Search for a value with the given name on self or in scope.
Interpreter.prototype.search = function (name) {
  var context, frame;

  function pair(method) {
    return [context, method];
  }

  for (frame = this.scope; frame !== null; frame = frame.outer) {
    if (util.owns(frame, "self")) {
      context = frame.self;

      if (context[name] !== undefined) {
        return rt.lookup(context, name, true).bind(this).then(pair);
      }
    }

    if (util.owns(frame, name)) {
      return this.resolve([null, frame[name]]);
    }
  }

  return this.resolve(null);
};

// Find definitions stored in scope without searching through self. Takes an
// optional boolean where false indicates that the search should stop once
// it encounters a self value, and true indicates that the search should begin
// after the first self value.
Interpreter.prototype.searchScope = function (name, passSelf) {
  var frame;

  for (frame = this.scope; frame !== null; frame = frame.outer) {
    if (!passSelf && util.owns(frame, name)) {
      return frame[name];
    }

    if (util.owns(frame, "self")) {
      if (frame.outer === null && frame.self[name] !== undefined) {
        return frame.self[name];
      }

      if (passSelf === false) {
        return null;
      }

      if (passSelf === true) {
        passSelf = undefined;
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
  return this.resolve(null).then(function () {
    return action.call(this);
  });
};

Interpreter.prototype.raise = function (message) {
  return rt.InternalError.raise(rt.string(message)).bind(this);
};

Interpreter.prototype.report = function (packet, name, object, node) {
  return this.task(function () {
    return rt.handleInternalError(packet);
  }).then(null, function (internalError) {
    internalError.object.stackTrace.push(rt.trace(name, object, {
      "module": this.modulePath || null,
      "line": node.location.line,
      "column": node.location.column
    }));

    throw internalError;
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
