constructor upper {
  method prefix!! {}
}

!!object {
  inherits upper

  method prefix!! {
    !!super
  }
}
