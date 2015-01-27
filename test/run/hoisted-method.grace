try {
  object {
    method name { type {} }

    let Name = name
  }
} catch { error : IncompleteObject -> error }
