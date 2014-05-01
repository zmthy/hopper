// Provides the 'lex' function, which transforms a string into a list of tokens,
// preparing it for parsing.

"use strict";

var keywords, matches, puncSymbols, unicode, whitespace, undefined;

unicode = require("./unicode");

keywords = "class def dialect method object return var".split(" ");
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
  var c, i, l, token, tokens;

  tokens = [];

  // The current token has finished. Push and reset the token, and deincrement
  // the index to reprocess the current character.
  function pushToken() {
    tokens.push(token);
    token = undefined;
    i--;
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
      } else if (c === "\n" || c === "\r" && tokens[++i] === "\n") {
        tokens.push(new Token("newline", "\n"));
      } else if (c !== " ") {
        throw new Error("Unrecognised Unicode character " + unicode.nameOf(c));
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
  if (tokens[tokens.length - 1].type !== "newline") {
    tokens.push(new Token("newline", "EOF"));
  }

  return tokens;
};

// new Token(type : String, value : String)
function Token(type, value) {
  this.type  = type;
  this.value = value;
}

Token.prototype = {
  toString: function() {
    return this.type === "newline" ? "new line" : this.value;
  }
};

exports.lex = lex;
exports.isSymbol = isSymbol;

