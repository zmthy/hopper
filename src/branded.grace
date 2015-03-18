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
class preBrand.new -> PreBrand is confidential, renamed {

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

    method asString -> String {
      "{this.asString}.Type"
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

  // We use brands to identify brand types.
  let aBrandType = brand
  let BrandType = aBrandType.Type

  let aBrandTypeType = brand
  let BrandTypeType = aBrandTypeType.Type

  // Note the dynamic use of a brand pattern here.
  class tagged.withType(BType : Pattern) -> ObjectType {
    inherits objectType.base

    // There's some identity issues with delegation, so we use the object
    // identity of a tag to identify this type statically.
    let tag = object {}

    method hasSameTag(oType : ObjectType) -> Boolean {
      match (oType)
        case { bt : BType -> tag == bt.tag }
        case { _ -> false }
    }

    method isSubtypeOf(oType : ObjectType) -> Boolean {
      // As in the structural types, it's important that the argument have a say
      // in this relationship.
      oType.isSupertypeOf(self).orElse {
        hasSameTag(oType)
      }
    }

    method isSupertypeOf(oType : ObjectType) -> Boolean {
      hasSameTag(oType)
    }
  }

  // A brand type-type is an ObjectType with no inherent methods and is only a
  // subtype of itself.
  class brandTypeType.forBrand(brand) -> ObjectType is aBrandTypeType {
    inherits tagged.withType(BrandTypeType)

    def methods is public = set.empty<MethodType>

    method asString -> String {
      "{brand}.Type"
    }
  }

  // A brand type is an ObjectType which contains a unique brand type-type.
  class brandType.new -> ObjectType is aBrandType {
    inherits tagged.withType(BrandType)

    var name : String is public := "Brand"

    def bType = brandTypeType.forBrand(self)
    def mType = methodType.typeDeclaration("Type") of(bType)

    def methods is public = set.with<MethodType>(mType)

    let Type = bType

    method asString -> String {
      name
    }
  }

  rule { obj : ObjectConstructor ->
    // This looks like it's recursive, but the existing rule in the structural
    // type checker has already given a rule for this object, and that type is
    // already cached.
    var oType : ObjectType := typeOf(obj)

    for (obj.annotations) do { ann ->
      def annType = typeOf(ann)

      if (BrandType.match(annType)) then {
        oType := oType & annType.Type
      }
    }

    oType
  }

  // Quick trick to name the brand types.
  rule { decl : Let ->
    def eType = typeOf(decl.value)

    if (BrandType.match(eType)) then {
      eType.name := decl.name.value
    }
  }

  method check(nodes : List<Node>) inDialect(dia : Object) -> Done {
    mirrors.reflect(dia).insertInto(scope.local) withUnknown(objectType.unknown)

    // The method-type for the brand constructor.
    def brandConstructor : MethodType = object {
      inherits methodType.field("brand") ofType(objectType.unknown)

      // A cute trick: where we would normally expect this to be a static
      // reference, every request to the return type of the method produces a
      // new brand type.
      method returnType -> ObjectType {
        brandType.new
      }

      // The price of the trick: the super asString is stateful.
      method asString -> String {
        "{signature.concatenateSeparatedBy(" ")} -> {Brand}"
      }
    }

    scope.at("brand") put(brandConstructor)

    scope.enter {
      check(nodes)
    }
  }
}

def defaultBrandChecker = brandChecker

method check(nodes : List<Node>) -> Done {
  defaultBrandChecker.check(nodes) inDialect(self)
}
