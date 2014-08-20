method asString -> String {
  "prelude"
}

// This has to be a method to account for delegation.
method prelude {
  self
}

method if(cond : Boolean) then(then : Action) -> Done {
  cond.andAlso(then)
  done
}

method unless(cond : Boolean) then(then : Action) -> Done {
  cond.orElse(then)
  done
}

method if(cond : Boolean)
    then<T>(then : Action<T>) else<U>(else : Action<U>) -> T | U {
  cond.andAlso(then) orElse(else)
}

method unless(cond : Boolean)
    then<T>(then : Action<T>) else<U>(else : Action<U>) -> T | U {
  cond.andAlso(else) orElse(then)
}

method if(cond : Boolean) then<T>(then : Action<T>)
    elseif(cond' : Action<Boolean>) then<U>(then' : Action<U>)
    else<V>(else : Action<V>) -> T | U | V {
  cond.andAlso(then) orElse {
    cond'.apply.andAlso(then') orElse(else)
  }
}

method if(cond : Boolean) then(then : Action)
    elseif(cond' : Action<Boolean>) then(then' : Action) -> Done {
  cond.andAlso(then) orElse {
    cond'.apply.andAlso(then')
  }

  done
}

method if(cond : Boolean) then(then : Action)
    elseif(cond' : Action<Boolean>) then(then' : Action)
    elseif(cond'' : Action<Boolean>) then(then'' : Action) -> Done {
  cond.andAlso(then) orElse {
    cond'.apply.andAlso(then') orElse {
      cond''.apply.andAlso(then'')
    }
  }

  done
}

method until(cond : Action<Boolean>) do(action : Action) -> Done {
  while { !cond.apply } do(action)
}

method for<T>(doable : Do<T>) do(f : Function<T, Object>) -> Done {
  doable.do(f)
}

def MatchFailure is public = object {
  inherits Exception.refine("Match Failure")

  method raiseForObject(value) {
    self.raise "Failed to match against object {value}"
  }
}

method match(value : Object) case(case : Function<Object, Object>) -> Object {
  def match = case.match(value)

  match.andAlso {
    match.result
  } orElse {
    MatchFailure.raiseForObject(value)
  }
}

method match(value : Object)
    case(case : Function<Object, Object>)
    case(case2 : Function<Object, Object>) -> Object {
  def match = case.match(value)

  match.andAlso {
    match.result
  } orElse {
    match(value) case(case2)
  }
}

method match(value : Object)
    case(case : Function<Object, Object>)
    case(case2 : Function<Object, Object>)
    case(case3 : Function<Object, Object>) -> Object {
  def match = case.match(value)

  match.andAlso {
    match.result
  } orElse {
    match(value) case(case2) case(case3)
  }
}

method match(value : Object)
    case(case : Function<Object, Object>)
    case(case2 : Function<Object, Object>)
    case(case3 : Function<Object, Object>)
    case(case4 : Function<Object, Object>) -> Object {
  def match = case.match(value)

  match.andAlso {
    match.result
  } orElse {
    match(value) case(case2) case(case3) case(case4)
  }
}

method try(action : Action) finally(finally : Action) -> Done {
  try(action) catch { packet ->
    finally.apply
    packet.raise
  }

  finally.apply
  done
}

method try(action : Action)
    catch(case : Function) finally(finally : Action) -> Done {
  try(action) catch { packet ->
    case.match(packet).orElse {
      finally.apply
      packet.raise
    }
  }

  finally.apply
  done
}

method try(action : Action)
    catch(case : Function)
    catch(case2 : Function) -> Done {
  try(action) catch { packet ->
    case.match(packet).orElse {
      case2.match(packet)
    }.orElse {
      packet.raise
    }
  }

  done
}

method try(action : Action)
    catch(case : Function)
    catch(case2 : Function)
    catch(case3 : Function) -> Done {
  try(action) catch { packet ->
    case.match(packet).orElse {
      case2.match(packet)
    }.orElse {
      case3.match(packet)
    }.orElse {
      packet.raise
    }
  }

  done
}

