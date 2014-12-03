constructor new {
  method name(param) {}
}

object {
  inherits new

  method name(param) {
    super.name(param)
  }

  name(object {})
}
