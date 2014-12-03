constructor new {
  method name {}
}

object {
  inherits new

  method name {
    super.name
  }

  name
}
