constructor new {
  method first(first) second(second) {}
}

object {
  inherits new

  method first(first) second(second) {
    super.first(first) second(second)
  }

  first(object {}) second(object {})
}
