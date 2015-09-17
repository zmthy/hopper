// Provides the 'lex' function, which transforms a string into a list of tokens,
// preparing it for parsing.

"use strict";

var error, puncSymbols, tokens, unicode, util;

error = require("./error");
tokens = require("./tokens");
unicode = require("../unicode");
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

Lexer.prototype.raise = function (message) {
  error.raise({
    "location": {
      "line": this.line(),
      "column": this.column()
    }
  }, message);
};

Lexer.prototype.newToken = function (Constructor) {
  var args = util.slice(arguments, 1);

  args.push({
    "line": this.line(),
    "column": this.column()
  });

  return util.newApply(Constructor, args);
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
  var c, dot, e, escaped, i, l, self, spaced, text, token, value, x;

  function raise(message) {
    self.index = i;
    self.raise(message);
  }

  function update(result) {
    self.index = i;
    return (result || token).validate(self);
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

  // Test if the current character is a newline.
  function testNewline() {
    c = text[i];

    if (c === "\r") {
      if (text[i + 1] !== "\n") {
        raise("Invalid Unicode character «\\r» without corresponding «\\n»");
      }

      // Adjust text accordingly.
      i += 1;
      c = "\r\n";

      return true;
    }

    return c === "\n" || c === "\u2028";
  }

  function countSpaces() {
    var count = 0;

    while (text[i] === " ") {
      count += 1;
      i += 1;
    }

    return count;
  }

  function handleNewline() {
    var old, spaces;

    old = null;

    // Consecutive newlines are irrelevant. Remove them and any intervening
    // whitespace.
    do {
      i += 1;
      spaces = countSpaces();

      // Ignore comments.
      if (text[i] === "/" && text[i + 1] === "/") {
        if (old !== null) {
          spaces = old;
        }

        while (i < l && !testNewline()) {
          i += 1;
        }
      }
    } while (testNewline());

    return update(self.newToken(tokens.Newline, spaces));
  }

  // This is called when a error with a control character is present in a
  // string, but we want to finish lexing the rest of the string so that it can
  // be reported in the resulting error.
  function futureControlError(message, offending) {
    if (token.validate === tokens.StringLiteral.prototype.validate) {
      token.validate = function (lexer) {
        lexer.raise(message + " «" + offending + "» in " + this);
      };
    }
  }

  self = this;
  i = this.index;
  l = this.length;

  text = this.text;
  c = text[i];

  spaced = c === " ";

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

  if (!interpolating && c === "/" && text[i + 1] === "/") {
    i -= 1;
    return handleNewline();
  }

  // Pick which token to create based on the current character.
  if (c === '"' || interpolating) {
    token = this.newToken(tokens.StringLiteral, "");
    escaped = false;
  } else if (unicode.isLetter(c) || c === "…") {
    token = this.newToken(tokens.Identifier, c);
  } else if (unicode.isNumber(c)) {
    dot = false;
    e = false;
    x = false;
    token = this.newToken(tokens.NumberLiteral, c);
  } else if (isSymbol(c) || c === "." && text[i + 1] === ".") {
    token = this.newToken(tokens.Symbol, c, spaced);
  } else {
    if (unicode.isPunctuation(c)) {
      return increment(this.newToken(tokens.Punctuation, c, spaced));
    }

    if (testNewline()) {
      return handleNewline();
    }

    if (c === "\t") {
      raise("Invalid tab character: tabs are banned");
    }

    raise("Unrecognised character «" + util.escape(c) + "»");
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
      // Identifier continuations are letters, numbers, apostrophe, primes, and
      // ellipsis.
      if (unicode.isLetter(c) || unicode.isNumber(c) ||
          c === "'" || c === "′" || c === "″" || c === "‴" || c === "…") {
        token.value += c;
      } else {
        return update();
      }
    } else if (token.constructor === tokens.NumberLiteral) {
      if (!e) {
        if (!dot && !x && /[xX.]/.test(c)) {
          if (c === ".") {
            dot = true;
          } else {
            x = true;
          }

          step();
        } else if (/[eE]/.test(c)) {
          e = true;
          step();

          if (c === "+" || c === "-") {
            step();
          }
        }
      }

      if (c && (unicode.isNumber(c) || x && /[a-zA-Z]/.test(c))) {
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
      value = token.value;
      if (isSymbol(c) || c === "." && value[value.length - 1] === ".") {
        token.value += c;
      } else {
        return update();
      }
    } else if (token.constructor === tokens.StringLiteral) {
      if (c === "\n") {
        raise("Missing close quote for " + token);
      } else if (unicode.isControl(c)) {
        token.value += "\ufffd";
        futureControlError("Invalid control character", util.escape(c));
      } else if (escaped) {
        if (new RegExp('["\\\\{}]').test(c)) {
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
          c = text.substr(i + 1, 4).match(/^[0-9a-fA-F]+/);
          c = c && c[0] || "";

          if (c.length < 4) {
            token.value += "\ufffd";

            futureControlError("Invalid Unicode literal value", "\\u" + c);
          } else {
            token.value += String.fromCharCode("0x" + c);
          }

          i += c.length;
        } else {
          futureControlError("Unrecognised escape character", "\\" + c);
          token.value += "\ufffd";
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
    raise("Missing close quote for " + token);
  }

  // We should only be able to get here if token is set.
  return update();
};

exports.Lexer = Lexer;
exports.isSymbol = isSymbol;
