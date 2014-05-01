// Provides the 'lex' function, which transforms a string into a list of tokens,
// preparing it for parsing.

"use strict";

var keywords, matches, puncSymbols, unicode, whitespace, undefined;

unicode = require("./unicode");

keywords = "class def dialect inherits method object return var".split(" ");
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

// Lex code text into a token list.
function lex(text) {
  var c, i, l, spaces, token, tokens;

  tokens = [];

  // The current token has finished. Push and reset the token, and deincrement
  // the index to reprocess the current character.
  function pushToken() {
    tokens.push(token);
    token = undefined;
    i--;
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

  for (i = 0, l = text.length; i < l; i++) {
    c = text[i];

    // Token change: begin the new token and continue.
    if (token === undefined) {
      // Letters begin identifiers and keywords.
      if (unicode.isLetter(c)) {
        token = new Token("identifier", c);
      } else if (unicode.isNumber(c)) {
        token = new Token("number", c);
      } else if (isSymbol(c)) {
        token = new Token("symbol", c);
      } else if (unicode.isPunctuation(c)) {
        tokens.push(new Token("punctuation", c));
      } else if (testNewline()) {
        // Consecutive newlines are irrelevant. Remove them and any intervening
        // whitespace.
        while (spaces = countSpaces(), testNewline(i + 1)) {
          i++;
        }

        tokens.push(new Token("newline", c, spaces));
      } else if (c === "\t") {
        throw "Invalid Unicode character \\t: tabs are banned";
      } else if (c !== " ") {
        throw "Unrecognised Unicode character " + unicode.nameOf(c);
      }

      continue;
    }

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

        pushToken();
      }
    } else if (token.type === "number") {
      if (unicode.isNumber(c) || unicode.isLetter(c)) {
        token.value += c;
      } else {
        pushToken();
      }
    } else if (token.type === "symbol") {
      if (isSymbol(c)) {
        token.value += c;
      } else {
        pushToken();
      }
    }
  }

  // Tidy up final token if it wasn't processed.
  if (token !== undefined) {
    tokens.push(token);
  }

  // EOF counts as a newline.
  if (tokens.length > 0 && tokens[tokens.length - 1].type !== "newline") {
    tokens.push(new Token("newline", "EOF"));
  }

  return tokens;
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

exports.lex = lex;
exports.isSymbol = isSymbol;

