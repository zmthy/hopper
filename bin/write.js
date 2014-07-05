"use strict";

var Task, rt, sys;

sys = require("sys");

Task = require("../lib/task");
rt = require("../lib/runtime");

function toString(value) {
  return rt.apply(value, value.asString, [[]]).then(function (value) {
    return rt.String.assert(value).then(function () {
      return rt.apply(value, value.asPrimitiveString, [[]]);
    });
  }).then(null, function (packet) {
    // The object can't be stringified, so it can't be added to the trace.
    packet.object.stackTrace.push(rt.trace("asString", null));
    throw packet;
  });
}

function writeGreen(value) {
  sys.puts("\x1b[0;32;48m" + value + " \x1b[0m");
}

function writeRed(value) {
  sys.error("\x1b[0;31;48m" + value + " \x1b[0m");
}

function writeError(error) {
  if (rt.isGraceObject(error)) {
    return toString(error).then(function (string) {
      writeRed(string);

      if (rt.isGraceExceptionPacket(error)) {
        return Task.each(error.object.stackTrace, function (trace) {
          return Task.resolve("\tat ").then(function (line) {
            if (typeof trace === "string") {
              return line + trace;
            }

            return Task.resolve(line + "«" + trace.name + "»")
              .then(function (line) {
                if (trace.object !== null) {
                  return toString(trace.object).then(function (string) {
                    return line + " in «" +
                      string.replace(/\n/g, "\n\t") + "»";
                  });
                }

                return line;
              }).then(function (line) {
                var loc = trace.location;

                if (loc !== null) {
                  if (loc.module !== null) {
                    line += ' from "' + loc.module + '"';
                  }

                  line += " (line " + loc.line + ", column " + loc.column + ")";
                }

                return line;
              });
          }).then(function (line) {
            sys.error(line);
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

