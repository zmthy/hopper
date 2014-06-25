class new {
  method first {}
  method second {}
}

object {
  inherits new

  method first {
    super.second
  }

  first
}

