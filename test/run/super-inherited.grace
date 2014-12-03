constructor first {
  method name {}
}

constructor second {
  inherits first

  method name {
    Exception.raiseDefault
  }

  super.name
}

object {
  inherits second

  method name {
    Exception.raiseDefault
  }
}
