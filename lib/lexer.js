// Provides the 'lex' function, which transforms a string into a list of tokens,
// preparing it for parsing.

"use strict";

var keywords, matches, puncSymbols, unicode, undefined;

unicode = require("./unicode");

keywords =
  "class def dialect inherits is method object return type var".split(" ");
puncSymbols = "-&|:%^@?*/+!".split("");

function contains(list, value) {
  var i, l;

  for (i = 0, l = list.length; i < l; i++) {
    if (list[i] === value) {
      return true;
    }
  }

  return false;
}

function isKeyword(value) {
  return contains(keywords, value);
}

function isSymbol(c) {
  return unicode.isSymbol(c) || contains(puncSymbols, c);
}

function Lexer(text, index) {
  this.text = text;
  this.index = index || 0;
  this.length = text.length;
}

Lexer.prototype = {
  constructor: Lexer,

  nextToken: function(interpolating) {
    var c, e, escaped, dot, i, l, lexer, spaces, text, token;

    function update(result) {
      lexer.index = i;
      return result || token;
    }

    function increment(result) {
      lexer.index = i + 1;
      return result || token;
    }

    // Test if the current character, or the character at the given index, is a
    // newline.
    function testNewline(j) {
      var d = text[j = j || i];

      if (d === "\r") {
        if (text[j + 1] !== "\n") {
          throw "Invalid Unicode character \\r without corresponding \\n";
        }

        // Adjust text accordingly.
        i++;
        c = "\r\n";

        return true;
      }

      return d === "\n";
    }

    function countSpaces() {
      var count = 0;

      while (text[i + 1] === " ") {
        count++;
        i++;
      }

      return count;
    }

    lexer = this;
    i = this.index;
    l = this.length;

    if (i === l) {
      // Add a final newline at the end of the file.
      this.index++;
      return new Token("newline", "\n", 0);
    } else if (i > l) {
      return new Token("eot", "end of input");
    }

    text = this.text;
    c = text[i];

    if (interpolating) {
      // When interpolating, the current character is the start of the string.
      // It shouldn't be used in the token start logic.
      i--;
    } else {
      while (c === " ") {
        c = text[++i];
      }
    }

    // Pick which token to create based on the current character.
    if (c === '"' || interpolating) {
      token = new Token("string", "");
      escaped = false;
    } else if (unicode.isLetter(c)) {
      token = new Token("identifier", c);
    } else if (unicode.isNumber(c)) {
      token = new Token("number", c);
      dot = false;
    } else if (isSymbol(c)) {
      token = new Token("symbol", c);
    } else if (unicode.isPunctuation(c)) {
      return increment(new Token("punctuation", c));
    } else if (testNewline()) {
      // Consecutive newlines are irrelevant. Remove them and any intervening
      // whitespace.
      do {
        spaces = countSpaces();
      } while (testNewline(i++ + 1));

      return update(new Token("newline", c, spaces));
    } else if (c === "\t") {
      throw "Invalid Unicode character \\t: tabs are banned";
    } else if (c !== " ") {
      throw "Unrecognised Unicode character " + unicode.nameOf(c);
    }

    for (i++; i < l; i++) {
      c = text[i];

      // Token existing: decide what to do depending on the current token.
      if (token.type === "identifier") {
        // Identifier continuations are letters, numbers, apostrophe and prime.
        if (unicode.isLetter(c) || unicode.isNumber(c) ||
            c === "'" || c === "′") {
          token.value += c;
        } else {
          // Check if the token is a keyword, and adjust its type accordingly.
          if (isKeyword(token.value)) {
            token.type = "keyword";
          }

          return update();
        }
      } else if (token.type === "number") {
        if (c === "." && !dot) {
          dot = true;
          token.value += c;
          c = text[++i];
        } else if (/[eE]/.test(c) && !e) {
          e = dot = true;
          token.value += c;
          c = text[++i];
        } else if (token.value === "0") {
          if (/[xX]/.test(c)) {
            dot = true;
            token.value += c;
            c = text[++i];
          } else {
            throw "Leading zero on number";
          }
        }

        if (unicode.isNumber(c) ||
            /[xX]/.test(token.value[1]) && /[a-fA-F]/.test(c)) {
          token.value += c;
        } else {
          c = token.value[token.value.length - 1];

          if (/[eExX]/.test(token.value[token.value.length - 1])) {
            throw "Dangling modifier on number " + token.value;
          } else {
            if (c === ".") {
              token.value = token.value.substring(0, token.value.length - 2);
              i--;
            }

            return update();
          }
        }
      } else if (token.type === "symbol") {
        if (isSymbol(c)) {
          token.value += c;
        } else {
          return update();
        }
      } else if (token.type === "string") {
        if (unicode.isControl(c)) {
          throw "Invalid control character in string";
        }

        if (escaped) {
          if (/["\\\\{}]/.test(c)) { //"]) {
            token.value += c;
          } else if (c === "n") {
            token.value += "\n";
          } else if (c === "t") {
            token.value += "\t";
          } else if (c === "r") {
            token.value += "\r";
          } else if (c === "b") {
            token.value += "\b"
          } else if (c === "f") {
            token.value == "\f";
          } else if (c === "v") {
            token.value += "\v";
          } else if (c === "0") {
            token.value += "\0";
          } else if (c === "u") {
            c = text.substr(i + 1, 4);

            if (c.length < 4 || /[^0-9a-fA-F]/.test(c)) {
              throw "Invalid Unicode reference value " + c;
            }

            token.value += String.fromCharCode("0x" + c);
            i += 4;
          } else {
            throw "Unrecognised escape character \\" + c;
          }
        } else if (c === '"') {
          // Ignore the close quote.
          token.interpolation = false;
          return increment();
        } else if (c === "{") {
          // Interpolation time!
          token.interpolation = true;
          return increment();
        } else if (c !== "\\") {
          token.value += c;
        }

        escaped = !escaped && c === "\\";
      }
    }

    // The text failed to close a string.
    if (token.type === "string") {
      throw "Unclosed string \"" + unicode.escape(token.value);
    }

    // We should only be able to get here if token is set.
    return update();
  },

  clone: function() {
    return new Lexer(this.text, this.index);
  }
};

// new Token(type : String, value : String, indent : Number = undefined)
function Token(type, value, indent) {
  this.type  = type;
  this.value = value;

  if (typeof indent === "number") {
    this.indent = indent;
  }
}

Token.prototype = {
  toString: function() {
    return this.type === "newline" ? "new line" : this.value;
  }
};

exports.Lexer = Lexer;
exports.isSymbol = isSymbol;

