dialect "branded"

let anA = brand

// def a : anA.Type = object is anA {}
// def b : anA.Type = object {}

// let aB = anA.extend

// def b : aB.Type = object is aB {}
// def c : aB.Type = object is anA {}
// def d : aB.Type = object {}

let aC = brand
let aD = anA + aC

def a : aD.Type = object is anA, aC {}

// method go(b : Brand) {
//   def c : b.Type = object is b {}
// }

// let anA = brand
// let aB = brand
// let aC = anA + aB

// let A = anA.Type
// let B = aB.Type
// let C = aC.Type

// def a : B = object is aC { }
