dialect "branded"

let aThing = brand
let Thing = aThing.Type & type {
  foo
  bar
}

// Invalid: the object is not branded aThing.
def thing : Thing = object {
  method foo {}
  method bar {}
}
