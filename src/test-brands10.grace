dialect "branded"

method test(aThing : Brand) {
  let Thing = aThing.Type

  // Valid: The object is branded aThing.
  def thing : Thing = object is aThing {}
}
