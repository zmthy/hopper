dialect "branded"

let aThing = brand
let Thing = aThing.Type & type {
  foo
  bar
}

// Valid: the object is branded aThing and satisfies the structural type.
def thing : Thing = object is aThing {
  method foo {}
  method bar {}
}
