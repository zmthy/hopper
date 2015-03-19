dialect "branded"

let aThing = brand
let Thing = aThing.Type

// Valid: the object is branded aThing.
def thing : Thing = object is aThing {}
