// Defines the typing rules for structurally-typed modules.

dialect "checker"

inherits delegateTo(standardPrelude)

// Type errors.
let TypeError is public = CheckerFailure.refine "Type Error"

let RequestError = TypeError.refine "Request Error"
let DeclarationError = TypeError.refine "Declaration Error"
let ObjectError = TypeError.refine "Object Error"
let MethodError = TypeError.refine "Method Error"

// Helper method for iterating over two lists at once.
method for<T>(a : List<T>) and<U>(b : List<U>)
    do(f : Function2<T, U, Object>) -> Done {
  var i : Number := 1

  while { (i <= a.size) && (i <= b.size) } do {
    f.apply(a.at(i), b.at(i))
    i := i + 1
  }
}

// Helper to normalise method names.
method uglify(name : String) -> String {
  var name' : String := if (name.endsWith("()")) then {
    name.substringTo(name.size - 2)
  } else {
    name
  }

  while { name'.contains "()" } do {
    name'.replace "() " with "_"
  }

  name'
}

constructor typeChecker {
  inherits checker

  // Type declarations.
  rule { decl : Let ->
    def name = decl.name.value
    def value = decl.value

    def staticValue = scope.enter {
      for (decl.generics) do { generic ->
        def gName = generic.value
        def gType = objectType.unknownNamed(gName)
        scope.at(gName) put(methodType.staticDeclaration(gName) of(gType))
      }

      runRules(value)
      objectType.fromExpression(value)
    }

    scope.at(name)
      put(setPublicityOf(if (staticValue.isUnknown) then {
        methodType.staticDeclaration(name) ofType(typeOf(value))
      } else {
        methodType.typeDeclaration(name) of(staticValue)
      }) fromNode(decl))
  }

  // Imports. At the moment there's no way to retrieve the type of the imported
  // module, so the name is just given type Unknown.
  rule { imp : Import ->
    scope.at(imp.identifier.value) put(objectType.unknown)
  }

  // Simple literals.

  rule { (BooleanLiteral) ->
    objectType.boolean
  }

  rule { (NumberLiteral) ->
    objectType.number
  }

  rule { (StringLiteral) ->
    objectType.string
  }

  rule { (Type) ->
    objectType.pattern
  }

  // Definitions and variable declarations. The types of definitions without a
  // pattern are inferred, whereas variables default to Unknown.
  rule { decl : Def | Var ->
    def name = decl.name.value
    def annType = declPattern(decl)
    def value = decl.value
    def vType = typeOf(value)

    if (!vType.isSubtypeOf(annType)) then {
      DeclarationError
        .raise("The expression «{value}» of type «{vType}» does not satisfy " ++
          "the type «{annType}» on the declaration «{name}»") forNode(value)
    }

    scope.at(name)
      put(setPublicityOf(methodType.field(name) ofType(declPattern(decl)))
        fromNode(decl))
  }

  method declPattern(decl : Def | Var) -> ObjectType {
    objectType.fromExpression(decl.patternOrIfAbsent {
      return match (decl)
        case { (Def) -> typeOf(decl.value) }
        case { (Var) -> objectType.unknown }
    })
  }

  // Add a method definition to the local scope.
  rule { decl : Method ->
    def sig = decl.signature
    def name = sig.name

    scope.at(uglify(name))
      put(setPublicityOf(methodType.fromNode(sig)) fromNode(decl))

    def rType = objectType.fromPatterned(sig)
    def findReturn = if (rType.isUnknown) then {
      visitor.empty
    } else {
      object {
        inherits visitor.base

        method visitReturn(ret : Return) -> Boolean {
          def value = ret.expression
          def vType = typeOf(value)

          if (!vType.isSubtypeOf(rType)) then {
            MethodError
              .raise("The expression «{value}» of type «{vType}» does not " ++
                "satisfy the return type «{rType}» in the method «{name}»")
              forNode(ret)
          }
        }

        method visitMethod(_) -> Boolean { false }
        method visitObjectConstructor(_) -> Boolean { false }
        method visitClass(_) -> Boolean { false }
      }
    }

    scope.enter {
      addSignature(decl)

      def body = decl.body

      for (body) do { stmt ->
        // Manually run the rules now, so they're in the right scope.
        runRules(stmt)
        stmt.accept(findReturn)
      }

      if (!body.isEmpty) then {
        def last = body.last

        if (Expression.match(last)) then {
          def eType = typeOf(last)

          if (!eType.isSubtypeOf(rType)) then {
            MethodError
              .raise("The expression «{last}» of type «{eType}» does not " ++
                "satisfy the return type «{rType}» in the method «{name}»")
              forNode(last)
          }
        }
      }
    }
  }

  // Add a class definition to the local scope.
  rule { decl : Class ->
    def classType = list.with(methodType.fromNode(decl.signature))
    def name = decl.name.value

    scope.at(name)
      put(setPublicityOf(methodType.field(name)
        ofType(objectType.fromMethods(classType))) fromNode(decl))

    scope.enter {
      addSignature(decl)

      for (decl.body) do { stmt ->
        // Manually run the rules now, so they're in the right scope.
        runRules(stmt)
      }

      checkAndTypeClass(decl)
    }
  }

  method addSignature(decl : Method | Class) -> Done {
    for (decl.signature.parts) do { part ->
      for (part.generics) do { param ->
        def name = param.value
        scope.at(name) put(methodType.field(name) ofType(objectType.pattern))
      }

      for (part.parameters) do { param ->
        def name = param.name.value
        scope.at(name)
          put(methodType.field(name) ofType(objectType.fromPatterned(param)))
      }
    }
  }

  method checkAndTypeClass(decl : Class) -> Done {
    def sig = decl.signature
    def cType = objectType.fromExpression(sig.patternOrIfAbsent { return })

    if (!cType.isUnknown) then {
      def bType = checkAndTypeConstructor(decl.body)

      if (!bType.isSubtypeOf(cType)) then {
        MethodError
            .raise("The body of class «{decl.name}» with type «{bType}» " ++
              "does not satisfy the return type «{cType}» on the class")
          forNode(decl)
      }
    }
  }

  // Object constructors. Just check the body, and return a type containing all
  // of the methods defined inside.
  rule { obj : ObjectConstructor ->
    scope.enter {
      checkAndTypeConstructor(obj.body)
    }
  }

  // The request in the inherits clause must resolve to a statically
  // determinable object definition.
  rule { inh : Inherits ->
    // TODO Handle confidential methods in the super object. Also: store them
    // somewhere so they can be resolved on explicit super calls. This requires
    // following a static path, which is inherently unsafe. The design of
    // inheritance (with explicitly static paths) is necessary to fix this
    // problem.
    for (typeOf(inh.request).methods) do { meth ->
      scope.at(uglify(meth.name)) put(meth)
    }
  }

  // Requests for confidential methods are handled by the rule for qualified
  // requests. Any other reference to self should return the type of the public
  // methods on self.
  rule { (Self) ->
    def publicMethods = mutableList.empty<MethodType>

    for (scope.local.values) do { meth ->
      if (meth.isPublic) then {
        publicMethods.add(meth)
      }
    }

    objectType.fromMethods(publicMethods)
  }

  method checkAndTypeConstructor(body : List<Node>) -> ObjectType {
    def methods = mutableSet.empty<MethodType>

    for (body) do { node ->
      runRules(node)

      for (scope.local.values) do { mType ->
        if (mType.isPublic) then {
          methods.add(mType)
        }
      }
    }

    objectType.fromMethods(methods.asImmutable)
  }

  // Method requests.

  rule { req : UnqualifiedRequest ->
    def name = req.name

    checkAndTypeRequest(req) against(scope.find(uglify(name)) ifAbsent {
      RequestError.raise "Cannot find definition «{name}»" forNode(req)
    })
  }

  rule { req : QualifiedRequest ->
    // Qualified requests require process the type of the receiver.
    def rec = req.receiver

    def rType = if (Self.match(rec)) then {
      // If the receiver is an explicit self, grab the local scope as a type.
      objectType.fromMethods(scope.local.values)
    } elseIf { Super.match(rec) } then {
      // TODO Handle super.
      LogicError.raise "Super not yet implemented"
    } elseIf { Outer.match(rec) } then {
      // TODO Handle outer.
      LogicError.raise "Outer not yet implemented"
    } else {
      typeOf(rec)
    }

    // If the receiver is unknown, we can't know if this request is valid or
    // the result type of the request.
    if (rType.isUnknown) then {
      objectType.unknown
    } else {
      def name = req.name
      def meth = rType.methodNamed(name) ifAbsent {
        match (uglify(name))
          case { "asString" -> asStringType }
          case { "==" | "!=" -> equalsType }
          case { _ ->
            RequestError
              .raise "No such method «{name}» in «{rec}» of type «{rType}»"
              forNode(req)
          }
      }

      checkAndTypeRequest(req) against(meth)
     }
  }

  // Check and, if valid, return the resulting type of a request node against
  // the method type the request resolved to.
  method checkAndTypeRequest(req : Request)
      against(meth : MethodType) -> ObjectType {
    def name = meth.name

    for (meth.signature) and(req.parts) do { sigPart, reqPart ->
      def params = sigPart.parameters
      def args   = reqPart.arguments

      def pSize = params.size
      def aSize = args.size

      if (aSize != pSize) then {
        def which = if (aSize > pSize) then { "many" } else { "few" }
        def where = if (aSize > pSize) then {
          args.at(pSize + 1)
        } else {
          reqPart
        }

        RequestError.raise("Too {which} arguments to method part " ++
            "«{sigPart.name}», expected {pSize} but got {aSize}")
          forNode(where)
      }

      for (params) and(args) do { param, arg ->
        def pType = param.pattern
        def aType = typeOf(arg)

        if (!typeOf(arg).isSubtypeOf(pType)) then {
          RequestError.raise("The expression " ++
            "«{arg}» of type «{aType}» does not " ++
            "satisfy the type of parameter «{param}» in the " ++
            "method «{name}»") forNode(arg)
        }
      }
    }

    meth.returnType
  }

  rule { block : Block ->
    def params = block.parameters
    def body = block.body

    def pSize = params.size
    // TODO Add generic arguments to the name.
    def name = match(pSize)
      case { 0 -> "Action" }
      case { 1 -> "Function" }
      case { 2 -> "Function{pSize}" }

    def params' = mutableList.empty<Parameter>
    for (params) do { param ->
      params'.add(parameter.name(param.name.value)
        ofType(objectType.fromPatterned(param)))
    }

    def apply =
      methodType.signature(list.with(part.name("apply") parameters(params')))
        returnType(if (body.isEmpty) then {
          objectType.done
        } else {
          typeOf(block.body.last)
        })

    objectType.fromMethods(list.with(apply)) named(name)
  }

  // Defines the object declarations from representing structural types.

  let Parameter = type {
    name -> String
    pattern -> ObjectType
  }

  def parameter = object {

    // Construct a parameter with the given name and type.
    constructor name(name' : String) ofType(type' : ObjectType) -> Parameter {
      def name : String is public = name'
      def pattern : ObjectType is public = type'

      method asString -> String {
        if (pattern.isUnknown) then {
          name
        } else {
          "{name} : {pattern}"
        }
      }
    }

    // Construct an unnamed parameter with the given type.
    constructor ofType(type' : Object) -> Parameter {
      inherits name("_") ofType(type')
    }
  }

  // Method part type.
  let Part = type {
    name -> String
    parameters -> List<Param>
  }

  class part.name(name' : String)
      parameters(parameters' : List<Parameter>) -> Part {
    def name : String is public = name'
    def parameters : List<Parameter> is public = parameters'

    method asString -> String {
      if (parameters.isEmpty) then {
        name
      } else {
        "{name}({parameters.concatenateSeparatedBy(", ")})"
      }
    }
  }

  let Signature = List<Part>

  // Method signature information.
  let MethodType = type {
    name -> String
    signature -> Signature
    returnType -> ObjectType

    //isSpecialisationOf(other : MethodType) -> Boolean

    isPublic -> Boolean
    isPublic := (value : Boolean) -> Done
  }

  // Types stored as method types. The return type of the object is expected to
  // be the pattern type, and the value method is the actual underlying pattern.
  let TypeDecl = MethodType & type {
    value -> ObjectType
  }

  def methodType = object {

    constructor field(name : String)
        ofType(returnType' : ObjectType) -> MethodType {
      inherits signature(list.with(part.name(name) parameters(list.empty)))
        returnType(returnType')
    }

    constructor staticDeclaration(name : String)
        ofType(returnType' : ObjectType) -> MethodType {
      inherits signature(list.with(part.name(name) parameters(list.empty)))
        returnType(object {
          inherits delegateTo(returnType')

          method asString -> String {
            name
          }
        })
    }

    constructor typeDeclaration(name : String)
        of(value' : ObjectType) -> TypeDecl {
      inherits field(name) ofType(objectType.pattern)

      def value : Object is public = object {
        inherits delegateTo(value')

        method asString -> String {
          name
        }
      }
    }

    constructor named(name' : String)
        parameters(parameters : List<Parameter)
        returnType(returnType' : ObjectType) -> MethodType {
      inherits signature(list.with(part.name(name') parameters(parameters)))
        returnType(returnType')
    }

    constructor signature(signature' : Signature)
        returnType(returnType' : ObjectType) -> MethodType {
      def signature : Signature is public = signature'.asImmutable
      def returnType : ObjectType is public = returnType'

      method name {
        if (signature.first.parameters.isEmpty) then {
          signature.first.name
        } else {
          var once : Boolean := false
          var output : String

          for (signature) do { part ->
            if (once) then {
              output := "{part.name}()"
            } else {
              output := " {part.name}()"
            }
          }
        }
      }

      // Determines if this method is a specialisation of the given one.
      //method isSpecialisationOf(other : MethodType) -> Boolean {
        //if (self == other) then {
          //return true
        //}

        //if (name != other.name) then {
          //return false
        //}

        //if (other.signature.size != signature.size) then {
          //return false
        //}

        //for (signature) and(other.signature) do { part, part' ->
          //if (part.name != part'.name) then {
            //return false
          //}

          //for (part.parameters) and(part'.parameters) do { p, p' ->
            //def pt = p.pattern
            //def pt' = p'.pattern

            //// Contravariant in parameter types.
            //if (pt'.isSubtypeOf(pt).not) then {
              //return false
            //}
          //}
        //}

        //return returnType.isSubtypeOf(other.returnType)
      //}

      var isPublic : Boolean is public := true

      method asString -> String {
        def sig = signature.concatenateSeparatedBy(" ")

        if (returnType.isUnknown) then {
          sig
        } else {
          "{sig} -> {returnType}"
        }
      }
    }

    method fromNode(node : Node.Signature) -> MethodType {
      def sig = mutableList.empty

      for (node.parts) do { aPart ->
        def params = mutableList.empty

        for (aPart.parameters) do { aParameter ->
          // TODO Varargs
          params.add(parameter.name(aParameter.name.value)
            ofType(objectType.fromPatterned(aParameter)))
        }

        sig.add(part.name(aPart.name.value) parameters(params))
      }

      object {
        inherits signature(sig)
          returnType(objectType.fromPatterned(node))
      }
    }

    method fromMirrorMethod(meth : mirrors.MirrorMethod) -> MethodType {
      def sig = mutableList.empty

      for (meth.signature) do { aPart ->
        def params = mutableList.empty
        var i := 1

        while { i <= aPart.parameters } do {
          params.add(parameter.ofType(objectType.unknown))
          i := i + 1
        }

        sig.add(part.name(aPart.name) parameters(params))
      }

      object {
        inherits signature(sig) returnType(objectType.unknown)
      }
    }

    method asString -> String {
      "methodType"
    }
  }

  let Annotated = type { annotations -> List<Expression> }

  method setPublicityOf(mType : MethodType)
      fromNode(decl : Annotated) -> MethodType {
    mType.isPublic := isPublic(decl)
    mType
  }

  method isPublic(decl : Annotated) -> Boolean {
    for (decl.annotations) do { ann ->
      match (ann)
        case { req : UnqualifiedRequest ->
          // TODO Matching against the name of the request is not the
          // appropriate mechanism to properly resolve this, but it works well
          // enough for now. The actual annotation system will need an overhaul
          // for anything to be sensible here.
          //
          // Also, this doesn't take into account the fact that these
          // annotations can both appear multiple times in an annotation list,
          // so we should be looking in reverse order (as the last one in the
          // list will be the one that applies).
          match (req.name)
            case { "public" -> return true }
            case { "confidential" -> return false }
        }
    }

    !(Def.match(decl) || Var.match(decl))
  }

  let ObjectType = type {
    methods -> Set<MethodType>
    methodNamed(name : String)
      ifAbsent<T>(onAbsent : Action<T>) -> MethodType | T
    isUnknown -> Boolean
    isStructural -> Booealn
    isSubtypeOf(other : ObjectType) -> Boolean
    // Used for redispatch in isSubtypeOf(), and does not actually represent a
    // calculation of whether this type is a supertype of the given one.
    isSupertypeOf(other : ObjectType) -> Boolean
    |(other : ObjectType) -> ObjectType
    &(other : ObjectType) -> ObjectType
  }

  def objectType is public = object {

    method getMethods(typ : Type) -> Set<MethodType> is confidential {
      def methods = mutableSet.empty<MethodType>

      for (typ.signatures) do { sig ->
        methods.add(methodType.fromNode(sig))
      }

      methods.asImmutable
    }

    constructor fromExpression(expression : Expression)
        named(name : String) -> ObjectType {
      inherits delegateTo(fromExpression(expression))

      method asString -> String {
        name
      }
    }

    method fromExpression(expression : Expression) -> ObjectType {
      match (expression)
        case { req : UnqualifiedRequest ->
          match (scope.find(uglify(req.name)) ifAbsent { return unknown })
            case { decl : TypeDecl -> decl.value }
            case { _ -> unknown }
        } case { req : QualifiedRequest ->
          if (req.name == "&") then {
            return objectType.fromExpression(req.receiver) &
              objectType.fromExpression(req.parts.at(1).arguments.at(1))
          }

          if (req.name == "|") then {
            return objectType.fromExpression(req.receiver) |
              objectType.fromExpression(req.parts.at(1).arguments.at(1))
          }

          // TODO This is unsound in the presence of field overriding. A correct
          // implementation would need to only follow static paths, but because
          // there are very few paths this would render this rule practically
          // useless. The design of static resolution needs to be rehashed to
          // fix this problem.
          match (typeOf(req.receiver)
              .methodNamed(req.name) ifAbsent { return unknown })
            case { decl : TypeDecl -> decl.value }
            case { _ -> unknown }
        } case { typ : Type ->
          fromMethods(getMethods(typ))
        } case { _ ->
          unknown
        }
    }

    constructor empty -> ObjectType {
      inherits fromMethods(set.empty<MethodType>) named("Object")
    }

    constructor fromMethods(methods' : Set<MethodType>)
        named(name : String) -> ObjectType {
      inherits fromMethods(methods')

      method asString -> String {
        name
      }
    }

    constructor fromMethods(methods' : Set<MethodType>) -> ObjectType {
      inherits base

      def methods : Set<MethodType> is public = methods'.asImmutable
      def isStructural : Boolean is public = true

      method isSubtypeOf(oType : ObjectType) -> Boolean {
        // Let the given type have a say.
        oType.isSupertypeOf(self).orElse {
          oType.isStructural.andAlso {
            isSubtypeOf(oType) withAssumptions(mutableDictionary.empty)
          }
        }
      }

      method isSubtypeOf(oType : ObjectType)
          withAssumptions(assumptions :
            MutableDictionary<ObjectType, MutableSet<ObjectType>>) -> Boolean {
        if (oType.isUnknown || assumptions.at(self) ifAbsent {
          def against = mutableSet.empty<ObjectType>
          assumptions.at(self) put(against)
          against
        }.contains(oType)) then {
          return true
        }

        assumptions.at(self) do { assume -> assume.add(oType) }

        for (oType.methods) do { oMeth ->
          def sMeth = methodNamed(oMeth.name) ifAbsent { return false }

          for (oMeth.signature) and(sMeth.signature) do { oPart, sPart ->
            if (oPart.parameters.size != sPart.parameters.size) then {
              return false
            }

            for (oPart.parameters) and(sPart.parameters) do { oParam, sParam ->
              if (!oParam.pattern.isSubtypeOf(sParam.pattern)
                  withAssumptions(assumptions)) then {
                return false
              }
            }
          }

          if (!sMeth.returnType.isSubtypeOf(oMeth.returnType)) then {
            return false
          }
        }

        true
      }

      method isSupertypeOf(_ : ObjectType) -> Boolean {
        false
      }

      method asString -> String {
        match (methods.size)
          case { 0 -> "type \{\}"}
          case { 1 -> "type \{ {methods.concatenateSeparatedBy ""} \}" }
          case { n -> "type \{\n  {methods.concatenateSeparatedBy "\n  "}\n\}" }
      }
    }

    def done : ObjectType is public = object {
      inherits base

      def methods : Set<MethodType> is public = set.empty

      method isSubtypeOf(oType : ObjectType) -> Boolean {
        oType.isSupertypeOf(oType).orElse {
          self == other
        }
      }

      method isSupertypeOf(oType : ObjectType) -> Boolean {
        self == other
      }

      method asString -> String {
        "Done"
      }
    }

    def unknown : ObjectType is public = object {
      inherits base

      def methods : Set<MethodType> is public = set.empty

      method isUnknown -> Boolean {
        true
      }

      method isSubtypeOf(_ : ObjectType) -> Boolean {
        true
      }

      method isSupertypeOf(other : ObjectType) -> Boolean {
        true
      }

      method &(_ : ObjectType) -> ObjectType {
        // TODO This loses information. It would be better to have a type that
        // is still unknown, but is guaranteed to have the methods in the other
        // given type.
        self
      }

      method |(_ : ObjectType) -> ObjectType {
        self
      }

      method asString -> String {
        "Unknown"
      }
    }

    constructor unknownNamed(name : String) -> ObjectType {
      inherits delegateTo(unknown)

      method asString -> String {
        name
      }
    }

    def boolean : ObjectType is public = unknown
    def number : ObjectType is public = unknown
    def string : ObjectType is public = unknown
    def pattern : ObjectType is public = unknown

    let Patterned = type {
      patternOrIfAbsent<T>(onAbsent : Procedure<T>) -> ObjectType | T
    }

    method fromPatterned(node : Patterned) -> ObjectType {
      objectType.fromExpression(node.patternOrIfAbsent {
        return unknown
      })
    }

    constructor base -> ObjectType {
      method methodNamed(name : String)
          ifAbsent<T>(onAbsent : Action<T>) -> MethodType | T {
        for (methods) do { meth ->
          if (uglify(meth.name) == uglify(name)) then {
            return meth
          }
        }

        onAbsent.apply
      }

      def isStructural : Boolean is public = false
      def isUnknown : Boolean is public = false

      method &(other : ObjectType) -> ObjectType {
        and(self, other)
      }

      constructor |(other : ObjectType) -> ObjectType {
        or(self, other)
      }
    }

    constructor and(a : ObjectType, b : ObjectType) -> ObjectType {
      inherits base

      // TODO This is not correct. Methods with the same names should be
      // joined together into some compatible interface. Furthermore, if there
      // are two incompatible signatures with the same name, this whole type
      // should resolve to Void.
      def methods : Set<MethodType> is public = a.methods ++ b.methods

      method isSubtypeOf(oType : ObjectType) -> Boolean {
        oType.isSupertypeOf(self).orElse {
          a.isSubtypeOf(oType).orElse {
            b.isSubtypeOf(oType)
          }
        }
      }

      method isSupertypeOf(oType : ObjectType) -> Boolean {
        oType.isSubtypeOf(a).andAlso {
          oType.isSubtypeOf(b)
        }
      }

      method asString -> String {
        "{a} & {b}"
      }
    }

    constructor or(a : ObjectType, b : ObjectType) -> ObjectType {
      inherits base

      def methods : Set<MethodType> is public =
        intersectionOf(a.methods) and(b.methods)

      method isSubtypeOf(oType : ObjectType) -> Boolean {
        oType.isSupertypeOf(self).orElse {
          a.isSubtypeOf(oType).andAlso {
            b.isSubtypeOf(oType)
          }
        }
      }

      method isSupertypeOf(oType : ObjectType) -> Boolean {
        oType.isSubtypeOf(a).orElse {
          oType.isSubtypeOf(b)
        }
      }

      method asString -> String {
        "{a} | {b}"
      }
    }

    method asString -> String {
      "objectType"
    }
  }

  def asStringType = methodType.field("asString") ofType(objectType.string)
  def equalsType = methodType.signature(list.with(part.name("==")
      parameters(list.with(parameter.ofType(objectType.empty)))))
    returnType(objectType.boolean)

  method intersectionOf(a : Set<MethodType>)
      and(b : Set<MethodType>) -> Set<MethodType> is confidential {
    def c = mutableSet.empty<MethodType>

    for (a) do { m ->
      find(m) in(b) ifFound {
        // TODO This needs to be a composite method type.
        c.add(m)
      }
    }

    c.asImmutable
  }

  method find(m : MethodType) in(ms : Set<MethodType>)
      ifFound(onFound : Action) -> Done is confidential {
    for (ms) do { m' ->
      if (m'.name == m.name) then {
        onFound.apply
        return
      }
    }
  }

  method check(nodes : List<Node>) inDialect(dia : Object) -> Done {
    mirrors.reflect(dia).insertInto(scope.local) withUnknown(objectType.unknown)

    scope.enter {
      check(nodes)
    }
  }

  method asString -> String {
    "type checker"
  }
}

// Storing the default type checker between checks means that if the checker is
// run on a module twice, it will immediately return the cached form.
def defaultTypeChecker = typeChecker

// While the checker constructor above allows for this dialect to be extended,
// if it is used directly as a dialect it just instantiates the rules defined
// above and uses them as the checker.
method check(nodes : List<Node>) -> Done {
  defaultTypeChecker.check(nodes) inDialect(self)
}
