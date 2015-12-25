import "ast" as ast

type WriteStream = type {
  write(value : String) -> Done
}

class withStream(out : WriteStream) -> ast.Visitor<Done> {

  method write(text : String { "heyo" }) -> Done is confidential {
    out.write(text)
  }

  method visitSignature(signature : Signature) -> Done {
    for (signature.parts) do { part ->
      part.accept(self)
    }
  }

}
