try {
  object {
    def name = type {}

    type Name = name
  }
} catch { error : IncompleteObject -> error}
