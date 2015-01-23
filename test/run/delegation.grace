def above = object {
  method run {}
}

object {
  inherits delegateTo(above)

  run
}
