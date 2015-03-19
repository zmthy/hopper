dialect "branded"

let aThing = brand
let Thing = aThing.Type

let aSpecificThing = aThing.extend
let SpecificThing = aSpecificThing.Type

// Invalid: the object is not branded aSpecificThing.
def thing : SpecificThing = object is aThing {}
