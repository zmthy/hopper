import "iterator" as iterator

type Iterator<T> = iterator.Iterator<T>

type Token = type {
  kind -> TokenKind
  value -> String
}

def isWord = { char -> char.isLetter || char.isDigit || char == "'" }

def isDigit = { char -> char.isDigit || char.isLetter }

def puncSymbols =
  list.with("-", "&", "|", ":", "%", "^", "@", "?", "*", "/", "+", "!")

def isSymbol = { char -> char.isSymbol || puncSymbols.contains(char) }

def tokens = object {
  // Transform an iterator of characters into an iterator of tokens.
  class fromIterator(source : Iterator<Character>) -> Iterator<Token> {
    inherits fromPeekIterator(iterator.peek.fromIterator(source))
  }

  // Transform a peek iterator of characters into an iterator of tokens.
  class fromPeekIterator(source : PeekIterator<Character>) -> Iterator<Token> {
    inherits iterator.abstract

    method isExhausted -> Boolean {
      source.isExhausted
    }

    method ifNext<T>(onNext : Function<Token, T>)
           else<U>(onElse : Function<Token, U>)
           -> T | U {
      source.ifPeek { char ->
        // Decide which kind of token to produce based on the character class of
        // the first character.
        onNext.apply(if (char.isLetter) then {
          lexIdentifier
        } elseIf { char.isNumber } then {
          lexNumber
        } elseIf { char.isSymbol } then {
          lexSymbol
        } elseIf { char == "." } then {
          lexPeriod
        })
      } else(onElse)
    }

    method buildWhile(condition : Function<Character, Boolean>)
           -> String
           is confidential {
      var string : String := ""

      source.while(condition) do { char ->
        string := string ++ char
      }

      string
    }

    method lexIdentifier -> Token is confidential {
      token.identifier(buildWhile(isWord))
    }

    method lexNumber -> Token is confidential {
      def digits = buildWhile(isDigit)

      source.ifPeekEquals "x" then {
        // TODO Raise appropriate error if this fails.
        def base = number.parse(digits) inBase 10
        token.number(consumeIntegerInBase(base)) inBase(digits)
      } elseIfEquals "." then {
        def fractional = consumeInteger

        source.ifEquals "e" then {
          token.number(digits)
                withFractional(fractional)
                andExponent(consumeInteger)
        } else {
          token.number(digits)
                withFractional(fractional)
        }
      } elseIfEquals "e" then {
        token.number(digits) withExponent(consumeInteger)
      } else {
        token.number(digits)
      }
    }

    method lexSymbol -> Token is confidential {
      token.symbol(buildWhile(isSymbol))
    }

    method consumeInteger -> String is confidential {
      consumeIntegerInBase 10
    }

    method consumeIntegerInBase(base : Number) -> String is confidential {
      
    }
  }
}
