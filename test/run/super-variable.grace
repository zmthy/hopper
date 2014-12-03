constructor new {
  def name = object {}
}

object {
  inherits new

  method name {
    super.name
  }

  name
}
