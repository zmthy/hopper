// Defines the typing rules for brand-typed modules.

dialect "checker"

import "typed" as typed

inherits delegateTo(standardPrelude)

let NameError = CheckerFailure.refine "Name Error"
let BrandError = typed.TypeError.refine "Brand Error"

// The PreBrand type is the structural type of a brand object.
let PreBrand is confidential = ObjectAnnotator & type {
  Type -> Pattern
  extend -> Brand
  +(other : Brand) -> Brand
}

// All but one pre-brand should be created by inheritance from the brand
// constructor below. The pre-brand class is necessary to generate a brand-like
// object which will tag true brand objects.
class preBrand.new -> PreBrand is confidential {

  def superBrands = set.empty

  // This is required for access to the outer object inside the Type.
  def this = self

  // When used as an annotation, the pre-brand object tags the metadata of the
  // object with itself.
  method annotateObject(obj : Object) -> Done {
    mirrors.reflect(obj).metadata.add(this)
    done
  }

  // Be default there is no super brand.
  method matchSuperBrand(obj : Object) -> Boolean is confidential { false }

  let Type is unnamed = object {
    inherits pattern.abstract

    method match(obj : Object) -> Boolean {
      // The metadata property on an object mirror is a weak set, which ensures
      // that the tag cannot be exposed to other users.
      mirrors.reflect(obj).metadata.has(this).orElse {
        matchSuperBrand(obj)
      }
    }

    method asString -> String {
      "{this.asString}.Type"
    }
  }

  method extend -> Brand {
    self + brand
  }

  constructor +(other : Brand) -> Brand {
    inherits brand

    // The + operator doesn't actually construct a unique brand. Match on the
    // original receiver rather than this new object.
    def this = outer.this

    method matchSuperBrand(obj : Object) {
      other.Type.match(obj)
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

  // Take brand annotations into account when typing object constructors.
  method checkAndTypeConstructor(node : Bodied) -> ObjectType {
    var oType : ObjectType := super.checkAndTypeConstructor(node)

    for (node.annotations) do { ann ->
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

  // The static representation of the 'Brand' type above.
  def theBrandType = object {
    inherits objectType.base

    // We don't need to include the structural information, because our other
    // rules intercept this type and replace it with something more specific.
    def methods is public = set.empty<MethodType>

    method isSubtypeOf(oType : ObjectType) -> Boolean {
      oType.isSupertypeOf(self).orElse {
        self == oType
      }
    }

    method isSupertypeOf(oType : ObjectType) -> Boolean {
      (self == oType).orElse {
        BrandType.match(oType)
      }
    }

    method asString -> String {
      "Brand"
    }
  }

  method check(nodes : List<Node>) inDialect(dia : Object) -> Done {
    mirrors.reflect(dia).insertInto(scope.local) withEmpty(objectType.empty)
      unknown(objectType.unknown) pattern(objectType.pattern)

    // The method-type for the brand constructor.
    def brandConstructor : MethodType = object {
      inherits methodType.field("brand") ofType(theBrandType)

      // A cute trick: where we would normally expect this to be a static
      // reference, every request to the return type of the method produces a
      // new brand type.
      method returnType -> ObjectType {
        brandType.fresh
      }

      // The price of the trick: the super asString is stateful.
      method asString -> String {
        "{signature.concatenateSeparatedBy(" ")} -> Brand"
      }
    }

    scope.at("brand") put(brandConstructor)

    def letBrand : MethodType = object {
      inherits methodType.typeDeclaration("Brand") of(theBrandType)

      // Like the trick above, but this time when the method is interpreted as
      // a type, rather than the type of what the method returns.
      method value -> ObjectType {
        brandType.fresh
      }
    }

    scope.at("Brand") put(letBrand)

    scope.enter {
      check(nodes)
    }
  }

  // Note the dynamic use of a brand pattern here.
  class tagged.withType(BType : Pattern) -> ObjectType {
    inherits objectType.base

    // There are identity issues with delegation, so the tags are separate
    // objects which can safely be matched for identity.
    let tag = object {}

    method isSubtypeOf(oType : ObjectType) -> Boolean {
      // As in the structural types, it's important that the argument have a say
      // in this relationship.
      oType.isSupertypeOf(self).orElse {
        match (oType)
          case { bt : BType -> tag == bt.tag }
          case { _ -> false }
      }
    }

    method isSupertypeOf(oType : ObjectType) -> Boolean {
      match (oType)
        case { bt : BType -> tag == bt.tag }
        case { _ -> false }
    }
  }

  // A brand type-type is an ObjectType with pattern methods and is only a
  // subtype of itself.
  class brandTypeType.forBrand(brand) -> ObjectType is aBrandTypeType {
    inherits tagged.withType(BrandTypeType)

    def methods is public = objectType.pattern.methods

    method asString -> String {
      "{brand}.Type"
    }
  }

  // A brand type is an ObjectType which contains a unique brand type-type.
  def brandType = object {
    method base -> ObjectType {
      object is aBrandType {
        inherits tagged.withType(BrandType)

        def this = self

        var name : String is public

        let Type is unnamed = buildBrandType

        def mType = methodType.unnamedTypeDeclaration("Type") of(Type)

        // Uses the same returnType trick from above.
        def eType = object {
          inherits methodType.field("extend") ofType(theBrandType)

          method returnType -> ObjectType {
            brandType.fromBrands(this, brandType.fresh)
          }

          method asString -> String {
            "{signature.concatenateSeparatedBy(" ")} -> Brand"
          }
        }

        // The trick doesn't work here, because the return type is dependent on the
        // value of one of the arguments. We need an extra rule to handle this.
        def pType = object {
          inherits methodType.operator("+")
              parameter(parameter.ofType(theBrandType)) returnType(theBrandType)
        }

        def methods is public = set.with<MethodType>(mType, eType, pType)

        method asString -> String {
          name
        }
      }
    }

    constructor fresh -> ObjectType {
      inherits base

      name := "brand"

      method buildBrandType -> ObjectType is confidential {
        brandTypeType.forBrand(self)
      }
    }

    constructor fromBrands(first : BrandType, *rest : BrandType) -> ObjectType {
      inherits base

      name := first.name

      for (rest) do { br ->
        name := "{name} + {br.name}"
      }

      method buildBrandType -> ObjectType is confidential {
        var bType := first.Type

        for (rest) do { br ->
          bType := bType & br.Type
        }

        bType
      }
    }
  }

  // The return type of the + method on brands is dependent on the argument, so
  // we need to have an explicit rule for it.
  rule { req : QualifiedRequest ->
    if (req.name == "+") then {
      def rType = typeOf(req.receiver)

      match (rType)
        case { rType' : BrandType ->
           def aType = typeOf(req.parts.first.arguments.first)

           match (aType)
             case { aType' : BrandType -> brandType.fromBrands(rType', aType') }
             // If we can't resolve the argument, just extend the receiver.
             case { _ -> brandType.fromBrands(rType', brandType.new) }
        } case { _ -> typeOf(req) }
    } else {
      // This looks like it's recursive, but the existing rule in the structural
      // type checker has already given a rule for this object, and that type is
      // already cached.
      typeOf(req)
    }
  }
}

def defaultBrandChecker = brandChecker

method check(nodes : List<Node>) -> Done {
  defaultBrandChecker.check(nodes) inDialect(self)
}
