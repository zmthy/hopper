method name(first, second) {}

def cmp = object {
  method <(rhs) { self }
  method >(rhs) { self }
}

name(cmp < cmp, cmp > (cmp))
