// The ParseError definition and the 'raise' helper, which are used by both the
// lexer and the parser.

"use strict";

var util = require("../util");

function ParseError(token, message) {
  this.message = message;
  this.line = token.location.line;
  this.column = token.location.column;
}

util.inherits(ParseError, Error);

ParseError.prototype.toString = function () {
  return "ParseError: " + this.message;
};

function raise(token, message) {
  throw new ParseError(token, message);
}

exports.ParseError = ParseError;
exports.raise = raise;
