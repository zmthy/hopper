import "ast" as ast

import "parser/grammar" as grammar
import "parser/lexer"   as lexer


type Grammar<T> = grammar.Grammar<T>


// Parse a Grace module using the given token stream.
method withStream(tokens : lexer.TokenStream) {
  language.module.parse(tokens)
}


// A pairing of name and optional type annotation.
type Declaration = type {
  // The name of the declaration.
  name -> String

  // The type annotation on the declaration, or implicit Unknown if omitted.
  typeAnnotation -> ast.Expression
}

def declaration = object {
  // A declaration with an optional type annotation. If the type annotation is
  // none, it will default to implicit Unknown.
  class named(name' : String)
        withType(typeAnnotation' : grammar.Option<Expression>)
        -> Declaration {
    def name is public = name'
    def typeAnnotation is public = typeAnnotation' || ast.implicitUnknown
  }
}

// The set of grammars used to construct the Grace language. Exposed publicly so
// that users can parse parts of the language instead of a whole module if
// desired.
def language is public = object {
  // A helper for the common form of an identifier with an optional type
  // annotation.
  def typedIdentifier : Grammar<Declaration> =
    grammar.identifier.then(grammar.literal(":")
                      .then(expression).lone)
                       into { name, typeAnnotation ->
                         declaration.named(name)
                                     withType(typeAnnotation)
                       }

  def requestPart : Grammar<ast.RequestPart> is public =
    grammar.identifier.then(expression.commas.angles.lone)
                       then(expression.commas.parens.lone)
                       into { name, typeArguments, arguments ->
                         ast.requestPart
                            .named(name)
                             withTypeArguments(typeArguments || list.empty)
                             andArguments(arguments || list.empty)
                       }

  def implicitReceiverRequest : Grammar<ast.ImplicitReceiverRequest> is public =
    requestPart.some
               .into { parts ->
                 ast.implicitReceiverRequest
                    .of(parts)
               }

  def explicitReceiverRequest : Grammar<ast.ExplicitReceiverRequest> is public =
    expression.then(grammar.literal(".").then(requestPart.some))
               into { receiver, parts ->
                 ast.explicitReceiverRequest
                    .to(receiver)
                     of(parts)
               }

  def objectConstructor : Grammar<ast.ObjectConstructor> is public =
    grammar.literal("object").then(objectBody.braces)
                             .into { body ->
                               ast.objectConstructor
                                  .containing(body)
                             }

  def block : Grammar<ast.Block> is public =
    typedIdentifier.commas
                   .neht(grammar.literal("->"))
                   .lone
                   .then(body) into { parameters, body ->
                     ast.block.withParameters(parameters || list.empty)
                               containing(body)
                   }.braces

  def numberLiteral : Grammar<ast.NumberLiteral> is public =
    grammar.numberLiteral.into { value ->
                           ast.numberLiteral
                              .withValue(value)
                         }

  def stringLiteral : Grammar<ast.StringLiteral> is public =
    grammar.stringLiteral.into { value ->
                           ast.stringLiteral
                              .withValue(value)
                         }

  def expression : Grammar<ast.Expression> is public =
    request || objectConstructor || block

  def defDeclaration : Grammar<ast.DefDeclaration> is public =
    grammar.literal("def").then(typedIdentifier)
                          .then(literal("=").then(expression))
                           into { declaration, expression ->
                             ast.defDeclaration
                                .named(declaration.name)
                                 withType(declaration.typeAnnotation)
                                 andValue(expression)
                           }

  def varDeclaration : Grammar<ast.VarDeclaration> is public =
    grammar.literal("var").then(typedIdentifier)
                          .then(literal(":=").then(expression).lone)
                           into { declaration, expression ->
                             ast.varDeclaration
                                .named(declaration.name)
                                 withType(declaration.typeAnnotation)
                           }

  def typeDeclaration : Grammar<ast.TypeDeclaration> is public =
    grammar.literal("type").then(grammar.identifier)
                           .then(literal("=").then(expression))
                            into { name, expression ->
                              ast.typeDeclaration
                                 .named(name)
                                  withValue(expression)
                            }

  def returnStatement : Grammar<ast.ReturnStatement> is public =
    grammar.literal("return").then(expression.lone)
                             .into { expression ->
                               ast.returnStatement
                                  .returning(expression || ast.implicitDone)
                             }

  def statement : Grammar<ast.Statement> is public =
    defDeclaration || varDeclaration || typeDeclaration || expression

  def signaturePart : Grammar<ast.SignaturePart> is public =
    grammar.identifier.then(typeIdentifier.commas.parens)
                       into { name, parameters ->
                         ast.signaturePart
                            .named(name)
                             withTypeParameters(typeParameters)
                             parameters(parameters)
                       }

  def signature : Grammar<ast.Signature> is public =
    signaturePart.some
                 .then(grammar.literal("->").then(expression).lone)
                  into { parts, returnType ->
                    ast.signature
                       .of(parts)
                        returning(returnType)
                  }

  def body : Grammar<List<ast.Statement>> is public =
    statement.endLine.many || statement

  def methodDeclaration : Grammar<ast.MethodDeclaration> is public =
    grammar.literal("method").then(signature)
                             .then(body.braces)
                              into { signature, body ->
                                ast.methodDeclaration
                                   .withSignature(signature)
                                    andBody(body)
                              }

  def objectStatement : Grammar<ast.ObjectStatement> is public =
    methodDeclaration || statement

  def objectBody : Grammar<List<ast.ObjectStatement>> is public =
    objectStatement.endLine.many || objectStatement

  def dialectDeclaration : Grammar<ast.DialectDeclaration> is public =
    grammar. literal("dialect").then(stringLiteral)
                               .into { path ->
                                 ast.dialectDeclaration
                                    .withPath(path)
                               }.endLine

  def importDeclaration : Grammar<ast.ImportDeclaration> is public =
    grammar.literal("import").then(stringLiteral)
                             .then(literal("as").then(typedIdentifier))
                              into { path, declaration ->
                                ast.importDeclaration
                                   .withPath(path)
                                    named(declaration.name)
                                    withType(declaration.typeAnnotation)
                              }.endLine

  def module : Grammar<ast.ObjectConstructor> is public =
    dialectDeclaration.lone
                      .then(importDeclaration.lone)
                       then(objectBody)
                       into { diaDecl, impDecl, body ->
                         ast.objectConstructor
                            .containing(list.with(diaDecl, impDecl) ++ body)
                       }
}
