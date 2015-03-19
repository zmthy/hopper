dialect "branded"

let oneThing = brand
let OneThing = oneThing.Type

let otherThing = brand
let OtherThing = otherThing.Type

let bothThings = oneThing + otherThing
let BothThings = bothThings.Type

// Valid: the object is branded as both oneThing and otherThing.
def thing : BothThings = object is oneThing, bothThings {}
