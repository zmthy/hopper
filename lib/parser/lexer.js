// Provides the 'lex' function, which transforms a string into a list of tokens,
// preparing it for parsing.

"use strict";

var error, puncSymbols, tokens, unicode, util;

error = require("./error");
tokens = require("./tokens");
unicode = require("./unicode");
util = require("../util");

puncSymbols = ["-", "&", "|", ":", "%", "^", "@", "?", "*", "/", "+", "!"];

function isSymbol(c) {
  return unicode.isSymbol(c) || util.contains(puncSymbols, c);
}

function Lexer(text) {
  this.text = text;
  this.index = 0;
  this.length = text.length;

  util.makeCloneable(this, "index");
}

Lexer.prototype.error = function (message) {
  error.raise({
    location: {
      line: this.line(),
      column: this.column()
    }
  }, message);
};

Lexer.prototype.newToken = function (Ctor, value) {
  if (value === undefined) {
    return new Ctor({
      line: this.line(),
      column: this.column()
    });
  }

  return new Ctor(value, {
    line: this.line(),
    column: this.column()
  });
};

Lexer.prototype.line = function () {
  var match = this.text.substring(0, this.index).match(/\n/g);

  if (match === null) {
    return 1;
  }

  return match.length + 1;
};

Lexer.prototype.column = function () {
  var text = this.text.substring(0, this.index);

  return text.substring(text.lastIndexOf("\n") + 1).length + 1;
};

Lexer.prototype.nextToken = function (interpolating) {
  var c, e, escaped, dot, i, l, lexer, text, token, value;

  function error(message) {
    lexer.index = i;
    lexer.error(message);
  }

  function update(result) {
    lexer.index = i;
    return (result || token).validate(lexer);
  }

  function increment(result) {
    i += 1;
    return update(result);
  }

  function step() {
    token.value += c;
    i += 1;
    c = text[i];
  }

  // Test if the current character, or the character at the given index, is a
  // newline.
  function testNewline(j) {
    var d;

    j = j || i;
    d = text[j];

    if (d === "\r") {
      if (text[j + 1] !== "\n") {
        error("Invalid Unicode character «\\r» without corresponding «\\n»");
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

    return update(lexer.newToken(tokens.Newline, spaces));
  }

  function futureControlError(msg) {
    var esc;

    if (token.validate !== tokens.StringLiteral.prototype.validate) {
      esc = unicode.escape(c);

      token.validate = function (lexer) {
        lexer.error(msg + " «" + esc + "» in " + this);
      };
    }
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

    this.index = i;
  }

  if (i >= l) {
    return this.newToken(tokens.EndOfInput);
  }

  // Pick which token to create based on the current character.
  if (c === '"' || interpolating) {
    token = this.newToken(tokens.StringLiteral, "");
    escaped = false;
  } else if (unicode.isLetter(c)) {
    token = this.newToken(tokens.Identifier, c);
  } else if (unicode.isNumber(c)) {
    token = this.newToken(tokens.NumberLiteral, c);
    dot = false;
  } else if (isSymbol(c) || (c === "." && text[i + 1] === ".")) {
    token = this.newToken(tokens.Symbol, c);
  } else {
    if (unicode.isPunctuation(c)) {
      return increment(this.newToken(tokens.Punctuation, c));
    }

    if (testNewline()) {
      return handleNewline();
    }

    if (c === "\t") {
      error("Invalid tab character: tabs are banned");
    }

    error("Unrecognised Unicode character «" + unicode.nameOf(c) + "»");
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
    if (token.constructor === tokens.Identifier) {
      // Identifier continuations are letters, numbers, apostrophe and prime.
      if (unicode.isLetter(c) || unicode.isNumber(c) ||
          c === "'" || c === "′") {
        token.value += c;
      } else {
        return update();
      }
    } else if (token.constructor === tokens.NumberLiteral) {
      if (c === "." && !dot) {
        dot = true;
        step();
      } else if (/[eE]/.test(c) && !e) {
        e = true;
        dot = true;
        step();

        if (c === "+" || c === "-") {
          step();
        }
      } else if (token.value === "0" && /[xX]/.test(c)) {
        dot = true;
        step();
      }

      if (unicode.isNumber(c) ||
          (/[xX]/.test(token.value[1]) && /[a-fA-F]/.test(c))) {
        token.value += c;
      } else {
        c = token.value[token.value.length - 1];

        if (c === ".") {
          // The dot is for a method call, not a decimal point. Re-lex it.
          token.value = token.value.substring(0, token.value.length - 1);
          i -= 1;
        }

        return update();
      }
    } else if (token.constructor === tokens.Symbol) {
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
    } else if (token.constructor === tokens.StringLiteral) {
      if (c === "\n") {
        error("Missing close quote for " + token);
      } else if (unicode.isControl(c)) {
        futureControlError("Invalid control character");
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
            futureControlError("Invalid Unicode reference value");
          }

          token.value += String.fromCharCode("0x" + c);
          i += 4;
        } else {
          futureControlError("Unrecognised escape character");
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
  if (token.constructor === tokens.StringLiteral) {
    error("Missing close quote for " + token);
  }

  // We should only be able to get here if token is set.
  return update();
};

exports.Lexer = Lexer;
exports.isSymbol = isSymbol;

