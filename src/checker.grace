// A dialect for writing other checking dialects.
//
// Dialects written in this dialect should inherit from the 'checker'
// constructor. The inheriting object can define a set of rules against AST node
// patterns, either raising a Checker Failure exception to indicate an issue
// with the checked code, or returning an object to represent the static type of
// the node if it is an expression. For instance:
//
//     rule { cls : Class ->
//       CheckFailure.raise "No classes allowed" forNode(cls)
//     }
//
// The dialect provides a mechanism for retrieving the type information
// processed by the rules for values in the current scope with the 'scope'
// identifier.
//
// The rule checking should be invoked from the implementing dialects 'check'
// method, by requesting the 'check' method on the underlying checker object. If
// an implementing dialect inherits directly from 'checker', then this is
// already set up, otherwise the dialect method will presumably defer to a
// default instance of a checker, such as in:
//
//     dialect "checker"
//
//     constructor myChecker {
//       inherits checker
//       …
//     }
//
//     method check(nodes : List<Node>) -> Done {
//       myChecker.check(nodes)
//     }
//
// Arranging dialects like this allows implementing dialects to be extended in
// the same way as this dialect, while also fulfilling the role of a checker
// dialect itself (which this dialect does not).

// Re-export the prelude, as well as the various AST node types.
inherits delegateTo(prelude, Node)

// A rule is a partial procedure which accepts at least a Node and may raise a
// Checker Failure. A rule may return an arbitrary object, which will be
// interpreted as the static type representation of an object.
let Rule = Function<Node, Object>

constructor checker {

  // The defined type rules, to be modified by an implementing module.
  def rules is confidential = mutableList.empty<Rule>

  // A cache of static type assignments to nodes.
  def cache is confidential = mutableDictionary.empty<Expression, Object>

  // The primary interface for using this dialect, requesting this method adds a
  // new typing rule for the implementing dialect. The argument will only be
  // applied to nodes that it matches, and the results of the rules will be stored
  // and made available in the future.
  method rule(proc : Rule) -> Done {
    rules.add(proc)
  }

  // Stack of mappings from identifier to type.
  class scopeStack.new is confidential {
    // Internal representation of the stack as a list of dictionaries.
    def definitions = mutableList.empty<MutableDictionary<String, Object>>

    reset

    // The number of frames currently on the stack.
    method size -> Number {
      definitions.size
    }

    // Clear everything in scope, starting fresh. This is used to clear out the
    // scope after an execution of the rules, and should probably not be used
    // during checking.
    method reset -> Done {
      while { !definitions.isEmpty } do {
        definitions.removeAt(1)
      }

      definitions.add(mutableDictionary.empty<String, Object>)
    }

    // Retrieve the closest local scope.
    method local -> Dictionary<String, Object> {
      definitions.last
    }

    // Retrieve the type assignments at a given point in the stack.
    method at(index : Number) -> Dictionary<String, Object> {
      definitions.at(index).asImmutable
    }

    // Insert a value into the dictionary at the top of the stack.
    method at(name : String) put(value : Object) -> Done {
      definitions.last.at(name) put(value)
    }

    // Lookup a name throughout the stack.
    method find(name : String) ifAbsent(onAbsent : Action) -> Object {
      var i : Number := definitions.size

      while { i > 0 } do {
        definitions.at(i).at(name) do { value ->
          return value
        }

        i := i - 1
      }

      onAbsent.apply
    }

    // Enter a new scope, run an action in that scope, and then pop the scope
    // afterwards.
    method enter(action : Action) {
      definitions.add(mutableDictionary.empty)

      def result = action.apply

      definitions.removeAt(definitions.size)

      result
    }

    method asString -> String {
      "scope({size})"
    }
  }

  // The current scope for the implementing dialect.
  def scope is public = scopeStack.new

  // Check the given node and return the resulting type. If the node has already
  // been checked, the cached result will be returned instead.
  method typeOf(expr : Expression) -> Object {
    runRules(expr)
    cache.at(expr) do { value -> return value }

    LogicError.raise "No rule assigns a type to the node «{expr}»"
  }

  def ruleVisitor = object {
    inherits visitor.base

    method visitNode(node : Node) -> Boolean {
      cache.at(node) do { _ -> return false }

      for (rules) do { rule ->
        def matched = rule.match(node)

        if (Expression.match(node) && matched) then {
          cache.at(node) put(matched.value)
        }
      }

      true
    }
  }

  // Run the set of rules on the given node, caching the result.
  method runRules(node : Node) -> Done {
    node.accept(ruleVisitor)
    done
  }

  // Checks the defined rules on the given AST.
  //
  // If a dialect inherits from the 'checker' constructor, then this will
  // automatically set up the dialect as a checker.
  method check(nodes : List<Node>) -> Done {
    for (nodes) do { node : Node ->
      runRules(node)
    }

    scope.reset
  }
}
