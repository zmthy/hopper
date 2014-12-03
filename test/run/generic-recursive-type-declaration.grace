type First<T> = type {
  name -> Second<T>
}

type Second<T> = type {
  name -> First<T>
}
