constructor new {
  method name {
    fail
  }
}

object {
  inherits new

  method name {
    super.name
  }

  name
}
