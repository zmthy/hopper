Hopper
======

A simple JavaScript AST-walking interpreter for the Grace programming language.

## Command-line

```shell
hopper [FILENAME]
```

Accepts an optional source file as an argument. If left off, the interactive
REPL will load instead. Use the `-h` flag for information about extra arguments.

## Library

```javascript
var hopper = require("hopper");

hopper.interpret(grace, callback);
```

The `interpret` method accepts Grace code as a string, and a Node style
callback.

In order to interpret multiple chunks of code with preserved state, construct a
new `Interpreter` and invoke `interpret` on that instead.

You can also directly load and interpret an external module.

```javascript
hopper.load(path, callback);
```

Module resolution is controlled by an optional module loader argument, with a
default that uses the Node.js file system interface.

## Licensing

Copyright (C) 2014-2015 Timothy Jones

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with
this program. If not, see <http://www.gnu.org/licenses/gpl>.
