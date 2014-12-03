method first(ignore) second(param) {
  param.name
}

first(object {}) second(object {
  method name { self }
}).name
