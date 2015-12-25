import "parser/lexer" as lexer

// An optional value that can only be safely extracted.
type Option<T> = type {
  // Extract the value with a default to use if the value is not present.
  ||(else : T) -> T
}

def option = object {
  // An option with the given value.
  class some<T>(value : T) -> Option<T> {
    method ||(_ : T) -> T {
      value
    }
  }

  // An option without a value.
  class none<T> -> Option<T> {
    method ||(else : T) -> T {
      else
    }
  }
}

// A monad equipped with an alternative monoid describing the result of a parse.
type ParseResult<T> = type {
  // If this parse has succeeded, build a new parse result with the outcome of
  // passing the current result to the given function. Return the existing
  // result otherwise.
  lift<U>(map : Function<T, U>) -> ParseResult<U>

  // If this parse has succeeded, run the given function with the result and
  // return the outcome. Return the existing result otherwise.
  bind<U>(map : Function<T, ParseResult<U>>) -> ParseResult<U>

  // If this parse has succeeded, run the given action and return the outcome.
  // Return the existing result otherwise.
  then<U>(next : Action<ParseResult<U>>) -> ParseResult<U>

  // If this parse has succeeded, return the existing result, otherwise run the
  // given action and return the outcome..
  else(next : Action<ParseResult<T>>) -> ParseResult<T>
}

def result = object {
  // A successful parse result with the given value.
  class success<T>(value : T) -> ParseResult<T> {
    method lift<U>(map : Function<T, U>) -> ParseResult<U> {
      success(map.apply(value))
    }

    method bind<U>(map : Function<T, ParseResult<U>>) -> ParseResult<U> {
      map.apply(value)
    }

    method then<U>(next : Action<ParseResult<U>>) -> ParseResult<U> {
      next.apply
    }

    method else(_ : Action<ParseResult<T>>) -> ParseResult<T> {
      self
    }
  }

  // A failed parse result.
  class failure<T> -> ParseResult<T> {
    method lift<U>(_ : Function<T, U>) -> ParseResult<U> {
      failure
    }

    method bind<U>(_ : Function<T, ParseResult<U>>) -> ParseResult<U> {
      failure
    }

    method then<U>(_ : Action<ParseResult<U>>) -> ParseResult<U> {
      failure
    }

    method else(next : Action<ParseResult<T>>) -> ParseResult<T> {
      next.apply
    }
  }
}

// Set of basic parsers.
def parser = object {
  // Expect the given value as the next token.
  method expect(value : String)
         from(tokens : lexer.TokenStream)
         -> ParseResult<String> {
    def current = tokens.currentToken

    if (current == value) then {
      tokens.advance
      result.success(value)
    } else {
      result.failure("Expected {value}, but found {current}")
    }
  }

  // Expect an identifier as the next token.
  method identifierFrom(tokens : lexer.TokenStream) -> ParseResult<String> {
    def current = tokens.currentToken

    if (current.isWord) then {
      tokens.advance
      result.success(current)
    } else {
      result.failure
    }
  }

  method symbolFrom(tokens : lexer.TokenStream) -> ParseResult<String> {
    def current = tokens.currentToken

    if (current.isSymbol) then {
      tokens.advance
      result.success(current)
    } else {
      result.failure
    }
  }

  method numberFrom(tokens : lexer.TokenStream) -> ParseResult<String> {
    def current = tokens.currentToken

    if (current.isNumber) then {
      tokens.advance
      result.success(current)
    } else {
      result.failure
    }
  }
}

// An applicative functor equipped with an alternative monoid describing a
// context-free language.
type Grammar<T> = type {
  // Construct a grammar that maps a function over the outcome of this grammar.
  into<U>(map : Function<T, U>) -> Grammar<U>

  // Construct a grammar that runs this grammar and then the given grammar.
  // The outcome is just the result of the second grammar.
  then<U>(second : Grammar<U>) -> Grammar<U>

  // Construct a grammar that runs this grammar and then the given grammar.
  // The outcome is just the result of this grammar.
  neht<U>(second : Grammar<U>) -> Grammar<T>

  // Construct a grammar that runs this grammar and then the given grammar,
  // then combines the results of each using the given function.
  then<U>(second : Grammar<U>)
    into<V>(combine : Function2<T, U, V>)
    -> Grammar<V>

  // Construct a grammar that runs this grammar, then the second grammar, then
  // the third, then combines the results of each using the given function.
  then<U>(second : Grammar<U>)
    then<V>(third : Grammar<V>)
    into<W>(combine : Function3<T, U, V, W>)
    -> Grammar<W>

  // Construct a grammar that runs this grammar, and if it fails, runs the
  // given grammar instead.
  ||(else : Grammar<T>) -> Grammar<T>

  // Construct a grammar that runs this grammar zero or one times.
  lone -> Grammar<Option<T>>

  // Construct a grammar that runs this grammar zero or more times.
  many -> Grammar<List<T>>

  // Construct a grammar that runs this grammar one or more times.
  some -> Grammar<List<T>>

  // Construct a grammar that runs this grammar one or more times, separated
  // by commas.
  commas -> Grammar<List<T>>

  // Construct a grammar that requires braces around this grammar.
  braces -> Grammar<T>

  // Construct a grammar that requires parentheses around this grammar.
  parens -> Grammar<T>

  // Construct a grammar that requires angle brackets around this grammar.
  angles -> Grammar<T>

  // Construct a grammar that runs this grammar then requires an end of line.
  endLine -> Grammar<T>

  // Run this grammar as a parser over the given token stream.
  parse(tokens : lexer.TokenStream) -> ParseResult<T>
}

def grammar = object {
  class from(tokens : lexer.TokenStream) -> Grammar<T> {
    class into<U>(map : Function<T, U>) -> Grammar<U> {
      inherits grammar

      method parse(tokens : lexer.TokenStream) -> U {
        outer.parse(tokens).lift(map)
      }
    }

    class then<U>(second : Grammar<U>) -> Grammar<U> {
      inherits grammar

      method parse(tokens : lexer.TokenStream) -> U {
        outer.parse(tokens).then {
          second.parse(tokens)
        }
      }
    }

    class neht<U>(second : Grammar<U>) -> Grammar<T> {
      inherits grammar

      method parse(tokens : lexer.TokenStream) -> T {
        outer.parse(tokens).bind { result ->
          second.parse(tokens).lift { _ ->
            result
          }
        }
      }
    }

    class then<U>(second : Grammar<U>)
          into<V>(combine : Function2<T, U, V>)
          -> Grammar<V> {
      inherits grammar

      method parse(tokens : lexer.TokenStream) -> V {
        outer.parse(tokens).bind { firstResult ->
          second.parse(tokens).lift { secondResult ->
            combine.apply(firstResult, secondResult)
          }
        }
      }
    }

    class then<U>(second : Grammar<U>)
          then<V>(third : Grammar<V>)
          into<W>(combine : Function3<T, U, V, W>)
          -> Grammar<W> {
      inherits grammar

      method parse(tokens : lexer.TokenStream) -> ParseResult<W> {
        outer.parse(tokens).bind { firstResult ->
          second.parse(tokens).bind { secondResult ->
            third.parse(tokens).lift { thirdResult ->
              combine.apply(firstResult, secondResult, thirdResult)
            }
          }
        }
      }
    }

    class ||(else : Grammar<T>) -> Grammar<T> {
      inherits grammar

      method parse(tokens : lexer.TokenStream) -> ParseResult<T> {
        outer.parse(tokens).else {
          else.parse(tokens)
        }
      }
    }

    class lone -> Grammar<Option<T>> {
      inherits grammar<Option<T>>

      method parse(tokens : lexer.TokenStream) -> ParseResult<Option<T>> {
        outer.parse(tokens).lift { result ->
          option.some(result)
        }.else {
          result.success(option.none)
        }
      }
    }

    class many -> Grammar<List<T>> {
      inherits grammar<List<T>>

      method parse(tokens : lexer.TokenStream) -> ParseResult<List<T>> {
        outer.parse(tokens).bind { result ->
          parse(tokens).bind { rest ->
            list.with(result) ++ rest
          }
        }.else {
          list.empty
        }
      }
    }

    class some -> Grammar<List<T>> {
      inherits grammar<List<T>>

      method parse(tokens : lexer.TokenStream) -> ParseResult<List<T>> {
        outer.parse(tokens).bind { result ->
          parse(tokens).bind { rest ->
            list.with(result) ++ rest
          }.else {
            list.with(result)
          }
        }
      }
    }

    class commas -> Grammar<List<T>> {
      inherits outer.then(literal(",").then(outer).many)
                     into { head, tail ->
        list.with(head) ++ tail
      }
    }

    class wrappedIn(l : String, r : String) -> Grammar<T> is confidential {
      inherits grammar

      method parse(tokens : lexer.TokenStream) -> T {
        parser.expect(l) from(tokens).then {
          outer.parse(tokens).bind { result ->
            parser.expect(r) from(tokens).then {
              result
            }
          }
        }
      }
    }

    class braces -> Grammar<T> {
      inherits wrappedIn("{", "}")
    }

    class parens -> Grammar<T> {
      inherits wrappedIn("(", ")")
    }

    class angles -> Grammar<T> {
      inherits wrappedIn("<", ">")
    }
  }
}

class literal(value : String) -> Grammar<String> {
  inherits grammar

  method parse(tokens : lexer.TokenStream) -> String {
    parser.expect(value) from(tokens)
  }
}

class numberLiteral -> Grammar<String> {
  inherits grammar

  method parse(tokens : lexer.TokenStream) -> String {
    def init = parser.numberFrom(tokens)
    parser.on "." do {
      return init ++ "." ++ parser.numberFrom(tokens)
    }
  }
}

class stringLiteral -> Grammar<String> {
  inherits grammar

  method parse(tokens : lexer.TokenStream) -> String {
    parser.expect("\"") from(tokens)
    parser.charactersUntil("\"") from(tokens)
    parser.expect("\"") from(tokens)
  }
}
