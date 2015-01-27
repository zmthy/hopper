let First<T> = type {
  name -> Second<T>
}

let Second<T> = type {
  name -> First<T>
}
