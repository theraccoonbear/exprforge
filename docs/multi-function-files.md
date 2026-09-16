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
| QB64 | `SAFE_MATH_HELPERS` (5 `FUNCTION`s) | `opts.includeHelpers: false` on every call after the first | Real consumer report (PR #37) |
| COBOL | `CMP_HELPER_SOURCE` (6 `FUNCTION-ID`s) | `opts.includeHelpers: false` on every call after the first (NOT `CMP_REPOSITORY` — that's a per-program reference, not a shared definition, and stays on every program that uses `cmp()`/`select()`) | Found proactively, auditing the same bug class after the QB64 report |
| Go | `package exprforge` + `import "math"` | `opts.includeHelpers: false` on every call after the first; `opts.forceMathImport: true` on the FIRST call if ANY of the concatenated functions use a math primitive (Go requires every import before any other declaration — a later function's own usage can't add one after the fact) | Found proactively |
| Zig | `const std = @import("std");` | `opts.includeHelpers: false` on every call after the first (safe unconditionally — confirmed an unused top-level `const`, unlike a local one, isn't an error in Zig) | Found proactively |
| PHP | the `<?php` opening tag | `opts.includeHelpers: false` on every call after the first | Found proactively |
| Java | `public final class <Name>` | `opts.publicClass: false` on every call except ONE (Java allows at most one *public* top-level type per file; a package-private class is still fully callable from another class in the same file/package) | Found proactively |

## Already correct — verified, not assumed

C, Rust, Python, Perl, Lua, Julia, Scheme, TypeScript, Fortran, and C#
have no file-level declaration that repeats per function (multiple
`def`/`function`/`fn`/`sub`/`class` in one file is each language's own
normal, unremarkable structure). Verified directly against a real
compiler/interpreter (see `test/multi-function-files.test.js`), not
just assumed from reading the emitter source — the whole point of this
audit was that "obviously fine" isn't evidence.

## Example (QB64)

```js
const { emit } = require("exprforge");

const out1 = emit(fn1, "qb64").source;                                  // helpers included (default)
const out2 = emit(fn2, "qb64", undefined, { includeHelpers: false }).source; // helpers omitted
const out3 = emit(fn3, "qb64", undefined, { includeHelpers: false }).source;

fs.writeFileSync("spline.bi", [out1, out2, out3].join("\n"));
```

See `test/multi-function-files.test.js` for a real, compiled/executed
example of every target in the table above, and `emitters/base.js`'s own
`emitFunction` doc comment for the underlying `opts` threading.
