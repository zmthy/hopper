"use strict";

var CheckResult, Task, rt;

Task = require("../lib/task");
rt = require("../lib/runtime");

CheckResult = require("../lib/hopper").CheckResult;

function toString(value) {
  if (!rt.isGraceObject(value)) {
    return Task.resolve(value.toString());
  }

  return rt.apply(value, value.asString, [[]]).then(function (string) {
    return rt.String.assert(string).then(function () {
      return rt.apply(string, string.asPrimitiveString, [[]]);
    });
  }).then(null, function (packet) {
    // The object can't be stringified, so it can't be added to the trace.
    packet.object.stackTrace.push(rt.trace("asString", null));
    throw packet;
  });
}

function writeGreen(value) {
  console.log("\x1b[0;32;48m" + value + " \x1b[0m");
}

function writeRed(value) {
  console.error("\x1b[0;31;48m" + value + " \x1b[0m");
}

function writeError(error) {
  var isCheckResult = error.constructor === CheckResult;

  if (rt.isGraceObject(error) || isCheckResult) {
    return toString(error).then(function (string) {
      var stackTrace;

      writeRed(string);

      if (rt.isGraceExceptionPacket(error) || isCheckResult) {
        stackTrace = isCheckResult ?
          error.stackTrace : error.object.stackTrace;

        return Task.each(stackTrace, function (trace) {
          return Task.resolve("\t").then(function (line) {
            if (trace.name !== null) {
              return line + "at «" + trace.name + "» ";
            }

            return line;
          }).then(function (line) {
            if (trace.object !== null) {
              return toString(trace.object).then(function (object) {
                return line + "in «" +
                  object.replace(/\n/g, "\n\t") + "» ";
              });
            }

            return line;
          }).then(function (line) {
            var loc = trace.location;

            if (loc !== null) {
              if (loc.module !== null) {
                line += 'from "' + loc.module + '" ';
              }

              line += "(line " + loc.line + ", column " + loc.column + ")";
            }

            return line;
          }).then(function (line) {
            console.error(line.replace(/\s+$/g, ""));
          });
        });
      }
    }).then(null, function () {
      writeRed("Internal Error: Failed to render exception");
    });
  }

  writeRed("Internal Error: " + (error.message || error));

  return Task.resolve();
}

function writeValue(value) {
  if (rt.isGraceObject(value)) {
    return toString(value).then(writeGreen, writeError);
  }

  if (value === null || value === undefined) {
    writeRed("Internal Error: the expression resulted in " + value);
  } else {
    writeGreen(value.toString());
  }

  return Task.resolve();
}

exports.writeError = writeError;
exports.writeValue = writeValue;
