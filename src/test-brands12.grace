dialect "branded"

let aThing = brand
let Thing = aThing.Type

// Valid: the class is branded aThing.
class thing.new -> Thing is aThing {}

def myThing : Thing = thing.new
