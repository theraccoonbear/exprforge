# Emitting several functions as one file

`emit(fn, lang)` produces one standalone unit: the file header, the imports and
support helpers that one function uses, and the function. `emitFile(fns, lang)`
produces one complete source file for an ordered list of functions:

```js
const { emitFile } = require("exprforge");

const { ext, source } = emitFile([fn1, fn2, fn3], "qb64");
fs.writeFileSync(`spline.${ext}`, source);
```

The file has, in this order:

1. the target's header comment, once;
2. the target's mandatory file structure, once (see the table below);
3. every import the file uses, once each, where the target requires them;
4. every support helper the file uses, once each, with the helpers they call,
   dependencies first;
5. the functions, in the order given.

Imports and helpers are selected over the whole file, so a helper that three
functions need is defined once, and an import needed only by the last function
still lands at the top of the file. Function names must be unique, and the list
must not be empty. Suites (`outputs()`) are accepted like any other definition.

`emitFile(fns, lang, registry, opts)` takes the same `registry` and `opts` as
`emit`, plus `wrapperName` (below). Inside a session, `session.emitFile(fns,
lang, opts)`. A file of one function is the same as `emit` for every target
except those with a wrapper (Java, C#, Fortran, MATLAB/Octave), where the file
form always uses the wrapper.

## Removed in 0.10.0

Before `emitFile`, callers assembled multi-function files by hand with
`opts.includeHelpers`, a shared `opts.emittedHelpers` Set, Go's
`opts.forceMathImport` and Java's `opts.publicClass`. All four are removed:
passing any of them to `emit`, `emitFunction` or `emitFile` throws an error
that points here. A single `emit` still emits exactly what its function uses.

## Layout per target

| Target | File structure |
|---|---|
| Go | `package exprforge` once, then every `import` before the first declaration (Go requires this), then the functions. |
| Java | One `public final class` named by `opts.wrapperName` (default `ExprForge`) holding every function as a static method; save the file as `<wrapperName>.java`. A suite's nested result type is named `<Fn>Result` in a file, so two suites don't collide. |
| C# | One `public static class` named by `opts.wrapperName` (default `ExprForge`) holding every function. |
| Fortran | One `module` named by `opts.wrapperName` (default `ExprForge`), `implicit none`, `contains`, then every function and subroutine. Callers `use` the module and get explicit interfaces. |
| COBOL | One `>>SOURCE FORMAT FREE` line, the `ef-cmp-*` `FUNCTION-ID` helpers the file uses once each, then one `PROGRAM-ID` per function. Each program keeps its own `REPOSITORY` paragraph naming the helpers it calls: that is a per-program declaration, not a definition. |
| QB64 | Header, the `ef_safe_*` helper `FUNCTION`s once each, then the `FUNCTION`/`SUB` definitions. Place the file before the main program code, as for a single function. |
| Perl | `use strict; use warnings;`, the `use` lines once, the helper `sub`s, the functions, then a single `1;` at the very end. |
| PHP | `<?php` once at the top. |
| Python | `import math` once at the top, the helper `def`s, then the functions. |
| Ruby | The helper `def`s (`_ef_*`) once each, then the functions. |
| C | `#include <math.h>` once at the top when anything uses it, then the functions. |
| Zig | `const std = @import("std");` once at the top when anything uses it, then the functions. |
| Rust | The functions. Items need no import (`f64::` is in the prelude). |
| MATLAB/Octave | With more than one function, a leading `1;` makes the file an Octave script file that `source()` loads in full; the functions follow, then the `ef_*` local helper functions once each. MATLAB exposes only the first function of a file to callers, so a MATLAB library should call `emitFile` with a single function once per `.m` file. |
| Lua, Julia, R, Scheme, JS, TypeScript | Header once, then the functions. TypeScript functions are `export`ed. JS functions are plain top-level declarations. |
| expr | The `fn` definitions concatenated: this is the `.expr` file format, so `loadExprSource` reads the result back, and a later function may use an earlier one as a macro. |
| LaTeX | Each function becomes its own equation, one after another. With `wrap: "document"` the file is one document (one `\documentclass`, one `document` environment) holding one display block per function. |

No target rejects `emitFile`: every row above has a meaningful multi-function
form. A target that cannot emit one of the functions (for example an unmapped
primitive) throws that error from `emitFile` as it would from `emit`.

## Helpers and imports: used-only

Targets with support helpers (Python, Perl, Ruby, MATLAB/Octave, QB64, COBOL)
emit only the helper definitions the generated code calls, plus the helpers
those call. A pure-arithmetic function such as a lerp has no helper
definitions. The selection is `selectHelpers` in `emitters/base.js` over each
emitter's `helpers` map (`name -> { source, deps }`).

Imports follow the same rule over each emitter's `imports` map
(`name -> { source, pattern }`); a pattern is matched against the file's code
plus the sources of the helpers it pulls in.

| Target | Import | Written when the code references |
|---|---|---|
| Python | `import math` | `math.` |
| Perl | `use POSIX ();` | `POSIX::` |
| Perl | `use List::Util ();` | `List::Util::` |
| C | `#include <math.h>` | any `<math.h>` function, macro or `M_*` constant (list in `emitters/c.js`); always, when an extern's template is used |
| Zig | `const std = @import("std");` | `std.` |
| Go | `import "math"` | `math.` |

Language-mandatory scaffolding stays unconditional: Perl's `use strict;`,
`use warnings;` and `1;`, PHP's `<?php`, Go's `package`, COBOL's divisions,
Fortran's `implicit none` and every header comment. Targets that name library
members fully qualified without a file-level import (Java and C# `Math`, Rust
`f64::`, Julia, Lua, R, PHP, Scheme, MATLAB/Octave, QB64, COBOL intrinsic
functions, JS/TS `Math`) have no import to prune.

## How a target defines its file

An emitter's `formatFunction`/`formatSuite` return only the text of one
function. The emitter's `header` and `frame` configuration (see the config
comment in `emitters/base.js`) assemble the file from the per-function texts
and the selected imports and helpers. A target that declares `helpers` or
`imports` must supply a `frame`.

Which targets assemble their own file is read from the registry, not
declared twice: <!-- exprforge:list:file-framed -->QB64, C, Java, Go, C#, Python, Perl, Ruby, Fortran, Zig, COBOL, and MATLAB/Octave<!-- /exprforge --> configure a
`frame`; <!-- exprforge:list:file-unframed -->JavaScript, TypeScript, Rust, Lua, PHP, Julia, R, and Scheme<!-- /exprforge --> are the header
followed by the functions, concatenated.

## Tests

`test/multi-function-files.test.js` compiles or runs a real file for every
target with an available toolchain. `test/emit-file.test.js` iterates the
registry and asserts, for every emitter, that a file of three functions sharing
a helper and an import defines each exactly once. See the README's
"Several functions in one file" section for a usage example.
