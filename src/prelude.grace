method asString -> String {
  "prelude"
}

// This has to be a method to account for delegation.
method prelude {
  self
}

method unless(cond : Boolean) then(then : Action) -> Done {
  cond.orElse(then)
  done
}

method unless(cond : Boolean)
    then<T>(then : Action<T>) else<U>(else : Action<U>) -> T | U {
  cond.andAlso(else) orElse(then)
}

method until(cond : Action<Boolean>) do(action : Action) -> Done {
  while { !cond.apply } do(action)
}

method for<T>(in : Do<T>) do(f : Procedure<T>) -> Done {
  in.do(f)
}

type ExceptionPattern = {
  parent -> ExceptionPattern

  refine(name : String) -> ExceptionPattern
  refine(name : String) defaultMessage(message : String) -> ExceptionPattern

  raise(message : String) -> Nothing
  raiseDefault -> Nothing
}

def EnvironmentException : ExceptionPattern =
  Exception.refine("Environment Exception")

def ResourceException : ExceptionPattern =
  Exception.refine("Resource Exception")

def SubobjectResponsibility : ExceptionPattern = object {
  inherits LogicError.refine("Subobject Responsibility")

  method raiseForMethod(name : String) -> Nothing {
    raise "A subobject should have overridden the method «{name}»"
  }
}

