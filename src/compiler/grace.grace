import "ast" as ast

type WriteStream = type {
  write(value : String) -> Done
}

// An error raised if the compiler encounters a problem with the given nodes.
def CompilerError is public = object {
  inherits LogicError.refine "Compiler Error"

  // The compiler should not encounter implicit values: raise a Compiler Error
  // indicating the given kind of implicit was encountered.
  method raiseForUnexpectedImplicit(kind : String) -> None {
    raise "Compiler encountered unexpected implicit {implicit}"
  }
}

// Constructs a new Grace compiler as an AST visitor, writing the output to the
// given stream. Have the root of the AST accept() the resulting object to run
// the compilation.
class withStream(out : WriteStream) -> ast.Visitor<Done> {

  method visitSignature(signature : Signature) -> Done {
    for (signature.parts) do { part ->
      part.accept(self)
    }

    if (signature.returnType /= ast.implicitUnknown) then {
      write " -> "
      signature.returnType.accept(self)
    }
  }

  method visitSignaturePart(part : SignaturePart) -> Done {
    write(part.name)

    writeIfSome(part.typeParameters) surroundedBy("<", ">")
    writeIfSome(part.parameters) surroundedBy("(", ")")
  }

  method visitParameter(parameter : Parameter) -> Done {
    if (parameter.isVariadic) then {
      write "*"
    }

    write(parameter.name)
    writeTypeAnnotation(parameter.typeAnnotation)
  }

  method visitMethod(meth : Method) -> Done {
    write "method "
    meth.signature.accept(self)

    write " "
    writeBlock(meth.body)
    endLine
  }

  method visitDialect(dial : Dialect) -> Done {
    write "dialect "
    writeStringLiteral(dial.path)
    endLine
  }

  method visitImport(impo : Import) -> Done {
    write "import "
    writeStringLiteral(impo.path)
    write " as "
    write(impo.name)
    writeTypeAnnotation(impo.typeAnnotation)
    endLine
  }

  method visitInherits(inhe : Inherits) -> Done {
    write "inherits "
    inhe.request.accept(self)

    if (inhe.name /= ast.implicitAnonymous) then {
      write " as "
      write(inhe.name)
    }

    endLine
  }

  method visitDefDeclaration(decl : DefDeclaration) -> Done {
    write "def "
    write(decl.name)
    writeTypeAnnotation(decl.typeAnnotation)
    write " = "
    decl.value.accept(self)
  }

  method visitVarDeclaration(decl : DefDeclaration) -> Done {
    write "var "
    write(decl.name)
    writeTypeAnnotation(decl.typeAnnotation)

    if (decl.value /= ast.implicitUninitialised) then {
      write " := "
      decl.value.accept(self)
    }
  }

  method visitTypeDeclaration(decl : TypeDeclaration) -> Done {
    write "type "
    write(decl.name)
    write " = "
    decl.value.accept(self)
  }

  method visitReturn(retu : Return) -> Done {
    if (retu.value /= ast.implicitDone) then {
      write "return "
      retu.value.accept(self)
    } else {
      write "return"
    }
  }

  method visitObjectConstructor(objectConstructor : ObjectConstructor) -> Done {
    write "object "
    writeBlock(objectConstructor.body)
  }

  method visitImplicitReceiverRequest(request : ImplicitReceiverRequest)
         -> Done {
    for (request.parts) do { part ->
      part.accept(self)
    }
  }

  method visitExplicitReceiverRequest(request : ExplicitReceiverRequest)
         -> Done {
    request.receiver.accept(self)
    write "."
    for (request.parts) do { part ->
      part.accept(self)
    }
  }

  method visitRequestPart(part : RequestPart) -> Done {
    write(part.name)
    writeIfSome(part.typeArguments) surroundedBy("<", ">")
    writeIfSome(part.arguments) surroundedBy("(", ")")
  }

  method visitNumberLiteral(number : NumberLiteral) -> Done {
    write(number.value.asString)
  }

  method visitStringLiteral(string : StringLiteral) -> Done {
    writeStringLiteral(string.value)
  }

  method visitBlock(block : Block) -> Done {
    if (block.parameters.isEmpty) then {
      writeBlock(block.body)
    } else {
      write "\{ "
      writeCommaSeparated(block.parameters)

      if (block.body.isEmpty) then {
        write " -> \}"
      } else {
        write " ->"
        writeBlockBody(block.body)
      }
    }
  }

  method visitType(typ : Type) -> Done {
    write "type "
    writeBlock(typ.signatures)
  }

  method visitImplicitDone(_ : ImplicitDone) -> Done {
    CompilerError.raiseForUnexpectedImplicit "done"
  }

  method visitImplicitUnknown(_ : ImplicitUnknown) -> Done {
    CompilerError.raiseForUnexpectedImplicit "Unknown"
  }

  method visitImplicitUninitialised(_ : ImplicitUninitialised) -> Done {
    CompilerError.raiseForUnexpectedImplicit "uninitialised"
  }

  method visitImplicitAnonymous(_ : ImplicitAnonymous) -> Done {
    CompilerError.raiseForUnexpectedImplicit "anonymous"
  }

  // Write text to the output stream.
  method write(text : String) -> Done is confidential {
    out.write(text)
  }

  def indentAmount = 2
  var indentation : String := ""

  // Write the current indentation.
  method indent -> Done is confidential {
    write(indentation)
  }

  // Increase the level of indentiation by `indentAmount`.
  method increaseIndentation -> Done is confidential {
    indentation := indentation ++ "  "
  }

  // Decrease the level of indentation by `indentAmount`.
  method decreaseIndentation -> Done is confidential {
    indentation := indentiation.substringTo(indentation.size - 2)
  }

  // End the line and indent.
  method endLine -> Done is confidential {
    write("\n")
    indent
  }

  // Write a list of nodes with commas separating them.
  method writeCommaSeparated(nodes : List<Node) -> Done is confidential {
    if (!nodes.isEmpty) then {
      nodes.first.accept(self)

      nodes.fold { _, node ->
        write ", "
        node.accept(self)
      }
    }
  }

  // If a list of nodes contains any values, surround it with the given
  // delimiters and comma separate the nodes.
  method writeIfSome(nodes : List<Node>)
         surroundedBy(l : String, r : String)
         -> Done
         is confidential {
    if (!nodes.isEmpty) then {
      write(l)
      writeCommaSeparated(nodes)
      write(r)
    }
  }

  // Surround a list of indented statements in braces.
  method writeBlock(body : List<Node>) -> Done is confidential {
    if (body.isEmpty) then {
      write "\{\}"
    } else {
      write "\{"
      writeBlockBody(body)
      indent
      write "\}"
    }
  }

  // Write an indented list of statements with an increased indentation.
  method writeBlockBody(body : List<Node>) -> Done is confidential {
    if (!body.isEmpty) then {
      increaseIndentation

      for (body) do { node ->
        indent
        node.accept(self)
      }

      decreaseIndentation
    }
  }

  // Write a string literal surrounded by quotes, escaping control characters.
  method writeStringLiteral(contents : String) -> Done is confidential {
    write "\""
    write(contents.replace("\\") with("\\\\")
                  .replace("\"") with("\\\"")
                  .replace("\{") with("\\\{")
                  .replace("\}") with("\\\}"))
    write "\""
  }

  // Write a potentially implicit type annotation, including the delimiter.
  method writeTypeAnnotation(annotation : Expression) -> Done is confidential {
    if (annotation /= ast.implicitUnknown) then {
      write " : "
      annotation.accept(self)
    }
  }

}
