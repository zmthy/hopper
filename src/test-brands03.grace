dialect "branded"

let aThing = brand
let Thing = aThing.Type

let aSpecificThing = aThing.extend
let SpecificThing = aSpecificThing.Type

// Valid: the object is branded aSpecificThing.
def thing : Thing = object is aSpecificThing {}
