method name {}

object {
  method name {
    Exception.raiseDefault
  }

  method test {
    outer.name
  }

  test
}
