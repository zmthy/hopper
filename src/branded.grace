// Defines the typing rules for brand-typed modules.

dialect "checker"

import "typed" as typed

inherits delegateTo(standardPrelude)

let NameError = CheckerFailure.refine "Name Error"
let BrandError = typed.TypeError.refine "Brand Error"

// The PreBrand type is the structural type of a brand object.
let PreBrand is confidential = ObjectAnnotator & type {
  Type -> Pattern
}

// All but one pre-brand should be created by inheritance from the brand
// constructor below. The pre-brand class is necessary to generate a brand-like
// object which will tag true brand objects.
class preBrand.new -> PreBrand is confidential {

  // This is required for access to the outer object inside the Type.
  def this = self

  // When used as an annotation, the pre-brand object tags the metadata of the
  // object with itself.
  method annotateObject(obj : Object) {
    mirrors.reflect(obj).metadata.add(this)
  }

  let Type = object {
    inherits pattern.abstract

    method match(obj : Object) {
      // The metadata property on an object mirror is a weak set, which ensures
      // that the tag cannot be exposed to other users.
      mirrors.reflect(obj).metadata.has(this)
    }
  }

  method asString -> String {
    "brand"
  }
}

// This is the only concrete pre-brand, as it cannot brand itself.
let aBrand is confidential = preBrand.new

// The final brand type includes the brand type and structural information.
let Brand = aBrand.Type & PreBrand

// The brand constructor, which just tags brands as aBrand.
method brand -> Brand {
  object is aBrand {
    inherits preBrand.new
  }
}

constructor brandChecker {
  inherits typed.typeChecker

  let BrandRequest = object {
    inherits delegateTo(UnqualifiedRequest)

    method match(obj : Object) {
      match (obj)
        case { req : UnqualifiedRequest -> req.name == "brand" }
        case { _ -> false }
    }
  }

  // A brand type is an ObjectType with no inherent methods and is only a
  // subtype of itself.
  class brandType.new -> ObjectType {
    inherits objectType.fromMethods(set.empty<MethodType>)

    method isSubtypeOf(oType : ObjectType) -> Boolean {
      self == oType
    }

    method asString -> String {
      "Anonymous"
    }
  }

  // Family polymorphism is a little difficult.
  method superObjectType {
    super.objectType
  }

  // We override the objectType class, adding in a case for generating object
  // types from expressions.
  def objectType is public = object {
    inherits delegateTo(superObjectType)

    method fromExpression(expression : Expression) -> ObjectType {
      match (expression)
        case { req : BrandRequest -> brandType.new }
        case { _ -> superObjectType.fromExpression(expression) }
    }
  }

  // We need to be sure that a request to 'brand' really is the one provided by
  // this dialect. We *could* check the nodes in scope withough brand creation,
  // but it's significantly easier to just treat 'brand' as a keyword.

  rule { decl : Def | Var | Let | Class | SignaturePart ->
    if (decl.name.value == "brand") then {
      NameError.raise "'brand' is a keyword" forNode(decl.name)
    }
  }

  rule { decl : Let | SignaturePart ->
    for (decl.generics) do { generic ->
      if (generic.value == "brand") then {
        NameError.raise "'brand' is a keyword" forNode(generic)
      }
    }
  }

  rule { parameter : Parameter ->
    if (parameter.name.value == "brand") then {
      NameError.raise "'brand' is a keyword" forNode(parameter.name)
    }
  }

  method check(nodes : List<Node>) inDialect(dia : Object) -> Done {
    mirrors.reflect(dia).insertInto(scope.local) withUnknown(objectType.unknown)

    // The object-type for brands.
    def theBrandType = object {
        inherits delegateTo(brandType.new &
          objectType.fromMethods(list.with(methodType.field("Type")
            ofType(objectType.pattern))))

        method asString -> String {
          "Brand"
        }
      }

    // The mirror currently doesn't include type information, so we do this one
    // manually.
    scope.at("brand") put(methodType.field("brand") ofType(theBrandType))

    check(nodes)
  }
}

def defaultBrandChecker = brandChecker

method check(nodes : List<Node>) -> Done {
  defaultBrandChecker.check(nodes) inDialect(self)
}
