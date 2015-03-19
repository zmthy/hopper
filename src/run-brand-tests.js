#!/usr/bin/env node

"use strict";

var fs, hopper, i, interpreter;

fs = require("fs");
hopper = require("../lib/hopper");

interpreter = new hopper.Interpreter();

function pad(n) {
  if (n.toString().length === 1) {
    return "0" + n;
  }

  return n;
}

function run(i) {
  var fname = "test-brands" + pad(i);
  console.log("\n*** " + fname + " ***\n");
  console.log(fs.readFileSync(fname + ".grace").toString());

  interpreter.load(fname, function (error) {
    if (error) {
      console.error(error.toString());
    }

    if (i !== 16) {
      run(i + 1);
    }
  });
}

run(1);
