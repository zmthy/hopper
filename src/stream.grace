// The interface of simple, potentially infinite streams. Streams may or may not
// be consumed by their use.
type Stream<T> = type {
  // Perform an action for each value in the stream.
  doForEach(onValue : Action<T>) -> Done

  // Fold the values in the stream together with an accumulating value, starting
  // at the given value.
  foldWith<U>(onValue : Function2<T, U, U>) startingAt(initial : U) -> U

  // Whether this stream has been exahusted of values. Reusable streams should
  // always return true.
  isExhausted -> Boolean
}

// An abstract implementation of the Stream interface. Requires the
// implementation of the do() and isExhausted methods.
class abstract -> Stream<T> {
  method foldWith<U>(onValue : Function2<T, U, U>)
         startingAt(initial : U)
         -> U {
    var accumulator := initial

    each { value ->
      accumulator := onValue.apply(value, accumulator)
    }

    return accumulator
  }
}
