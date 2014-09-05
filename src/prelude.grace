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

  raise(message : String) -> None
  raiseDefault -> None
}

def EnvironmentException : ExceptionPattern =
  Exception.refine("Environment Exception")

def ResourceException : ExceptionPattern =
  Exception.refine("Resource Exception")

def SubobjectResponsibility : ExceptionPattern = object {
  inherits LogicError.refine("Subobject Responsibility")

  method raiseForMethod(name : String) -> None {
    raise "A subobject should have overridden the method «{name}»"
  }
}

type List<T> = Sequence<T> & type {
  // Insert an element at the given index, overwriting and returning the element
  // at that position.
  // Raises an Out Of Bounds if the index is not within the bounds of the list.
  at(index : Number) put(element : T) -> T

  // Add an element to the end of the list.
  add(element : T) -> Done

  // Remove the given element, returning the index where it was found.
  // Returns the result of the given action if the element is not present.
  remove(element : T) ifAbsent<U>(action : Action<U>) -> Number | U

  // Remove the given element, returning the index where it was found.
  // Raises a Failed Search if the element is not present.
  remove(element : T) -> Number
}

def list = object {
  inherits delegateTo(sequence)

  constructor withAll<T>(elements : Sequence<T>) -> List<T> {
    inherits sequence.withAll<T>(elements)

    method at(index : Number) put(element : T) -> T {
      if ((index < 1) || (index > size)) then {
        OutOfBounds.raiseForIndex(index)
      }

      internalSplice(index - 1, 1, element)
    }

    method add(element : T) -> Done {
      internalPush(element)
    }

    method remove(element : T) ifAbsent<U>(action : Action<U>) -> Number | U {
      for (indices) do { i ->
        if (at(i) == element) then {
          internalSplice(i - 1, 1)
          return i
        }
      }

      action.apply
    }

    method remove(element : T) -> Number {
      remove(element) ifAbsent<None> {
        FailedSearch.raiseForObject(element)
      }
    }

    method asString -> String {
      if (size == 0) then {
        "[]"
      } else {
        "[{sliceFrom(2).fold { s, e ->
          "{s}, {e.asString}"
        } startingWith(at(1).asString)}]"
      }
    }
  }

  method asString -> String {
    "list"
  }
}

