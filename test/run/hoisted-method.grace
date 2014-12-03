try {
  object {
    method name { type {} }

    type Name = name
  }
} catch { error : IncompleteObject -> error }
