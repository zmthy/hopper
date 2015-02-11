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

def EnvironmentException : ExceptionPattern is public =
  Exception.refine("Environment Exception")

def ResourceException : ExceptionPattern is public =
  Exception.refine("Resource Exception")

def SubobjectResponsibility : ExceptionPattern is public = object {
  inherits LogicError.refine("Subobject Responsibility")

  method raiseForMethod(name : String) -> None {
    raise "A subobject should have overridden the method «{name}»"
  }
}

type MutableList<T> = List<T> & type {
  // Insert an element at the given index, overwriting and returning the element
  // at that position.
  // Raises an Out Of Bounds if the index is not within the bounds of the list.
  at(index : Number) put(element : T) -> T

  // Add an element to the end of the list.
  // Raises an Out Of Bounds if the index is not within the bounds of the list.
  add(element : T) -> Done

  // Remove and return the element at the given index.
  removeAt(index : Number) -> T

  // Remove the given element, returning the index where it was found.
  // Returns the result of the given action if the element is not present.
  remove(element : T) ifAbsent<U>(action : Action<U>) -> Number | U

  // Remove the given element, returning the index where it was found.
  // Raises a Failed Search if the element is not present.
  remove(element : T) -> Number
}

def mutableList is public = object {
  inherits delegateTo(list)

  constructor withAll<T>(elements : Do<T>) -> MutableList<T> {
    inherits list.withAll<T>(elements)

    method boundsCheck(index : Number) -> Done is confidential {
      if ((index < 1) || (index > size)) then {
        OutOfBounds.raiseForIndex(index)
      }
    }

    method at(index : Number) put(element : T) -> T {
      boundsCheck(index)
      internalSplice(index - 1, 1, element)
    }

    method add(element : T) -> Done {
      internalPush(element)
    }

    method removeAt(index : Number) -> T {
      boundsCheck(index)
      internalSplice(index - 1, 1)
    }

    method remove(element : T) ifAbsent<U>(action : Action<U>) -> Number | U {
      internalRemove(element, action)
    }

    method remove(element : T) -> Number {
      remove(element) ifAbsent<None> {
        FailedSearch.raiseForObject(element)
      }
    }

    method asImmutable -> List<T> {
      list.withAll(self)
    }
  }

  method asString -> String {
    "mutableList"
  }
}


type Set<T> = Collection<T> & type {
  // Produce the concatenation of this set with another, without modifying
  // either set.
  ++(set : Set<T>) -> Set<T>

  // Produce an immutable representation of the current state of this set.
  asImmutable -> Set<T>
}

type MutableSet<T> = Set<T> & type {
  // Add an element to the set.
  add(element : T) -> Done

  // Remove the given element. Applies the given action if the element is not
  // present.
  remove(element : T) ifAbsent(action : Action) -> Done

  // Remove the given element. Raises a Failed Search if the element is not
  // present.
  remove(element : T) -> Done
}

def mutableSet is public = object {
  inherits delegateTo(set)

  constructor withAll<T>(elements : Do<T>) -> MutableSet<T> {
    inherits set.withAll<T>(elements)

    method add(element : T) -> Done {
      internalPush(element)
    }

    method remove(element : T) ifAbsent(action : Action) -> Done {
      internalRemove(element, action)
      done
    }

    method remove(element : T) -> Done {
      remove(element) ifAbsent {
        FailedSearch.raiseForObject(element)
      }
    }

    method asImmutable -> Set<T> {
      set.withAll(self)
    }
  }

  method asString -> String {
    "mutableSet"
  }
}

class entry.key<K>(key' : K) value<V>(value' : V) -> Entry<K, V> {
  def key : K is public = key'
  def value : V is public = value'

  method ==(other : Object) -> Boolean {
    match (other)
      case { anEntry : Entry<K, V> ->
        (key == anEntry.key).andAlso {
          value == anEntry.value
        }
      }
      case { _ -> false }
  }

  method asString -> String {
    "{key.asString} => {value.asString}"
  }
}

type Dictionary<K, V> = Set<Entry<K, V>> & type {
  // Whether the dictionary contains the given key.
  containsKey(key : K) -> Boolean

  // Whether the dictionary contains the given value.
  containsValue(value : V) -> Boolean

  // Produce an immutable representation of the current state of this
  // dictionary.
  asImmutable -> Dictionary<K, V>
}

type MutableDictionary<K, V> = Dictionary<K, V> & type {
  // Add a value at the given key into the dictionary.
  // Replaces the existing entry if the key is already present.
  at(key : K) put(value : V) -> Done

  // Add an entry into the dictionary.
  // Replaces the existing entry if the key is already present.
  add(entry : Entry<K, V>) -> Done

  // Remove and return the value at the given key.
  // Returns the result of the given action if the key is not present.
  removeAt(key : K) ifAbsent<T>(action : Action<T>) -> V | T

  // Remove and return the value at the given key.
  // Raises a Failed Search if the key is not present.
  removeAt(key : K) -> V

  // Remove the given entry.
  // Runs the given action if the entry is not present.
  remove(element : Entry<K, V>) ifAbsent(action : Action) -> Done

  // Remove the given entry.
  // Raises a Failed Search if the entry is not present.
  remove(element : Entry<K, V>) -> Done
}

def mutableDictionary is public = object {
  inherits delegateTo(dictionary)

  constructor withAll<K, V>(elements : Do<Entry<K, V>>)
      -> MutableDictionary<K, V> {
    inherits dictionary.withAll<K, V>(elements)

    method at(key : K) put(value : V) -> Done {
      internalPush(entry.key(key) value(value))
    }

    method add(entry : Entry<K, V>) -> Done {
      internalPush(entry)
    }

    method removeAt(key : K) ifAbsent<T>(action : Action<T>) -> V | T {
      internalRemoveAt(key, action)
    }

    method removeAt(key : K) -> V {
      removeAt(key) ifAbsent {
        FailedSearch.raiseForObject(key)
      }
    }

    method remove(entry : Entry<K, V>) ifAbsent(action : Action) -> Done {
      internalRemove(entry, action)
      done
    }

    method remove(entry : Entry<K, V>) -> Done {
      remove(entry) ifAbsent {
        FailedSearch.raiseForObject(entry)
      }

      done
    }

    method asImmutable -> Dictionary<K, V> {
      dictionary.withAll(self)
    }
  }

  method asString -> String {
    "mutableDictionary"
  }
}

def … : Unknown = object {
  method … {
    self
  }

  method asString -> String {
    "…"
  }
}
