constructor new {
  method name {}
}

object {
  inherits new

  method name {
    object {
      super.name
    }
  }

  name
}
