try {
  def a = object {
    a
  }
} catch { error : UndefinedValue -> error }
