constructor new {
  method first {}

  method second {
    Exception.raiseDefault
  }
}

object {
  inherits new

  method first {
    Exception.raiseDefault
  }

  method second {
    super.first
  }

  second
}
