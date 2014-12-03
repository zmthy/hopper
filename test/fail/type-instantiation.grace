type A = {}
type B = A.match(object {}).andAlso { type {} }
