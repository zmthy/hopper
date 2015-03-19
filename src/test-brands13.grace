dialect "branded"

let aThing = brand
let Thing = aThing.Type & type {
  foo
  bar
}

// Invalid: the object does not satisfy the structural type.
def thing : Thing = object is aThing {}
