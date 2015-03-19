dialect "branded"

// Force the static checker to forget about the brand.
def aThing : Unknown = brand
def Thing : Pattern = aThing.Type

// Raises a runtime assertion error.
def a : Thing = object {}
