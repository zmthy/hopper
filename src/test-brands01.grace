dialect "branded"

let aThing = brand
let Thing = aThing.Type

// Invalid: the object is not branded aThing.
def thing : Thing = object {}
