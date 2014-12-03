def name = object {
  method *(rhs) { self }
}

def drop = object {
  method +(rhs) {}
}

drop + name * name
