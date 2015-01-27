try {
  object {
    def name = type {}

    let Name = name
  }
} catch { error : IncompleteObject -> error}
