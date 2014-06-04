// Provides the 'lex' function, which transforms a string into a list of tokens,
// preparing it for parsing.

"use strict";

var keywords, matches, puncSymbols, unicode;

unicode = require("./unicode");

keywords =
  ["class", "def", "dialect", "inherits", "is",
    "method", "object", "return", "self", "super", "type", "var"];

puncSymbols = ["-", "&", "|", ":", "%", "^", "@", "?", "*", "/", "+", "!"];

function contains(list, value) {
  var i, l;

  for (i = 0, l = list.length; i < l; i += 1) {
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

// new Token(type : String, value : String, indent : Number = undefined)
function Token(type, value, indent) {
  this.type  = type;
  this.value = value;

  if (typeof indent === "number") {
    this.indent = indent;
  }
}

Token.prototype.toString = function () {
  return this.type === "newline" ? "new line" : this.value;
};

function Lexer(text, index) {
  this.text = text;
  this.index = index || 0;
  this.length = text.length;
}

Lexer.prototype.nextToken = function (interpolating) {
  var c, e, escaped, dot, i, l, lexer, text, token, value;

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
    var d;

    j = j || i;
    d = text[j];

    if (d === "\r") {
      if (text[j + 1] !== "\n") {
        throw "Invalid Unicode character \\r without corresponding \\n";
      }

      // Adjust text accordingly.
      i += 1;
      c = "\r\n";

      return true;
    }

    return d === "\n";
  }

  function countSpaces() {
    var count = 0;

    while (text[i + 1] === " ") {
      count += 1;
      i += 1;
    }

    return count;
  }

  function handleNewline() {
    var spaces;

    // Consecutive newlines are irrelevant. Remove them and any intervening
    // whitespace.
    do {
      spaces = countSpaces();
      i += 1;
    } while (testNewline(i));

    return update(new Token("newline", c, spaces));
  }

  lexer = this;
  i = this.index;
  l = this.length;

  text = this.text;
  c = text[i];

  if (!interpolating) {
    while (c === " ") {
      i += 1;
      c = text[i];
    }
  }

  if (i >= l) {
    return new Token("eot", "end of input");
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
  } else if (isSymbol(c) || (c === "." && text[i + 1] === ".")) {
    token = new Token("symbol", c);
  } else {
    if (unicode.isPunctuation(c)) {
      return increment(new Token("punctuation", c));
    }

    if (testNewline()) {
      return handleNewline();
    }

    if (c === "\t") {
      throw "Invalid Unicode character \\t: tabs are banned";
    }

    throw "Unrecognised Unicode character " + unicode.nameOf(c);
  }

  // After an interpolation, the current character is the start of the remaining
  // string, and is not used above. Otherwise the current character has been
  // used above to decide which kind of token to lex and should be skipped.
  if (!interpolating) {
    i += 1;
  }

  while (i < l) {
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
        i += 1;
        c = text[i];
      } else if (/[eE]/.test(c) && !e) {
        e = dot = true;
        token.value += c;
        i += 1;
        c = text[i];
      } else if (token.value === "0") {
        if (/[xX]/.test(c)) {
          dot = true;
          token.value += c;
          i += 1;
          c = text[i];
        } else {
          throw "Leading zero on number";
        }
      }

      if (unicode.isNumber(c) ||
          (/[xX]/.test(token.value[1]) && /[a-fA-F]/.test(c))) {
        token.value += c;
      } else {
        c = token.value[token.value.length - 1];

        if (/[eExX]/.test(c)) {
          throw "Dangling modifier on number " + token.value;
        }

        if (c === ".") {
          // The dot is for a method call, not a decimal point. Re-lex it.
          token.value = token.value.substring(0, token.value.length - 1);
          i -= 1;
        }

        return update();
      }
    } else if (token.type === "symbol") {
      if (c === "/" && token.value === "/") {
        while (!testNewline() && i < l) {
          c = text[i];
          i += 1;
        }

        return handleNewline();
      }

      value = token.value;
      if (isSymbol(c) || (c === "." && value[value.length - 1] === ".")) {
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
          token.value += "\b";
        } else if (c === "f") {
          token.value += "\f";
        } else if (c === "v") {
          token.value += "\v";
        } else if (c === "0") {
          token.value += "\u0000";
        } else if (c === "u") {
          c = text.substr(i + 1, 4);

          if (c.length < 4 || !/[0-9a-fA-F]/.test(c)) {
            throw "Invalid Unicode reference value " + c;
          }

          token.value += String.fromCharCode("0x" + c);
          i += 4;
        } else {
          throw "Unrecognised escape character \\" + c;
        }
      } else {
        if (c === '"') {
          // Ignore the close quote.
          token.interpolation = false;
          return increment();
        }

        if (c === "{") {
          // Interpolation time!
          token.interpolation = true;
          return increment();
        }

        if (c !== "\\") {
          token.value += c;
        }
      }

      escaped = !escaped && c === "\\";
    }

    i += 1;
  }

  // The text failed to close a string.
  if (token.type === "string") {
    throw "Unclosed string \"" + unicode.escape(token.value);
  }

  // We should only be able to get here if token is set.
  return update();
};

Lexer.prototype.clone = function () {
  return new Lexer(this.text, this.index);
};

exports.Lexer = Lexer;
exports.isSymbol = isSymbol;

