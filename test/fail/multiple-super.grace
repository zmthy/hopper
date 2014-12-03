constructor first {
  method name {
    fail
  }
}

constructor second {
  inherits first

  method name {
    super.name
  }
}

object {
  inherits second

  method name {
    super.name
  }

  name
}
