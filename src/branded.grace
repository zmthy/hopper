import "typed" as typed

inherits delegateTo(standardPrelude)

constructor brandChecker {
  inherits typed.typeChecker
}

def defaultBrandChecker = brandChecker

method check(nodes : List<Node>) -> Done {
  defaultBrandChecker.check(nodes) inDialect(self)
}
