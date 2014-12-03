constructor new {
  method name {}
}

object {
  inherits new

  method name {
    object {
      method name {}

      super.name
    }
  }

  name
}
