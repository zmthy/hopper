// The various lexer token definitions.

"use strict";

var keywords, unicode, util;

unicode = require("../unicode");
util = require("../util");

keywords = [
  "class", "constructor", "def", "dialect", "false",
  "import", "inherits", "is", "method", "object", "outer",
  "return", "self", "super", "true", "type", "var"
];

function isKeyword(value) {
  return util.contains(keywords, value);
}

// new Token(value : String, location : Location, type : String = undefined)
function Token(value, location, type) {
  this.value = value;
  this.location = location;

  if (type !== undefined) {
    this.type = type;
  }
}

Token.prototype.validate = function (lexer) {
  if (this.value.length === 0) {
    lexer.raise("Empty token of type " + this.type);
  }

  return this;
};

Token.prototype.toString = function () {
  return "the " + this.type + " " + this.value;
};

// new Newline(indent : Number)
function Newline(indent, location) {
  Token.call(this, "\n", location);

  this.indent = indent;
}

util.inherits(Newline, Token);

Newline.prototype.toString = function () {
  return "a new line";
};

Newline.toString = Newline.prototype.toString;

// new Keyword(value : String, location : Location)
function Keyword(value, location) {
  Token.call(this, value, location, "keyword");
}

util.inherits(Keyword, Token);

Keyword.prototype.toString = function () {
  return "the keyword «" + this.value + "»";
};

Keyword.toString = function () {
  return "a keyword";
};

// new Identifier(value : String, location : Location)
function Identifier(value, location) {
  Token.call(this, value, location, "identifier");
}

util.inherits(Identifier, Token);

Identifier.prototype.validate = function (lexer) {
  if (isKeyword(this.value)) {
    return new Keyword(this.value, this.location).validate(lexer);
  }

  return Token.prototype.validate.call(this, lexer);
};

Identifier.prototype.toString = function () {
  return "the identifier «" + this.value + "»";
};

Identifier.toString = function () {
  return "an identifier";
};

// new Symbol(value : String, location : Location)
function Symbol(value, spaced, location) {
  Token.call(this, value, location, "symbol");

  this.spaced = spaced;
}

util.inherits(Symbol, Token);

Symbol.toString = function () {
  return "a symbol";
};

function Punctuation(value, spaced, location) {
  Symbol.call(this, value, spaced, location);
}

util.inherits(Punctuation, Token);

Punctuation.toString = function () {
  return "punctuation";
};

// new NumberLiteral(value : String, location : Location)
function NumberLiteral(value, location) {
  Token.call(this, value, location, "number");
}

util.inherits(NumberLiteral, Token);

NumberLiteral.prototype.validate = function (lexer) {
  var base, i, l, last, value, x;

  value = this.value;

  if (value[0] === "0" &&
      value.length > 1 && unicode.isNumber(value[1])) {
    lexer.raise("Leading zero on " + this);
  }

  x = value.match(/[xX]/);
  base = 10;

  if (x !== null && x.index !== value.length - 1) {
    base = Number(value.substring(0, x.index));

    if (base === 0) {
      base = 16;
    }

    if (base < 2 || base > 36 || isNaN(base)) {
      lexer.raise(base + " is not a valid numerical base");
    }

    for (i = x.index + 1, l = value.length; i < l; i += 1) {
      if (isNaN(parseInt(value[i], base))) {

        lexer.raise("'" + value[i] + "' is not a valid digit in base " + base);
      }
    }
  } else {
    last = value[value.length - 1];

    if (/[eExX\+\-]/.test(last)) {
      lexer.raise("Dangling modifier on " + this);
    }

    if (last === ".") {
      lexer.raise("Dangling decimal point on " + this);
    }
  }

  return Token.prototype.validate.call(this, lexer);
};

NumberLiteral.prototype.toString = function () {
  return "the number literal " + this.value;
};

NumberLiteral.toString = function () {
  return "a number";
};

// new StringLiteral(value : String, location : Location)
function StringLiteral(value, location) {
  Token.call(this, value, location, "string");
}

util.inherits(StringLiteral, Token);

StringLiteral.prototype.validate = function () {
  // Do not validate: an empty string is permissible.
  return this;
};

StringLiteral.prototype.toString = function () {
  return 'the string literal "' + util.escape(this.value) + '"';
};

StringLiteral.toString = function () {
  return "a string";
};

// new EndOfInput(location : Location)
function EndOfInput(location) {
  Token.call(this, "end of input", location, "eoi");
}

util.inherits(EndOfInput, Token);

EndOfInput.prototype.toString = function () {
  return "the end of input";
};

EndOfInput.toString = EndOfInput.prototype.toString;

exports.Token = Token;
exports.Newline = Newline;
exports.Keyword = Keyword;
exports.Identifier = Identifier;
exports.Symbol = Symbol;
exports.Punctuation = Punctuation;
exports.NumberLiteral = NumberLiteral;
exports.StringLiteral = StringLiteral;
exports.EndOfInput = EndOfInput;
