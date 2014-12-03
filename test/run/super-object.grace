constructor new {
  method name {}
}

object {
  inherits new

  method name {
    Exception.raiseDefault
  }

  super.name
}
