#!/usr/bin/env node

// Generates the unicode.js file to avoid requiring the full set of Unicode data
// at runtime.

var categories, category, fs, i, id, l, out, points;

fs = require("fs");

categories =
  ["Control", "Letter", "Number", "Punctuation", "Separator", "Symbol"];

out = '"use strict";\n';

for (i = 0, l = categories.length; i < l; i += 1) {
  category = categories[i];
  id = category === "Separator" ? "Z" : category[0];
  points = require("unicode-7.0.0/categories/" + id + "/regex");
  out += "exports.is" + category +
      " = function (c) {\n  return " + points + ".test(c);\n};\n";
}

fs.writeFile("lib/unicode.js", out);
