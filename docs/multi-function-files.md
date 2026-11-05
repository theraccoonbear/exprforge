# Concatenating multiple emitted functions into one file

`emitFunction`'s default output assumes one function per compiled unit.
Every conformance sample in this repo, until now, only ever compiled one
function per binary — a real gap, only found when a consumer reported it
(see the "Found by" note on each target below).

A real, common pattern this project didn't originally support: a
consumer emitting N functions for the same target and concatenating them
into ONE file (one `.bi`/`.cob`/`.go`/etc. per *program*, not per
function) — e.g. a spline-path tool emitting 21 QB64 functions into one
`.bi` file. Several targets have some kind of always-on, per-function
preamble (an import, a package clause, an opening tag, a shared helper
block) that's safe to repeat within its OWN function's output but
becomes a duplicate/conflicting declaration once two functions' outputs
are concatenated — the target's compiler then rejects the file outright.

## The fix, per target

Every fix below is opt-in and backward compatible: the default output
(no `opts`, or `opts` without the relevant key) is byte-for-byte
identical to before this existed.

| Target | What repeats | Fix | Found by |
|---|---|---|---|
| QB64 | the `ef_safe_*` helper `FUNCTION`s the function calls | one shared `opts.emittedHelpers` Set across all calls (see "Helpers: used-only, defined once" below) | Real consumer report (PR #37) |
| COBOL | the `ef-cmp-*` `FUNCTION-ID`s the program calls (NOT the `REPOSITORY` entries — those are a per-program reference, not a shared definition, and stay in every program that uses `cmp()`/`select()`) | one shared `opts.emittedHelpers` Set across all calls | Found proactively, auditing the same bug class after the QB64 report |
| Go | `package exprforge` + `import "math"` | `opts.includeHelpers: false` on every call after the first; `opts.forceMathImport: true` on the FIRST call if ANY of the concatenated functions use a math primitive (Go requires every import before any other declaration — a later function's own usage can't add one after the fact) | Found proactively |
| Zig | `const std = @import("std");`, only when the function uses `std.` | one shared `opts.emittedHelpers` Set across all calls (see "Imports: used-only, written once" below); `opts.includeHelpers: false` still drops the import from a call, so it is only safe when an earlier call in the file imported `std` | Found proactively |
| PHP | the `<?php` opening tag | `opts.includeHelpers: false` on every call after the first | Found proactively |
| Python | `_exprforge_div` helper `def` (see ADR 0004), only when a division needs it | one shared `opts.emittedHelpers` Set across all calls | Added with the division-by-zero fix |
| Perl | `_exprforge_div` helper `sub` (see ADR 0004), only when a division needs it | one shared `opts.emittedHelpers` Set across all calls (a repeat triggers a "Subroutine redefined" warning) | Added with the division-by-zero fix |
| Java | `public final class <Name>` | `opts.publicClass: false` on every call except ONE (Java allows at most one *public* top-level type per file; a package-private class is still fully callable from another class in the same file/package) | Found proactively |

| MATLAB/Octave | the `ef_*` local helper functions the function calls | one shared `opts.emittedHelpers` Set across all calls. Unlike the other rows, the default (one function per file, helpers inside it) is the natural MATLAB layout; the shared Set is only for putting several functions in one file, where MATLAB exposes just the first function and Octave needs a leading `1;` to `source()` the rest | Designed in, verified in `test/multi-function-files.test.js` |

## Helpers: used-only, defined once

Targets with support helpers (Python, Perl, MATLAB/Octave, QB64, COBOL)
emit only the helper definitions the generated code actually calls, plus
the helpers those call. A pure-arithmetic function such as a lerp has no
helper definitions at all. The selection is `Emitter.usedHelpers()` in
`emitters/base.js` over each emitter's `helpers` map
(`name -> { source, deps }`).

For a multi-function file, pass ONE shared `Set` as `opts.emittedHelpers`
to every call. Each call defines the helpers it uses that are not yet in
the Set (and adds them), so the file ends up with the union of used
helpers, each defined exactly once, at its first use:

```js
const emittedHelpers = new Set();
const out = fns.map((fn) => emit(fn, "qb64", undefined, { emittedHelpers }).source).join("\n");
```

`opts.includeHelpers: false` still means "define no helpers in this
call". It is no longer a safe way to share helpers between functions,
because the first function may not use a helper a later one needs; use
the shared Set. A function emitted on its own (no Set) is self-contained.

## Imports: used-only, written once

Imports follow the same rule as helpers: generated code carries only the
imports it uses. A lerp has none. The selection is
`Emitter.usedImports()` in `emitters/base.js` over each emitter's
`imports` map (`name -> { source, pattern }`); a pattern is matched against
the function's code plus the sources of the helpers it pulls in (the
division helper needs `math.nan` in Python and `POSIX::copysign` in Perl).

| Target | Import | Written when the code references |
|---|---|---|
| Python | `import math` | `math.` |
| Perl | `use POSIX ();` | `POSIX::` |
| Perl | `use List::Util ();` | `List::Util::` |
| C | `#include <math.h>` | any `<math.h>` function, macro or `M_*` constant (list in `emitters/c.js`); always, when an extern's template is used |
| Zig | `const std = @import("std");` | `std.` (the `@floor`, `@abs`, `@mod`, ... builtins and the `@as(f64, ...)` literals need no import) |
| Go | `import "math"` | `math.` (still limited to the call that carries the package clause, see above) |

Language-mandatory scaffolding stays unconditional: Perl's `use strict;`,
`use warnings;` and `1;`, PHP's `<?php`, Go's `package`, COBOL's divisions,
Fortran's `implicit none` and every header comment. Targets that name
library members fully qualified without a file-level import (Java and C#
`Math`, Rust `f64::`, Julia, Lua, R, PHP, Scheme, MATLAB/Octave, QB64,
COBOL intrinsic functions, JS/TS `Math`) have no import to prune.

For a multi-function file the shared `opts.emittedHelpers` Set also records
written imports (as `import:<name>`), so each is written once, at the first
function that needs it, wherever that function is in the file. Python, Perl,
C and Zig all accept an import after earlier function definitions. Go does
not, which is why it keeps `forceMathImport`.

## Already correct — verified, not assumed

C, Rust, Lua, Julia, R, Scheme, TypeScript, Fortran, and C#
have no file-level declaration that repeats per function (multiple
`def`/`function`/`fn`/`sub`/`class` in one file is each language's own
normal, unremarkable structure). Verified directly against a real
compiler/interpreter (see `test/multi-function-files.test.js`), not
just assumed from reading the emitter source — the whole point of this
audit was that "obviously fine" isn't evidence.

## LaTeX

The LaTeX target's default output (`wrap: "none"`) and the `"inline"`,
`"display"` and `"equation"` wrappers concatenate fine: each is
self-contained math. `wrap: "document"` is a complete file with its own
`\documentclass` and `document` environment, so concatenating several
of them is not valid LaTeX. Use `"none"` or `"display"` for multi-function
files. See the README's "Typeset output (LaTeX)" section.

## Example (QB64)

```js
const { emit } = require("exprforge");

const emittedHelpers = new Set();
const out1 = emit(fn1, "qb64", undefined, { emittedHelpers }).source;
const out2 = emit(fn2, "qb64", undefined, { emittedHelpers }).source;
const out3 = emit(fn3, "qb64", undefined, { emittedHelpers }).source;

fs.writeFileSync("spline.bi", [out1, out2, out3].join("\n"));
```

See `test/multi-function-files.test.js` for a real, compiled/executed
example of every target in the table above, and `emitters/base.js`'s own
`emitFunction` doc comment for the underlying `opts` threading.
