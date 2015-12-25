// Node is the common interface of all of the AST nodes.
//
// All nodes accept a visitor object, with the expectation that each will pass
// themselves to the appropriate method.
type Node = type {

  // Accept a visitor object, passing this object to the appropriate method on
  // the object.
  accept<T>(visitor : Visitor<T>) -> T

}


// A signature is a (non-empty) list of signature parts paired with an optional
// return-type expression, expected to be implicit Unknown if absent.
type Signature = Node & type {
  parts -> List<SignaturePart>
  returnType -> Expression
}

def signature = object {
  class of(parts' : List<SignaturePart>) -> Signature {
    inherits of(parts') returning(implicitUnknown)
  }

  class of(parts' : List<SignaturePart>)
        returning(returnType' : Expression)
        -> Signature {
    def parts is public = parts'
    def returnType is public = returnType'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitSignature(self)
    }
  }
}


// A signature part combines a name with some number of type- and
// value-parameters.
type SignaturePart = Node & type {
  name -> String
  typeParameters -> List<Parameter>
  parameters -> List<Parameter>
}

def signaturePart = object {
  class named(name' : String) -> SignaturePart {
    inherits named(name')
             withTypeParameters(list.empty)
             andParameters(list.empty)
  }

  class named(name' : String)
        withTypeParameters(typeParameters' : List<Parameter>)
        -> SignaturePart {
    inherits named(name')
             withTypeParameters(typeParameters')
             andParameters(list.empty)
  }

  class named(name' : String)
        withParameters(parameters' : List<Parameter>)
        -> SignaturePart {
    inherits named(name')
             withTypeParameters(list.empty)
             andParameters(parameters')
  }

  class named(name' : String)
        withTypeParameters(typeParameters' : List<Parameter>)
        parameters(parameters' : List<Parameter>)
        -> SignaturePart {
    def name is public = name'
    def typeParameters is public = typeParameters'
    def parameters is public = parameters'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitSignaturePart(self)
    }
  }
}


// A parameter is a name potentially paired with a type annotation. The
// annotation is expected to be implicit Unknown when it is absent.
//
// A parameter can also be variadic.
type Parameter = Node & type {
  name -> String
  typeAnnotation -> Expression
  isVariadic -> Boolean
}

def parameter = object {
  class named(name' : String) -> Parameter {
    inherits named(name') withType(implicitUnknown) isVariadic(false)
  }

  class named(name' : String)
        withType(typeAnnotation' : Expression)
        -> Parameter {
    inherits named(name') withType(typeAnnotation') isVariadic(false)
  }

  class named(name' : String)
        withType(typeAnnotation' : Expression)
        isVariadic(isVariadic' : Boolean)
        -> Parameter {
    def name is public = name'
    def typeAnnotation is public = typeAnnotation'
    def isVariadic is public = isVariadic'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitParameter(self)
    }
  }
}


// A method is a pairing of a signature and a body of statements.
type MethodDeclaration = Node & type {
  signature -> Signature
  body -> List<Statement>
}

def methodDeclaration = object {
  class withSignature(signature' : Signature)
        andBody(body' : List<Statement>)
        -> MethodDeclaration {
    def signature is public = signature'
    def body is public = body'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitMethod(self)
    }
  }
}


// A dialect only consists of a path.
type DialectDeclaration = Node & type {
  path -> String
}

def dialectDeclaration = object {
  class withPath(path' : String) -> DialectDeclaration {
    def path is public = path'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitDialect(self)
    }
  }
}


// An import pairs a path with a name, which may be optionally annotated with a
// type.  The type is expected to be implicit Unknown if absent.
type ImportDeclaration = Node & type {
  path -> String
  name -> String
  typeAnnotation -> Expression
}

def importDeclaration = object {
  class withPath(path' : String)
        named(name' : String)
        -> ImportDeclaration {
    inherits from(path') named(name') typed(implicitUnknown)
  }

  class withPath(path' : String)
        named(name' : String)
        withType(typeAnnotation' : Expression)
        -> ImportDeclaration {
    def path is public = path'
    def name is public = name'
    def typeAnnotation is public = typeAnnotation'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitInherits(self)
    }
  }
}


// An inherits clause contains a request, and an optional name.
type InheritsDeclaration = Node & type {
  request -> Request
  name -> String
}

def inheritsDeclaration = object {
  class from(request' : Request) -> Inherits {
    inherits from(request') named(implicitAnonymous)
  }

  class from(request' : Request)
        named(name' : String)
        -> Inherits {
    def request is public = request'
    def name is public = name'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitInherits(self)
    }
  }
}


// A common type between def, var, and type declarations.  All of these have a
// name and value.
type ValueDeclaration = Node & type {
  name -> String
  value -> Expression
}


// A def declaration extends the declaration type with an optional type
// annotation.  The annotation is expected to be implicit Unknown if absent.
type DefDeclaration = ValueDeclaration & type {
  typeAnnotation -> Expression
}

def defDeclaration = object {
  class named(name' : String)
        withValue(value' : Expression)
        -> Def {
    inherits named(name') withType(implicitUnknown) andValue(value')
  }

  class named(name' : String)
        withType(typeAnnotation' : Expression)
        andValue(value' : Expression)
        -> Def {
    def name is public = name'
    def typeAnnotation is public = typeAnnotation'
    def value is public = value'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitDef(self)
    }
  }
}


// A var declaration extends the declaration type with a type annotation.  Both
// the value and the type annotation are optional, and expected to be implicit
// uninitialised and implicit Unknown, respectively, if absent.
type VarDeclaration = ValueDeclaration & type {
  typeAnnotation -> Expression
}

def varDeclaration = object {
  class named(name' : String)
        -> Var {
    inherits named(name')
             withType(implicitUnknown)
             andValue(implicitUninitialised)
  }

  class named(name' : String)
        withType(typeAnnotation' : Expression)
        -> Var {
    inherits named(name')
             withType(typeAnnotation')
             andValue(implicitUninitialised)
  }

  class named(name' : String)
        withValue(value' : Expression)
        -> Def {
    inherits named(name') withType(implicitUnknown) andValue(value')
  }

  class named(name' : String)
        withType(typeAnnotation' : Expression)
        andValue(value' : Expression)
        -> Def {
    def name is public = name'
    def typeAnnotation is public = typeAnnotation'
    def value is public = value'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitVar(self)
    }
  }
}


// A type declaration just has a name and a value.
type TypeDeclaration = ValueDeclaration

def typeDeclaration = object {
  class named(name' : String)
        withValue(value' : Expression)
        -> TypeDeclaration {
    def name is public = name'
    def value is public = value'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitTypeDeclaration(self)
    }
  }
}


// A return just contains an expression.
type ReturnStatement = Node & type {
  value -> Expression
}

def returnStatement = object {
  class returning(value' : Expression) -> ReturnStatement {
    def value is public = value'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitReturn(self)
    }
  }
}


// An object constructor just contains a sequence of (object) statements.
type ObjectConstructor = Node & type {
  body -> List<ObjectStatement>
}

def objectConstructor = object {
  class containing(body' : List<ObjectStatement>) -> ObjectConstructor {
    def body is public = body'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitObjectConstructor(self)
    }
  }
}


// The common interface of requests.
type Request = Node & type {
  parts -> List<RequestPart>
}


// A request with an implicit receiver is just a sequence of parts.
type ImplicitReceiverRequest = Request

def implicitReceiverRequest = object {
  class of(parts' : List<RequestPart>) -> ImplicitReceiverRequest {
    def parts is public = parts'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitImplicitReceiverRequest(self)
    }
  }
}


// A request with an explicit receiver just extends a request with that receiver
// expression.
type ExplicitReceiverRequest = Request & type {
  receiver -> Expression
}

def explicitReceiverRequest = object {
  class to(receiver' : Expression)
        of(parts' : List<RequestPart>) -> ExplicitReceiverRequest {
    def parts is public = parts'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitExplicitReceiverRequest(self)
    }
  }
}


// A signature part combines a name with some number of type- and
// value-arguments.
type RequestPart = Node & type {
  name -> String
  typeArguments -> List<Expression>
  arguments -> List<Expression>
}

def requestPart = object {
  class named(name' : String)
        withTypeArguments(typeArguments' : List<Expression>)
        andArguments(arguments' : List<Expression>) {
    def name is public = name'
    def typeArguments is public = typeArguments'
    def arguments is public = arguments'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitRequestPart(self)
    }
  }
}


// A number literal has its original value processed into its actual number
// value.
type NumberLiteral = Node & type {
  value -> Number
}

def numberLiteral = object {
  class withValue(value' : Number) -> NumberLiteral {
    def value is public = value'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitNumberLiteral(self)
    }
  }
}


// A string literal has its original value processed into its actual string
// value.
type StringLiteral = Node & type {
  value -> String
}

def stringLiteral = object {
  class withValue(value' : String) -> StringLiteral {
    def value is public = value'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitStringLiteral(self)
    }
  }
}


// A block pairs a list of parameters with a body of statements.
type Block = Node & type {
  parameters -> List<Parameter>
  body -> List<Statement>
}

def block = object {
  class containing(body' : List<Statement>) {
    inherits withParameters(list.empty) containing(body')
  }

  class withParameters(parameters' : List<Parameter>)
        containing(body' : List<Statement>)
        -> Block {
    def parameters is public = parameters'
    def body is public = body'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitBlock(self)
    }
  }
}


// A type expression is a list of signatures.
type TypeLiteral = Node & type {
  signatures -> List<Signature>
}

def typeLiteral = object {
  class containing(signatures' : List<Signature>) -> TypeLiteral {
    def signatures is public = signatures'

    method accept<T>(visitor : Visitor<T>) -> T {
      visitor.visitType(self)
    }
  }
}


// Implicit done is used when an expression can be omitted.
def implicitDone = object {
  method accept<T>(visitor : Visitor<T>) -> T {
    visitor.visitImplicitDone(self)
  }
}


// Implicit Unknown is used when a type can be omitted.
def implicitUnknown = object {
  method accept<T>(visitor : Visitor<T>) -> T {
    visitor.visitImplicitUnknown(self)
  }
}


// Implicit uninitialised is used when a declaration's value can be omitted.
def implicitUninitialised = object {
  method accept<T>(visitor : Visitor<T>) -> T {
    visitor.visitImplicitUninitialised(self)
  }
}


// Implicit anonymous is used when a name can be ommitted.
def implicitAnonymous = object {
  method accept<T>(visitor : Visitor<T>) -> T {
    visitor.visitImplicitAnonymous(self)
  }
}


// An expression is any one of the listed types.
type Expression
  = ObjectConstructor
  | Request
  | BooleanLiteral
  | NumberLiteral
  | StringLiteral
  | Block
  | Type
  | ImplicitDone
  | ImplicitUnknown


// An object statement expands on the set of regular statements to include those
// that can appear inside of an object constructor.
type ObjectStatement
  = Dialect
  | Import
  | Inherits
  | MethodDeclaration
  | Statement


// A Visitor contains a visit* method for each kind of AST node, so that each
// node can identify what kind of node they are to the visitor, and the visitor
// can implement custom behaviour for each one.
//
// A visitor is parameterised by the type of the computation it performs given
// an AST node.
type Visitor<T> = type {
  visitSignature(node : Signature) -> T
  visitSignaturePart(node : SignaturePart) -> T
  visitOrdinarySignaturePart(node : OrdinarySignaturePart) -> T
  visitParameter(node : Parameter) -> T
  visitMethodDeclaration(node : MethodDeclaration) -> T
  visitDialectDeclaration(node : DialectDeclaration) -> T
  visitImportDeclaration(node : ImportDeclaration) -> T
  visitInheritsDeclaration(node : InheritsDeclaration) -> T
  visitDefDeclaration(node : DefDeclaration) -> T
  visitVarDeclaration(node : VarDeclaration) -> T
  visitReturnStatement(node : ReturnStatement) -> T
  visitObjectConstructor(node : ObjectConstructor) -> T
  visitImplicitReceiverRequest(node : ImplicitReceiverRequest) -> T
  visitExplicitReceiverRequest(node : ExplicitReceiverRequest) -> T
  visitRequestPart(node : RequestPart) -> T
  visitNumberLiteral(node : NumberLiteral) -> T
  visitStringLiteral(node : StringLiteral) -> T
  visitBlock(node : Block) -> T
  visitTypeLiteral(node : TypeLiteral) -> T
  visitImplicitDone(node : ImplicitDone) -> T
  visitImplicitUnknown(node : ImplicitUnknown) -> T
  visitImplicitUninitialised(node : ImplicitUninitialised) -> T
  visitImplicitAnonymous(node : ImplicitAnonymous) -> T
}

def visitor = object {
  class empty -> Visitor<Done> {
    method visitSignature(node : Signature) -> T {}
    method visitSignaturePart(node : SignaturePart) -> T {}
    method visitOrdinarySignaturePart(node : OrdinarySignaturePart) -> T {}
    method visitParameter(node : Parameter) -> T {}
    method visitMethodDeclaration(node : MethodDeclaration) -> T {}
    method visitDialectDeclaration(node : DialectDeclaration) -> T {}
    method visitImportDeclaration(node : ImportDeclaration) -> T {}
    method visitInheritsDeclaration(node : InheritsDeclaration) -> T {}
    method visitDefDeclaration(node : DefDeclaration) -> T {}
    method visitVarDeclaration(node : VarDeclaration) -> T {}
    method visitReturnStatement(node : ReturnStatement) -> T {}
    method visitObjectConstructor(node : ObjectConstructor) -> T {}
    method visitImplicitReceiverRequest(node : ImplicitReceiverRequest) -> T {}
    method visitExplicitReceiverRequest(node : ExplicitReceiverRequest) -> T {}
    method visitRequestPart(node : RequestPart) -> T {}
    method visitNumberLiteral(node : NumberLiteral) -> T {}
    method visitStringLiteral(node : StringLiteral) -> T {}
    method visitBlock(node : Block) -> T {}
    method visitTypeLiteral(node : TypeLiteral) -> T {}
    method visitImplicitDone(node : ImplicitDone) -> T {}
    method visitImplicitUnknown(node : ImplicitUnknown) -> T {}
    method visitImplicitUninitialised(node : ImplicitUninitialised) -> T {}
    method visitImplicitAnonymous(node : ImplicitAnonymous) -> T {}
  }
}
