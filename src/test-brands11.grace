dialect "branded"

let aThing = brand
let Thing = aThing.Type

// Invalid: the class is not branded aThing.
class thing.new -> Thing {}

def myThing : Thing = thing.new
