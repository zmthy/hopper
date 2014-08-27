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

method for<T>(doable : Do<T>) do(f : Event<T>) -> Done {
  doable.do(f)
}

