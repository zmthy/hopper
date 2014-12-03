constructor new {
  method name {
    Exception.raiseDefault
  }
}

object {
  inherits new

  method name {}

  self.name
}
