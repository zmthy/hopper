try {
  object {
    def name = type {}

    type Name = name
  }
} catch { error : UndefinedValue -> error}

