dialect "branded"

let oneThing = brand
let OneThing = oneThing.Type

let otherThing = brand
let OtherThing = otherThing.Type

let bothThings = oneThing + otherThing
let BothThings = bothThings.Type

// Valid: the object is branded bothThings.
def thing : OtherThing = object is bothThings {}
