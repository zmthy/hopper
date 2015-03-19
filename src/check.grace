dialect "branded"

let anA = brand
let A = anA.Type

// Invalid: the object is not branded anA.
def a : A = object is anA {}

//class a.new -> A is anA {}
//class b.new -> A {}

//def a : A = object is anA {}
//def b : A = object {}

//let aB = anA.extend
//let B = aB.Type

//def a : A = object is aB {}
//def b : B = object is aB {}
//def c : B = object is anA {}
//def d : B = object {}

//let aC = brand
//let aD = anA + aC
//let D = aD.Type

//def a : D = object {}
//def b : D = object is anA {}
//def c : D = object is aC {}
//def d : D = object is aD {}
//def e : D = object is anA, aC {}

//method go(aB : Brand) {
  //let B = aB.Type
  //def b : B = object is aB {}
  ////def c : aB.Type = object {}
//}

//go(brand)

//let o = object {
  //let anA = brand
  //let A = anA.Type
  //def a : A is public = object is anA {}
//}

//def b : o.A = object {}

// let anA = brand
// let aB = brand
// let aC = anA + aB

// let A = anA.Type
// let B = aB.Type
// let C = aC.Type

// def a : B = object is aC { }
