// The interface of external, mutable, stepwise iterators.
type Iterator<T> = Stream<T> & type {
  // Advance the iterator and return the resulting element. Should raise an
  // Exhausted Iterator exception if the iterator is exhausted.
  next -> T

  // If the iterator is not exhausted, advance the iterator and run the given
  // function with the resulting element. If the iterator is exhausted, run
  // the given action if it is provided.
  doForNext<U>(onNext : Function<T, U>)
    ?elseIfExhausted<E>(onExhausted : Action<E>) -> U | E

  // Run the given action if the iterator is exhausted.
  doIfExhausted<E>(onExhausted : Action<E>) -> Done | E
}

// An abstract implementation of the Iterator interface. Requires the
// implementation of the isExhausted method and either the next method or the
// doForNext() ?elseIfExhausted() method family.
class abstract -> Iterator<T> {
  inherits stream.abstract

  method doForEach(onValue : Action<T>) -> Done {
    loop {
      doForNext(onValue) doIfExhausted {
        return
      }
    }
  }

  method doForNext<U>(onNext : Function<T, U>)
         ?elseIfExhausted<E>(onExhausted<E>) -> U | E {
    if (isExhausted) then {
      onNext.apply(next)
    } else {
      onExhausted.apply
    }
  }

  method doIfExhausted<E>(onExhausted : Action<E>) -> Done | E {
    ifNext {} else(onExhausted)
  }

  method next -> T {
    doForNext { element ->
      element
    } doIfExhausted {
      ExhaustedIterator.raise "Requested the next element of exhausted iterator"
    }
  }
}

// An iterator which retains the element it is currently pointing at.
type CurrentIterator<T> = Iterator<T> & type {
  // The element that the iterator has currently been advanced to. Should begin
  // uninitialised, and point to the last element if the iterator has been
  // exhausted.
  current -> T
}

def cached = object {
  // Implements a caching iterator from any existing iterator object.
  class fromIterator<T>(source : Iterator<T>) -> CurrentIterator<T> {
    inherits abstract<T>

    var current : T is readable

    method isExhausted -> Boolean {
      source.isExhausted
    }

    method doForNext<U>(onNext : Function<T, U>)
           ?doIfExhausted<E>(onExhausted : Action<E>)
           -> U | E {
      source.doForNext { element ->
        current := element
        onNext.apply(element)
      } elseIfExhausted {
        onElse.do { block ->
          block.apply
        }
      }
    }
  }
}

// An iterator which permits retriving the next element without advancing.
type PeekIterator<T> = Iterator<T> & type {
  // Retrieve the next element without advancing the iterator. Should raise an
  // Exhausted Iterator exception if the iterator is exhausted.
  peek -> T

  // If the iterator is not exhausted, run the given function with the next
  // element without advancing the iterator. If the iterator is exhausted, run
  // the given action if it is provided.
  doForPeek<U>(onPeek : Function<T, U>)
    ?elseIfExhausted<E>(onExhausted : Action<E>) -> U | E

  // If the iterator is not exhausted, peek at the next element and, if the
  // given condition succeeds, advance the iterator and run the given action on
  // the element. If the condition fails, continue through the provided
  // conditions or equality tests in the order they were provided until one
  // succeeds, or run the final else action if one is provided and none of the
  // conditions succeed.
  //
  // An equality test elseIfPeekEquals(value) is essentially equivalent to
  // elseIfPeek { x -> value == x } (note the ordering), though all values are
  // evaluated at the call site.
  ifPeek(condition : Function<T, Boolean>) thenForNext(onTrue : Action<T>)
    *(elseIfPeek(condition' : Function<T, Boolean>)
        thenForNext(onTrue' : Action<T>) |
      elseIfPeekEquals(value : T) thenForNext(onEqual : Action<T>))
    ?else(onFalse : Action)
    -> Done

  // If the iterator is not exhausted, peek at the next element and, if the
  // given equality test succeeds, advance the iterator and run the given action
  // on the element. If the condition fails, continue through the provided
  // conditions or equality tests in the order they were provided until one
  // succeeds, or run the final else action if one is provided and none of the
  // conditions succeed.
  //
  // An equality test ifPeekEquals(value) or elseIfPeekEquals(value) is
  // essentially equivalent to elseIfPeek { x -> value == x } (note the
  // ordering), though all values are evaluated at the call site.
  ifPeekEquals(value : T) thenForNext(onEqual : Action<T>)
    *(elseIfPeek(condition : Function<T, Boolean>)
        thenForNext(onTrue : Action<T>) |
      elseIfPeekEquals(value' : T) thenForNext(onEqual' : Action<T>))
    ?else(onFalse : Action)
    -> Done

  // Continue to advance the iterator, performing the given action on each
  // element, until the given condition fails for an element or the iterator is
  // exhausted. The iterator will be pointing at the element before the one
  // which failed to pass the condition if a failing condition causes the method
  // to complete.
  whilePeek(condition : Function<T, Boolean>)
    ?doForNext(onNext : Action<T>)
    -> Done
}

def peek = object {
  // An abstract implementation of the PeekIterator. Requires the isExhausted
  // method, the next or doForNext() ?elseIfExhausted() methods, and the peek or
  // doForPeek() ?elseIfExhausted() methods.
  class abstract<T> -> PeekIterator<T> {
    inherits outer.abstract<T>

    method doForPeek<U>(onPeek : Function<T, U>)
           ?elseIfExhausted<E>(onExhausted : Action<E>) -> U | E {
      ifPeek(onPeek) else(onExhausted)
    }

    method peek -> T {
      ifPeek { element ->
        element
      } else {
        ExhaustedIterator.raise
          "Requested the next element of exhausted iterator"
      }
    }

    method whilePeek(condition : Function<T, Boolean>)
           ?doForNext(onNext : Procedure<T>)
           -> Done {
      loop {
        doForPeek { element ->
          if(condition.apply(element)) then {
            onNext.doFor { proc ->
              doForNext(proc)
            }
          } else {
            return
          }
        } elseIfExhausted {
          return
        }
      }
    }
  }

  // Implements a peek iterator from any existing iterator object by caching the
  // next value on a peek.
  class fromIterator<T>(source : Iterator<T>) -> PeekIterator<T> {
    inherits abstract<T>

    def fromSource = { onNext, onElse ->
      source.ifNext(onNext) else(onElse)
    }

    // Because the next element may be cached, its method of access can be
    // swapped out with a different implementation for access to the cached
    // value. By default it just asks for the next value from the iterator,
    // given that no element is cached to begin with.
    var fetchNext := fromSource

    method isExhausted -> Boolean {
      source.isExhausted
    }

    method doForNext<U>(onNext : Function<T, U>)
           ?elseIfExhausted<E>(onElse : Action<E>)
           -> U | E {
      fetchNext.apply({ element ->
        fetchNext := fromSource
        onNext.apply(element)
      }, onElse)
    }

    method ifPeek<U>(onPeek : Function<T, U>)
           else<E>(onElse : Action<E>)
           -> U | E {
      fetchNext.apply({ element ->
        if (fetchNext == fromSource) then {
          fetchNext := { onNext, _ ->
            onNext.apply(element)
          }
        }

        onPeek.apply(element)
      }, onElse)
    }
  }
}
