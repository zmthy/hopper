dialect "branded"

method test(aThing : Brand) {
  let Thing = aThing.Type

  // Invalid: The object is not branded aThing.
  def thing : Thing = object {}
}
