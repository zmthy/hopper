constructor first {
  method name {}
}

constructor second {
  inherits first

  super.name
}

constructor third {
  inherits second

  method name {
    Exception.raiseDefault
  }
}

object {
  inherits third

  method name {
    Exception.raiseDefault
  }
}
