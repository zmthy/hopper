dialect "branded"

let oneThing = brand
let OneThing = oneThing.Type

let otherThing = brand
let OtherThing = otherThing.Type

let bothThings = oneThing + otherThing
let BothThings = bothThings.Type

// Invalid: the object is not branded bothThings.
def thing : BothThings = object is oneThing {}
