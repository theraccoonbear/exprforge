# ExprForge 🔢🔨

![ExprForge — a blacksmith forging 3a² + 2ab − b² = (a+b)² − 2ab on a glowing anvil](https://raw.githubusercontent.com/theraccoonbear/exprforge/main/assets/expression-forge.png)

[![npm version](https://img.shields.io/npm/v/exprforge.svg)](https://www.npmjs.com/package/exprforge)
[![TypeScript](https://github.com/theraccoonbear/exprforge/actions/workflows/test-typescript.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-typescript.yml)
[![Python](https://github.com/theraccoonbear/exprforge/actions/workflows/test-python.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-python.yml)
[![C#](https://github.com/theraccoonbear/exprforge/actions/workflows/test-csharp.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-csharp.yml)
[![Lua](https://github.com/theraccoonbear/exprforge/actions/workflows/test-lua.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-lua.yml)
[![QB64](https://github.com/theraccoonbear/exprforge/actions/workflows/test-qb64.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-qb64.yml)
[![C](https://github.com/theraccoonbear/exprforge/actions/workflows/test-c.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-c.yml)
[![Java](https://github.com/theraccoonbear/exprforge/actions/workflows/test-java.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-java.yml)
[![Go](https://github.com/theraccoonbear/exprforge/actions/workflows/test-go.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-go.yml)
[![Rust](https://github.com/theraccoonbear/exprforge/actions/workflows/test-rust.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-rust.yml)
[![Perl](https://github.com/theraccoonbear/exprforge/actions/workflows/test-perl.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-perl.yml)
[![PHP](https://github.com/theraccoonbear/exprforge/actions/workflows/test-php.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-php.yml)
[![Julia](https://github.com/theraccoonbear/exprforge/actions/workflows/test-julia.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-julia.yml)
[![Fortran](https://github.com/theraccoonbear/exprforge/actions/workflows/test-fortran.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-fortran.yml)
[![Zig](https://github.com/theraccoonbear/exprforge/actions/workflows/test-zig.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-zig.yml)
[![Scheme](https://github.com/theraccoonbear/exprforge/actions/workflows/test-scheme.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-scheme.yml)
[![COBOL](https://github.com/theraccoonbear/exprforge/actions/workflows/test-cobol.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-cobol.yml)
[![Test Coverage](https://github.com/theraccoonbear/exprforge/actions/workflows/test-coverage.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-coverage.yml)
[![VS Code Syntax](https://github.com/theraccoonbear/exprforge/actions/workflows/test-vscode-syntax.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-vscode-syntax.yml)

## Brief

ExprForge authors a math formula once, as a small AST, and emits
verified, identical-behavior implementations in JavaScript, TypeScript,
Python, C#, Lua, QB64, C, Java, Go, Rust, Perl, PHP, Julia, Fortran, Zig,
Scheme (Guile), and COBOL (GnuCOBOL) — plus a native in-process
evaluator and a printer for its own readable syntax. No required
dependencies.

**[▶ Try it live](https://theraccoonbear.github.io/exprforge/)** — write
a formula in the browser and watch it emitted across every target
language at once, no install required, or switch to the Differentiation
tab to get a formula's derivative and a numeric spot-check side by side.
Runs the real, current library (see `playground/`), not a frozen demo
build.

Every open pull request also gets its own live preview of the
playground, deployed automatically to
`https://theraccoonbear.github.io/exprforge/pr-<N>/` and linked in a
comment on the PR (see `.github/workflows/deploy-pr-preview.yml`).

Writing `.expr`/`.fn` in your own editor? See [Editor support](#editor-support)
below for real VS Code/VSCodium syntax highlighting.

## Motivation

This grew out of a real, recurring problem in a larger multi-language
system (internally: SSS) that needed the *same* math to be true in
several independently-deployed pieces written in different languages at
once — not "translate this code," but "prove these N implementations of
one formula actually agree," which is a narrower, checkable claim.
Codegen tools like SymPy already turn expressions into code for
mainstream languages; this exists for the two things that leaves open:

- Targets like QB64/BASIC or COBOL that no general codegen project
  reaches at all.
- A conformance harness that actually *proves* the emitted targets agree
  numerically, compiled and run for real — not just that they compile.

Two shapes of real use this tends to fall into:

- **Keeping concurrent codebases in sync.** A client/server split (game
  client prediction + authoritative server, or any two independently
  deployed services) where both sides need to compute the *same* formula
  and disagree — desync, or a cheat signal — the moment they drift. One
  AST, not two hand-maintained implementations that quietly diverge.
- **De-risking a migration.** Replacing an older implementation (a COBOL
  batch job, a Fortran numerical kernel) with a new one doesn't require
  trusting a manual port — emit the same formula into both the legacy
  target and the new one, and let the conformance suite prove they agree
  before cutover, not after.

## Intents

**What it does**: turns one small, pure-arithmetic AST into
identical-behavior source text for 16 real target languages, a native
evaluator, and its own readable printer — all from the same tree, walked
once per target. Symbolic differentiation (`differentiate`) works over
that same AST too, so a derivative is just another tree, emittable and
evaluable exactly the same way.

**What it deliberately won't do** — not gaps waiting on a future
release, but a boundary held on purpose everywhere in this project:

- **No control flow.** No loops, no branches, no generated function
  calling another generated function *at runtime*. This is an
  expression AST, not a program AST. `loadMacro`/`loadExpr` (see below)
  let one definition reference another, but only by inline expansion at
  build time, resolved in declaration order — never a real call, never
  recursion (which would need a stack this library doesn't have), never
  a call graph.
- **No RNG.** Can't be made to produce identical output across
  languages, so it isn't offered as if it could.
- **No arbitrary precision / complex numbers.** `float64` only, for now.

**What it is not**: a general transpiler ("translate my code for me").
It's narrower and more checkable than that — "prove two independent
implementations of one formula actually match."

**Trust only the layer you need.** Everything below is genuinely
layered, and the layers don't reach back into each other:

- **The AST and its emitters are the whole value proposition, and the
  entire dependency graph.** `ast.js`'s builders (`num`, `v`, `add`,
  `mul`, `letIn`, `select`, `outputs`, ...) build a plain tree of plain
  objects; every `emitters/<lang>.js` file turns that tree into
  target-language source text. Every emitter requires only
  `emitters/base.js` and `ast.js` — nothing else in this repo. No
  parser, no custom syntax, no interpreter sits between your AST and the
  code it emits. The library worked exactly this way for its first two
  published releases, before anything below existed.
- **`expr`/`fn`/macros — optional authoring sugar**, all the way up to
  the flashiest multi-function syntax below. Every layer of sugar turns
  into *exactly* the same tree the raw builders would — checked by
  structural unit tests and a full print-reparse-evaluate round trip
  across every sample this project has (see "Testing"), not just
  asserted. It's genuinely optional: nothing in the AST/emitter layer
  calls into or imports any of it. Don't want a parser in your
  dependency graph, for a security review or otherwise? Don't call
  `expr`/`fn`/`loadMacro` — build the tree with the plain functions
  instead, and every emitter behaves identically either way.
- **The native evaluator and the `expr`-syntax printer are additive
  conveniences** that sit off to the side the same way — nothing else
  depends on them either.

If you only care about "does this correctly turn my AST into
COBOL/Java/whatever" — `ast.js` and the one `emitters/<lang>.js` file you
care about are the entire surface that matters. The rest of this README
walks in from the flashiest end first, then works back down toward that
same bottom layer, one step of sugar removed at a time — skip straight
to whichever depth you actually plan to trust.

## Install

```
npm install exprforge
```

## Examples, flashiest first

The showcase feature: several function definitions in one buffer, a
later one referencing an earlier one by name, with dot-field access into
a multi-output result — all inline-expanded at parse time, never a real
runtime call (see "Intents" above for why that distinction is
load-bearing, and "Macros and externs" below for the full mechanism).
This is exactly what the [live playground](https://theraccoonbear.github.io/exprforge/)'s
editor buffer accepts:

```js
const { loadExprSource, evaluate, emit } = require("exprforge");

const defs = loadExprSource(`
macro cross3(ax, ay, az, bx, by, bz):
  let rx = ay * bz - az * by;
  let ry = az * bx - ax * bz;
  let rz = ax * by - ay * bx;
  return { rx, ry, rz };

fn crossLength(ax, ay, az, bx, by, bz):
  let c = cross3(ax, ay, az, bx, by, bz);
  return sqrt(c.rx^2 + c.ry^2 + c.rz^2);
`);

evaluate(defs.crossLength, [1, 0, 0, 0, 1, 0]); // 1
emit(defs.crossLength, "rust").source;          // a real fn crossLength(...) -- no trace of cross3 left
```

Every definition starts with `fn` or `macro` — never optional, never
implied. `fn` means "hand this back to me": `defs.crossLength` exists
because it's marked `fn`. `macro` means "inline this into whatever
references it later in this same buffer, but don't hand it back on its
own": `cross3` is fully usable *inside* `crossLength` — that's the whole
point — but `defs.cross3` doesn't exist; `Object.keys(defs)` here is just
`["crossLength"]`. There's no default either way, on purpose: a helper
you only ever meant as an internal step for something else can't
accidentally end up looking like part of your file's real, callable
output just because nothing said otherwise. Mark it `fn` instead if you
*do* want `cross3` usable standalone too — both marks register the
definition identically for inlining purposes; the only difference is
whether it also lands in what this call returns.

`cross3` never appears in `crossLength`'s emitted output, in any target —
by the time `loadExprSource` returns, `defs.crossLength` is
self-contained arithmetic, `cross3`'s formula copied in and simplified
away. This is also why calling `cross3` from *inside itself* isn't just
discouraged, it's structurally impossible: a definition only becomes
referenceable by whatever's declared *after* it, never by itself —
covered in full under "Macros and externs" below, including exactly what
happens if you try.

This is the top of the sugar. The rest of this README works back down
from here, one layer at a time, showing the *exact same formula* —
cross product magnitude — at each level of undress.

### One layer down: `fn` + `loadMacro`, no file/buffer needed

Same result, without a multi-definition buffer: register `cross3` once
with `loadMacro`, then reference it from an ordinary `fn` template.
`loadExprSource` above is sugar for exactly this loop, run once per
definition in the buffer.

```js
const { loadMacro, fn, evaluate } = require("exprforge");

loadMacro("cross3", fn`
    cross3(ax, ay, az, bx, by, bz):
    let rx = ay * bz - az * by;
    let ry = az * bx - ax * bz;
    let rz = ax * by - ay * bx;
    return { rx, ry, rz };
`);

const crossLength = fn`
    crossLength(ax, ay, az, bx, by, bz):
    let c = cross3(ax, ay, az, bx, by, bz);
    return sqrt(c.rx^2 + c.ry^2 + c.rz^2);
`;

evaluate(crossLength, [1, 0, 0, 0, 1, 0]); // 1
```

### Another layer down: `expr`, hand-inlined, no macro at all

Drop the macro entirely and write the whole thing as one infix
expression — `cross3`'s formula copied in by hand, exactly what the
macro layer above did for you automatically:

```js
const { expr, evaluate } = require("exprforge");

const body = expr`sqrt((ay*bz - az*by)^2 + (az*bx - ax*bz)^2 + (ax*by - ay*bx)^2)`;
const crossLength = { name: "crossLength", params: ["ax", "ay", "az", "bx", "by", "bz"], body };

evaluate(crossLength, [1, 0, 0, 0, 1, 0]); // 1
```

### The bottom: raw AST builders, no parser involved at all

The actual library API — no `expr`/`fn`/macros in the dependency graph
whatsoever, just plain function calls building a plain tree of plain
objects. Everything above compiles down to exactly this shape:

```js
const { v, add, sub, mul, call, letChain, evaluate } = require("exprforge");

const rx = sub(mul(v("ay"), v("bz")), mul(v("az"), v("by")));
const ry = sub(mul(v("az"), v("bx")), mul(v("ax"), v("bz")));
const rz = sub(mul(v("ax"), v("by")), mul(v("ay"), v("bx")));

const crossLength = {
    name: "crossLength",
    params: ["ax", "ay", "az", "bx", "by", "bz"],
    body: letChain(
        [["rx", rx], ["ry", ry], ["rz", rz]],
        call("sqrt", add(mul(v("rx"), v("rx")), mul(v("ry"), v("ry")), mul(v("rz"), v("rz")))),
    ),
};

evaluate(crossLength, [1, 0, 0, 0, 1, 0]); // 1
```

If you're only willing to trust *this* layer — no parser, no macro
expansion, nothing but `ast.js` and one `emitters/<lang>.js` file — this
is the entire surface you need to read. Everything above it is sugar
that provably lowers to this same shape (see "Testing"); nothing below
it exists.

## Usage

```js
const { expr, emit, emitMany } = require("exprforge");

const fn = {
    name: "lerp",
    params: ["a", "b", "t"],
    body: expr`(b - a) * t + a`,
};

console.log(emit(fn, "rust").source);
console.log(emit(fn, "c").source);

// Need several targets at once? emitMany() runs each in isolation --
// one target's failure shows up as { source: null, error } for that
// target alone, not a thrown exception that blanks every other result.
const outputs = emitMany(fn, ["rust", "c", "python"]); // omit langs for every registered target
console.log(outputs.rust.source);
```

## Samples

`samples/` has worked, non-trivial examples (also exported from the
package individually, or together as `samples`):

- `samples/catmull-rom.js` — uniform Catmull-Rom spline interpolation.
- `samples/fibonacci.js` — nth Fibonacci number via Binet's closed form.
  There's no loop/recursion version because exprforge has no control flow
  (see "Intents" above) — this is what "fibonacci" looks like as a pure
  expression.
- `samples/spline-frame.js` — Gram-Schmidt frame construction for spline
  paths (worldUp selection, tangent normalization with a safe-division
  fallback, roll). 4 suites exercising `letIn`/`cmp`/`select`/`outputs` on
  a real-world case — this is the actual motivating use case for those
  node types, not a toy. Used to be 19 separate functions, each
  independently re-deriving the same let-chain (including a `sqrt`) for
  one output; now each related group shares that work once per call.
- `samples/kitchen-sink.js` — not a worked example: a synthetic function
  that calls all 22 supported Math functions in one expression, existing
  purely as a conformance-test fixture. It's what caught Go's and Rust's
  `sign()` disagreeing with everyone else at exactly zero (see "Testing")
  — the other samples between them only ever exercised 5 of the 22.
- `samples/math-demo.js` — also not a worked example: a conformance-test
  fixture exercising every `exprforge/math` helper (see below) in one
  suite.
- `samples/macro-demo.js` — also not a worked example: a conformance-test
  fixture specifically for the `` loadMacro(name, fn`...`) `` AST-function
  tier, proving its internal gensym'd let-renaming produces valid
  identifiers on every real target, not just `evaluate()` (which can't
  see codegen at all — see "Macros and externs").
- `samples/array-index-demo.js` — `cyclicElem`/`clampedElem`, the smallest
  real functions that read through an array-typed parameter via `arr[i]`
  and `wrapIndex`/`clampIndex` (see "Array indexing" below). Not run by
  `npm run build` or wired into `test/conformance.test.js` — the former
  loops every registered emitter unconditionally, including `cobol`,
  which deliberately throws for an array parameter (see below); the
  latter's runners assume scalar-only positional arguments, a real,
  separate piece of follow-up work (see
  `docs/array-index-primitives.md`'s "Not done here" section).

`npm run build` emits the samples above it in this list, for every target
language, into `out/` (see `build.js` for exactly which ones — a couple of
the conformance-only fixtures above aren't included either, for the same
"not everything here is meant to be a build artifact" reason).

## Supported Math functions

`sqrt abs pow sin cos tan asin acos atan atan2 log log2 log10 exp
floor ceil round trunc sign min max hypot`

Add more by extending a target's `calls` table in `emitters/<lang>.js`.
Requesting an unmapped function throws at build time, not silently. Each
one takes exactly 1 argument (everything above `pow`) or 2 (`pow`
onward) — calling one with the wrong count throws too, for every target
including the `expr` printer: unlike an unmapped *name* (which `expr`
prints through unchanged, having no fixed math library of its own to
validate against), a wrong argument *count* is a structurally malformed
call regardless of target, checked unconditionally at the same tier as
`checkUnboundVars` — see `primitives.js`.

### `round()` at exact `.5` boundaries: standardized, NOT your language's native behavior

**If you're reading emitted code and expected `round()` to behave like
your target language's own native rounding function, it doesn't, on 8
of the 18 targets, by deliberate design.** `round(x)` ties **away from
zero** everywhere, unconditionally — `round(-0.5)` is `-1`,
`round(1.5)` is `2`, `round(2.5)` is `3` — identical on every target,
confirmed directly against a real compiler/interpreter for every one of
them (not assumed). This was NOT always true, and if you're used to one
of the languages below, this is the one place ExprForge's output
deliberately does not match what you'd get calling that language's own
rounding function directly:

| If you know... | ...its native tie-breaking is | ...and used to differ from ExprForge's `round()` at |
|---|---|---|
| **JavaScript** (`Math.round`) | ties toward +∞ | `round(-0.5)`: native `-0`/`0`, ExprForge `-1` |
| **TypeScript** (`Math.round`) | ties toward +∞ | same as JS |
| **Java** (`Math.round`) | ties toward +∞ | same as JS |
| **Lua** (`math.floor(x+0.5)`) | ties toward +∞ | same as JS |
| **Python** (`round()`) | ties to even ("banker's") | `round(-1.5)`: native `-2`, ExprForge `-2` — but `round(0.5)`: native `0`, ExprForge `1` |
| **Scheme/Guile** (`round`) | ties to even | same pattern as Python |
| **QB64** (`_ROUND`) | ties to even | same pattern as Python (confirmed against a real compile) |
| **C#** (`Math.Round(double)`) | ties to even (default) | same pattern as Python |

The other 9 targets (C, Rust, Go, Perl, Zig, Fortran, COBOL, Julia, PHP)
already tie away from zero natively, so ExprForge's `round()` matches
what you'd expect from those languages directly — no surprise there.

**Why standardize on away-from-zero specifically, and why now:**
this library's entire value proposition is "author once, get identical
behavior everywhere" — `round()` was the one primitive quietly not
living up to that (three incompatible native conventions, silently
inherited with zero normalization). Away-from-zero was chosen because
it was already the majority (9 of the pre-existing 17 non-JS-family
targets), and because this project's own Julia emitter had already,
independently, made a deliberate choice to match it
(`RoundNearestTiesAway`, not Julia's own ties-to-even default) before
this change existed at all — real precedent, not an arbitrary pick.
Built from `floor`/`sign`/`abs` (which already agreed everywhere) via
`sign(x) * floor(abs(x) + 0.5)`, the same formula `emitters/cobol.js`'s
own hand-written `round` template already used. See
`samples/round-tie-demo.js`'s own header comment for the full,
directly-verified breakdown of what each of the 8 changed targets used
to do, and `test/conformance.test.js`'s `roundTieBoundary` entry for the
permanent regression test proving every target agrees now.

This is a real, deliberate, one-time behavior change on those 8
targets — not configurable, no opt-out. If your use case genuinely
needs a DIFFERENT guaranteed tie-breaking convention (half-up, or
half-to-even) across every target, don't reach for `round()` — compose
it yourself from `floor`/`ceil`/`sign`/`abs` (all of which agree
everywhere) to get the exact behavior you want.

### Domain errors (`sqrt`/`log`/`log2`/`log10`/`asin`/`acos`/`pow`): also unified

An out-of-domain argument (`sqrt` of a negative number, `log` of a
non-positive number, `asin`/`acos` outside `[-1, 1]`, `pow` with a
negative base and a non-integer exponent) now returns `NaN`/`Infinity`
identically on every target — confirmed directly, not assumed, that
this WASN'T true before, and the divergence wasn't just "a different
number":

- **QB64**: the classic `SQR`/`LOG`/`^` don't return NaN at all — they
  **halt the program** ("Illegal function call") and, in any
  non-interactive context (a real compiled game/tool, or a test
  harness), hang forever on an interactive "Continue?" prompt. A crash,
  not a wrong answer.
- **Python**: `math.sqrt`/`log`/`log2`/`log10`/`asin`/`acos`/`pow` all
  **raise `ValueError`**.
- **Perl**: the builtin `sqrt`/`log` (and `log2`, built from `log`)
  **raise a fatal error** ("Can't take sqrt of -1") — `asin`/`acos`
  (via `POSIX`) and `pow` (via `**`) were already fine.
- **Scheme/Guile**: the most dangerous one found — `sqrt`/`log`/`asin`/
  `acos`/`expt` don't crash or return NaN, they silently **promote to a
  complex number** (`(sqrt -1.0)` ⇒ `0.0+1.0i`) — a completely different
  result shape than every other target.
- **GnuCOBOL**: silently returns **`0`** — not NaN, not a crash, just a
  wrong number. Deliberately left as-is rather than guard-fixed: this
  project already found and worked around a real GnuCOBOL codegen bug
  (a fatal `cob_decimal` compiler error) triggered by piling up
  decimal-arithmetic-heavy `IF`-guarded helper functions in one
  compilation unit — exactly the shape a fix for 5 different primitives
  would need, and not worth risking reintroducing that crash for a
  target whose math intrinsics are already documented elsewhere as not
  fully reliable.
- Every other target (JS, TypeScript, C, Rust, Go, Java, Lua, PHP, Zig,
  C#) was already correct — clean IEEE754 NaN/Infinity, never throws.

Fortran is a narrow, deliberate exception: `gfortran` refuses to
*compile* an out-of-domain expression made entirely of literal
constants (e.g. authoring `sqrt(-4)` directly) — confirmed that the
identical value through a runtime variable compiles and returns NaN
correctly. Loud and immediate (a compile error, not a silent wrong
answer or a hang) and avoidable by construction, unlike everything
above — not fixed.

See `samples/domain-safety-demo.js`'s own header comment for the full,
directly-verified breakdown and exactly how each fix works, and
`test/conformance.test.js`'s `domainSafety` entry for the permanent
regression test.

### `min()`/`max()` with a NaN argument: also unified

`min`/`max` given a NaN argument now return NaN on every target,
regardless of which argument it's in — confirmed directly that this
WASN'T true before, and it wasn't just "a different value," it was
often **position-dependent** (which argument silently "wins" depends on
argument order, not any documented rule):

- **C** (`fmin`/`fmax`), **Rust** (`.min()`/`.max()`), **Zig**
  (`@min`/`@max`): NaN-ignoring by spec — the real operand comes back
  regardless of position.
- **Python**, **Lua**, **QB64** (`_MIN`/`_MAX`): position-dependent —
  whichever argument comes **first** silently wins whenever either is
  NaN (comparison-based implementations, and a comparison against NaN
  is always false).
- **PHP**: the same landmine, but the **second** argument wins instead.
- **Perl** (`List::Util::min`/`max`): not even internally consistent —
  `min` is first-wins, `max` is second-wins.
- **GnuCOBOL**: `FUNCTION MAX` at least returns the real operand: `MIN`
  is flatly wrong, returning a literal `0` — neither operand's actual
  value. Deliberately left as-is, same reasoning as the domain-error fix
  above: a real fix needs a new helper `FUNCTION-ID`, the exact shape
  already confirmed to crash GnuCOBOL's codegen when piled up with
  others.
- Every other target (JS, TypeScript, Go, Java, C#, Julia, Scheme,
  Fortran) already propagated NaN correctly.

See `samples/math-edge-cases-demo.js`'s own header comment for the
full, directly-verified breakdown, `test/conformance.test.js`'s
`mathEdgeCases` entry for the permanent regression test, and
[`docs/adr/0003-min-max-nan-propagation.md`](docs/adr/0003-min-max-nan-propagation.md)
for the full decision record.

---

These three normalization decisions (and any future ones like them)
are tracked as a running decision log in
[`docs/adr/`](docs/adr/README.md) — worth checking there directly if
you're debugging something that looks like a cross-target behavior
mismatch.

## Symbolic differentiation (`differentiate`)

```js
const { fn, differentiate, emit, evaluate } = require("exprforge");

const f = fn`
    f(x):
    return x^2 * sin(x);
`;
const df = { name: "df_dx", params: f.params, body: differentiate(f.body, "x") };

console.log(emit(df, "python").source);
console.log(evaluate(df, [Math.PI])); // -π² ≈ -9.8696
```

`differentiate(node, varName)` returns an ordinary AST node — the
symbolic derivative of `node` with respect to `varName` — in the exact
same representation as everything else, so it's emittable to all 18
targets via `emit()`/`emitMany()` and evaluable via `evaluate()`
unchanged. The input is never mutated.

- **Covers every differentiable primitive**: sum/difference/product/
  quotient rule, plus the chain rule for `sqrt abs sin cos tan asin acos
  atan log log2 log10 exp pow atan2 min max hypot` (`pow` picks power
  rule, exponential rule, or the general product-and-chain-rule case,
  depending on which side of `^` actually varies with respect to
  `varName`).
- **`floor ceil round trunc sign` throw** at differentiation time, with a
  clear error naming the offending call — these are piecewise-constant/
  discontinuous primitives with no meaningful derivative, so this fails
  loudly instead of silently producing a wrong AST.
- **Output is simplified, not the raw mechanical rules verbatim.** A
  bottom-up pass folds constant subtrees (`num op num` → `num`) and
  eliminates arithmetic identities (`x + 0`, `x * 1`, `x / 1`, `x^0`,
  `x^1`, `0 - x`) to a fixpoint, so a real formula's derivative doesn't
  come back buried in the `* 1`/`+ 0` swell every mechanical
  product/chain rule application produces.
- **Verified numerically, not hand-checked algebraically** — every rule's
  test asserts the symbolic result against a central-difference
  approximation at several sample points (see `test/differentiate.test.js`),
  the same "proof by running" approach this project already uses for
  round-tripping expr syntax (see "Testing"). That check is JS/`evaluate()`-
  only, though — it can't by itself reveal a target-language mismatch in
  the derivative TREE any more than any other JS-only check could (see
  this project's own comparison-operator-bug history). `differentiate()`'s
  output is now also compiled and run against every real target, the same
  conformance coverage every other sample here gets — see
  `samples/differentiate-demo.js` and `test/conformance.test.js`'s
  `differentiateDemo` entry.

Try it interactively in the [live playground](https://theraccoonbear.github.io/exprforge/)'s
Differentiation tab — enter a formula, see the derivative and a numeric
spot-check side by side.

## Math utilities (`exprforge/math`)

A separate, additive export — `require("exprforge")` is unchanged — of
pre-built compositions of the core AST builders for common 3-D math
patterns, so consumers stop re-implementing the same safe-math and vector
code in every project (`samples/spline-frame.js` had local, hand-rolled
versions of most of these before this module existed).

```js
const { num, v } = require("exprforge");
const { safeDiv, dot3, len3, cross3, normalize3, clamp, EPS } = require("exprforge/math");

// Safe-normalize x component, falling back to 0 near zero length.
safeDiv(v("x"), len3(v("x"), v("y"), v("z")), num(0));
```

- `safeDiv(numerator, denominatorExpr, fallback)` — `numerator /
  denominatorExpr` when `|denominatorExpr| > EPS`, else `fallback`. Clamps
  the denominator before dividing rather than guarding the division
  directly, since `select()` always evaluates both branches (see below).
- `dot3(ax, ay, az, bx, by, bz)` — `ax*bx + ay*by + az*bz`.
- `len3(x, y, z)` — `sqrt(x² + y² + z²)`.
- `cross3(ax, ay, az, bx, by, bz)` — 3-D cross product. Returns a plain JS
  object `{ x, y, z }` of AST nodes (not a Node itself), for destructuring
  into your own `letIn` chain.
- `normalize3(x, y, z, fx?, fy?, fz?)` — safe-normalize; same `{ x, y, z }`
  shape as `cross3`. Falls back to `(fx, fy, fz)` (default `(0, 1, 0)`)
  below `EPS` length. Computes the length once and shares it across all
  three divisions.
- `clamp(val, lo, hi)` — clamps to `[lo, hi]` via nested `select`/`cmp`; no
  runtime intrinsic.
- `EPS` — `num(0.000001)`, the epsilon every guard above uses; exported for
  callers who want the same threshold in their own `cmp()` calls.

What deliberately stays out (project-specific conventions, not general
math): a "near-vertical" world-up check, baked-in-PI degree/radian
conversion, Rodrigues rotation, and a full Gram-Schmidt frame — see
`samples/spline-frame.js` for those, and
`docs/v0.2.0-math-utilities.md` for the full design rationale.

`require("exprforge/math")` also registers every one of these (except
`clamp`) as macros, so they're usable directly inside `fn`/`expr`
template **text**, not just from JS-authoring — see the next section.

## Macros and externs (`loadMacro` / `loadExtern`)

The 22 Math functions above are fixed and built in — call them
**primitives**. `loadMacro`/`loadExtern` register additional names usable
the same way, inside `fn`/`expr` template text (and in `.expr` files, see
`loadExpr` below) — this is the mechanism behind every example in
"Examples, flashiest first" above, with very different guarantees
depending on which one you reach for:

```js
const { loadMacro, fn, evaluate } = require("exprforge");
require("exprforge/math"); // registers dot3/len3/cross3/normalize3/safeDiv as macros

const rodrigues = fn`
    rodrigues(t0x, t0y, t0z, t1x, t1y, t1z):
    let b = cross3(t0x, t0y, t0z, t1x, t1y, t1z);
    let bLen = sqrt(b.x^2 + b.y^2 + b.z^2);
    return bLen;
`;
```

- **`loadMacro(name, def)`** — `def` is a plain JS function
  `(...argNodes) => Node` or `(...argNodes) => { field: Node, ... }`,
  built entirely from existing `ast.js` primitives/other macros
  (`exprforge/math`'s own `dot3`/`len3`/`cross3`/`normalize3`/`safeDiv`
  are registered exactly this way — see `math/index.js`).
  **Inline-expanded** into the caller's AST at build time, never emitted
  as a real call in any target: the emitted output is self-contained
  arithmetic, identical in spirit to writing the expansion out by hand.
  Safe by construction — if `def` returns real `ast.js` Nodes, the result
  is exactly as trustworthy as anything else this library emits. `def`
  can also be an AST function definition directly (e.g. straight out of
  `` fn`...` ``: `` loadMacro("foo", fn`foo(x): return x * 2;`) ``), sugar
  for the same thing — this is exactly how "Examples, flashiest first"
  above registers `cross3`.

  A macro returning multiple named values (like `cross3`'s `{x, y, z}`)
  must be bound with `let` before its fields are readable — `let b =
  cross3(...); b.x` — using it bare inside a larger expression throws a
  clear error rather than guessing which field you meant.

  **Gotcha: the `let` name itself never becomes a real value.** `let b =
  cross3(...);` doesn't bind `b` to anything you can reference bare —
  `b` is consumed entirely as a naming *prefix* for `b`'s flattened
  fields (internally, something like `b__x`/`b__y`/`b__z`). Referencing
  `b` on its own — including accidentally, via `fn`'s own `return { b };`
  shorthand — throws immediately, naming the fields that actually exist:
  `"b" is bound to a multi-output macro result (fields: x, y, z) --
  reference a field directly (e.g. "b.x"), not the bare name`. This is
  easy to trip over precisely because the shorthand return syntax (see
  "Full-program syntax" below) makes `{ b }` look like it should mean
  "the whole thing," the way it would for an ordinary scalar `let`.

  **The classic macro trade-off still applies**: expansion is pure
  substitution, so if a macro's body references one of its own
  parameters more than once, the caller's argument expression gets
  duplicated in the output everywhere that parameter appears — not
  shared, not auto-let-bound (`safeDiv`'s own doc comment above already
  flags exactly this for its twice-referenced `denominatorExpr`; it's
  general to every macro now, not one helper). Pass an already-let-bound
  `v(name)` as the argument instead of a raw expensive expression if that
  duplication matters to you.

- **`loadExtern(name, def)`** — `def` is a plain per-target mapping
  object instead of a function, e.g.
  `` { evaluate: (x) => ..., js: ([x]) => `myLib.f(${x})`, zig: ([x]) => `mylib.f(${x})` } ``.
  A **real native call**, same mechanism as the 22 built-in primitives —
  just supplied by you instead of shipped here. Only the targets you provide a
  key for resolve; every other target still throws "no mapping" for that
  name, same as an unmapped primitive. **ExprForge can't verify the named
  symbol actually exists in a given target, or that it behaves
  identically across every target you register a mapping for — that's
  entirely on you**, the same way linking an unfamiliar library is in any
  other compiled language. Reach for this only when the math genuinely
  can't be expressed by composing existing macros/primitives; prefer a
  macro whenever it can.

Names are a single shared namespace with the 22 built-in primitives and
with each other — `loadMacro`/`loadExtern` throw on a collision rather
than silently shadowing anything.

### What this doesn't buy you: no recursion, no loops, no mutable state

Now that one definition can reference another by name, it's a natural
guess that a definition could call **itself**, or that two definitions
could call each other back and forth. Neither works, on purpose — try it
with the `cross3`/`crossLength` example above and have `cross3` reference
itself, and here's exactly what happens:

- **A macro can't call itself, directly or through a cycle.** This is
  enforced two different ways depending on how the macro was defined, and
  it's worth knowing which one applies: a macro defined as an AST
  function (straight `` fn`...` `` text, or every function in a `.expr`
  file/buffer) is resolved and **inline-expanded once, at
  registration/load time**, against whatever's registered so far — a
  definition only becomes referenceable *after* it's fully registered,
  so a self/forward reference simply survives as an ordinary, unmapped
  `call` node, failing later with the same "no mapping for Math
  function" error an unrelated typo would (even once that name
  eventually DOES get registered elsewhere) — no recursion detection
  needed, the ordering alone rules it out. A macro defined as a **plain
  JS function** (`loadMacro(name, someFn)`) runs fresh on every use
  instead, so it legitimately CAN reference other real macros each
  time — which means a genuine self/cyclic reference there needs an
  explicit runtime check instead of relying on ordering, and gets one:
  `"<name>" can't call itself, directly or through a cycle`, not a
  crash.
- **No loops.** A macro's body is built from the exact same primitives
  every other ExprForge expression is — `select`/`cmp` for a conditional
  *value*, nothing that iterates.
- **No mutable state.** AST nodes are values, not locations — there's
  nothing to assign to.
- **Emitted output isn't a call, it's a copy.** Every use of a macro
  expands its full arithmetic in place again — unlike a real function,
  there's no shared implementation at the call site, so a macro used many
  times in one formula makes the emitted source (correspondingly) larger
  each time, not smaller. This is a size/readability trade-off to know
  about, not a correctness concern.

This isn't a launch-day limitation waiting on a future release — it's the
same "expression AST, not a program AST" boundary declared under
"Intents" above, applied to this feature specifically because it's the
one place someone's most likely to assume otherwise.

### Sessions (`createSession`)

Every `loadMacro`/`loadExtern`/`evaluate`/`emit`/`emitMany`/`loadExpr`/
`loadExprSource` above registers into (or resolves against) one
process-wide registry by default — fine for a single program registering
its own fixed set of macros once, at startup. `createSession()` gives you
an independent, additively-scoped registry instead, for whenever more
than one is genuinely needed at once — e.g. a service evaluating math
defined by several different users/tenants, where one user's
`loadMacro("helper", ...)` must never resolve inside another user's
expression just because they happened to pick the same name:

```js
const { createSession, num, v, mul, call } = require("exprforge");

const session = createSession();
session.loadMacro("double", (x) => mul(x, num(2)));

const doubled = { name: "f", params: ["x"], body: call("double", v("x")) };
session.evaluate(doubled, [21]); // 42

// The global loadMacro/evaluate never see "double" at all -- it exists
// only inside this one session's own registry.
```

- **Purely additive**: the process-wide default registry (what every bare
  `loadMacro`/`loadExtern`/`evaluate`/`emit` call above already uses) is
  completely unaffected by a session's existence, and vice versa —
  nothing here changes what any existing call site does.
- **Every session-bound method mirrors its global counterpart 1:1**:
  `session.loadMacro`, `session.loadExtern`, `session.evaluate`,
  `session.emit`, `session.emitMany`, `session.loadExpr`,
  `session.loadExprSource`, `session.expandMacros` — same signatures,
  scoped to that session's own registry instead of the default one.
- **Two sessions never see each other's registrations**, even when both
  register the same name — registering `"helper"` in session A never
  collides with, or shadows, an unrelated `"helper"` in session B.
- **Built-in primitives (`sqrt`, `pow`, ...) work identically everywhere**
  — they're fixed and not registry-backed at all, so a session doesn't
  need, and can't be given, its own copy of them.
- **No removal API.** A session's registry is a plain object,
  garbage-collected normally once you drop your reference to it — rebuild
  a fresh `createSession()` instead of trying to unregister one
  macro/extern out of an existing one.

## Adding a language

Write `emitters/<lang>.js` exporting an `Emitter` instance (see any
existing file as a template), then add one line to
`emitters/registry.js`. Nothing else changes — proven by the TypeScript
emitter, added with no changes to `base.js`, `build.js`, or `index.js`.
`Emitter` is a real class (not just a factory function), so a target that
needs to intercept how expressions themselves get rendered — not just
`calls`/`emitSelect`/`formatFunction`, all ordinary config — can subclass
it instead: Perl/PHP override `emitExpr`'s `"var"` case to add the `$`
sigil every reference needs, Scheme overrides the `"bin"` case for prefix
notation. See `emitters/scheme.js` and `emitters/perl.js`.

### Reserved-word collisions

Several emitters (QB64, Fortran, Zig, Scheme, COBOL) guard against a
generated variable/parameter/function name colliding with that language's
own reserved words or builtins — a `<LANG>_RESERVED` set checked at
emission time, throwing a clear error instead of producing code that fails
to compile somewhere downstream with no context (see e.g. `QB64_RESERVED`
in `emitters/qb64.js`). **These lists are not, and can't practically be,
exhaustive** — each covers the collisions that came up in this project's
own samples plus the obvious/common ones for that language, not every
reserved word in every language's full grammar. If you're naming your own
functions/params/`letIn` bindings, especially ones you know will target a
specific language, it's still on you to know that language's reserved
words — Perl/PHP mostly sidestep this (every variable is `$`-sigiled, so
it can't collide with a bareword keyword), but the sigil-free languages
above genuinely can't be fully guarded against in advance.

**COBOL is a partial exception**: a *parameter* colliding with one of its
narrow, syntax-specific quirks (e.g. a bare `c`, which breaks GnuCOBOL's
`CALL ... USING` clause specifically) gets silently renamed internally
(`EFLF_c`) rather than thrown at you — safe because every target here
calls positionally, so a parameter's declared name is never visible to a
caller in any of them. The function's own name and any `outputs()` field
names are **not** covered by this — both remain part of the actual
calling contract (a suite's field names are genuinely consumer-visible in
every other target's return shape), so those still throw, same as before.
See `renameConflictingParams` in `emitters/cobol.js`.

## Named subexpressions and conditional values

Beyond `num`/`v`/`bin`/`call`, two more node types stay inside the
expression model without introducing control flow:

- **`letIn(name, value, body)`** — name a subexpression to avoid
  recomputing it (e.g. `sqrt(x²+y²+z²)` once, then divide three
  components by it). Every `let` in a function gets lifted into an ordered
  list of local declarations ahead of the return statement/expression, in
  every target.

  Chaining several is normally hand-nested `letIn` calls, one inside the
  next, closing parens piling up at the end with no real hierarchy behind
  them — just bookkeeping to get everything hoisted before it's used.
  **`letChain(bindings, body)`** is that same nesting, built for you from a
  flat, ordered list instead — exactly what "The bottom: raw AST builders"
  above uses for `crossLength`'s `rx`/`ry`/`rz`:

  ```js
  const { v, num, mul, add, letChain, outputs } = require("exprforge");

  letChain(
      [
          ["t2", mul(v("t"), v("t"))],
          ["t3", mul(v("t2"), v("t"))],
      ],
      outputs({ t2: v("t2"), t3: v("t3") }),
  );
  // same tree as letIn("t2", ..., letIn("t3", ..., outputs({...})))
  ```

  `bindings` is an ordered array of `[name, valueNode]` pairs, not a
  `{name: valueNode}` object like `outputs()` takes — order is
  load-bearing here (a later binding's value can reference an earlier
  one's name), and that's clearer as an explicit sequence than resting on
  an object's key order. Pure authoring sugar: builds the identical `let`
  node structure `letIn` would, so it needs no emitter changes and
  round-trips through `collectLets` the same way.
- **`select(cond, then, else)` + `cmp(left, op, right)`** — conditional
  *value* selection. Every target has a genuinely different way to spell
  this: a native ternary where one exists (C, Java, C#), `if`-as-expression
  in Rust, `a if cond else b` in Python, `cond and a or b` in Lua (safe
  there specifically because only `nil`/`false` are falsy in Lua — a
  number is always truthy, so this never mis-selects at zero), an
  immediately-invoked function in Go (which has neither ternary nor an
  `if`-expression), and the equivalent arithmetic expression in QB64
  (which has no conditional expression syntax whatsoever).

  **`select` is not a branch** — modeled as if both `then` and `else`
  are always evaluated, matching the three real targets where that's
  literally true: QB64 (the arithmetic expression above genuinely
  computes both sides), Fortran (`MERGE`, an elemental intrinsic that
  doesn't short-circuit its arguments — confirmed against a real
  compiler), and COBOL (its picker helper spills both branches into
  temps before the call). The other 15 targets — including
  `evaluate()` itself — happen to short-circuit via their native
  ternary/`if`-`else`/`and`-`or`, but that's an implementation detail
  those 15 share and the other 3 don't, not part of this AST's own
  contract — don't rely on it. Don't use `select` to guard division by
  zero or anything else undefined; clamp the operand itself with its
  own `select` first (see `safeDiv` in `samples/spline-frame.js`), or
  keep a real guard as hand-written code around the generated function.

See [`docs/planned-additions.md`](./docs/planned-additions.md) for the
full design rationale, including why the naive "guard division with
select" pattern is wrong.

## Array indexing (`index`, `wrapIndex`/`clampIndex`)

One more node type, plus two new scalar primitives — still inside the
same "expression tree, no statements" model above, not a step toward
general array support:

- **`index(target, at)`** (builder: `idx(arrayVar, indexExpr)`) — reads
  one element out of an array-typed parameter at a computed offset.
  `target` must resolve to a parameter declared `number[]` (see "Full-
  program syntax" below for the annotation syntax); `at` can be any
  expression — a literal, an identifier, a call, even another `index`
  (`matrix[i][j]`) — not just a bare number.
- **`wrapIndex(i, m)`** == `((i % m) + m) % m` — wraps `i` cyclically
  into `[0, m)` (closed paths, ring buffers).
- **`clampIndex(i, lo, hi)`** == `max(lo, min(hi, i))` — clamps `i` into
  `[lo, hi]` instead (open paths, bounded lookups).

```js
const { fn, evaluate, emit } = require("exprforge");

const cyclicElem = fn`
    cyclicElem(arr: number[], m, i):
      return arr[wrapIndex(i, m)];
`;

evaluate(cyclicElem, [[10, 20, 30, 40], 4, 5]); // 20 -- i=5 wraps to index 1
emit(cyclicElem, "rust").source;
```

This exists for exactly one recurring shape of real bug: picking a
handful of statically-known offsets out of an array (e.g. the 4
Catmull-Rom control points around a spline segment), wrapping at a
closed path's seam or clamping at an open path's ends — logic that used
to be hand-written once per target language, and drifted. See
[`docs/array-index-primitives.md`](./docs/array-index-primitives.md) for
the full motivation (a real cross-language bug this traced back to) and
`samples/array-index-demo.js` for a worked example.

**What this doesn't add**: no way to *construct* or *return* an array —
only a parameter can be array-typed; `outputs()`'s fields are still
scalar-only, and there's no array literal syntax. No loops, no `map`/
`reduce`/`fold` over an array's whole length — every index is a
specific, authored expression (see "What this doesn't buy you" above),
never a runtime-bounded iteration. Array length is always caller-
supplied (an explicit parameter, `m`/`n` above) — it's never
introspected from the array itself; see
`docs/array-index-primitives.md`'s "Emitter implications" for what each
target actually receives as an array parameter.

Implemented for every registered emitter except `cobol` — GnuCOBOL's
`OCCURS` table size is fixed at compile time, a structurally different
model, not a "didn't get to it" gap (see that same doc for the full
rationale). `emitFunction` throws a clear "not supported for this target
yet" error there instead of emitting something that wouldn't compile.

### Runtime type guards for array parameters (`addTypeGuards`)

Nothing stops a *caller* of emitted code from passing a plain number
where an array-typed parameter (`paramTypes`) declared an array —
`evaluate()` already guards this itself, and every statically-typed
target's own compiler already rejects the mismatch, but plain emitted
JS/TypeScript/Python/PHP/Lua/Perl/Scheme/Julia source shipped with no
check at all. Opt in with a 4th argument to `emit()`/`emitMany()`:

```js
const { emit, cyclicElemAst } = require("exprforge");

emit(cyclicElemAst, "js", undefined, { addTypeGuards: true }).source;
// function cyclicElem(arr, m, i) {
//     if (!Array.isArray(arr)) throw new Error("cyclicElem: \"arr\" must be an array");
//     return arr[(((i % m) + m) % m)];
// }
```

Default is `false` — today's output, byte-for-byte, unless you ask for
this. Silently a no-op for any target with no `typeGuard` configured
(every statically-typed target, plus `cobol`) or any function with no
array-typed parameter at all. See
[`docs/runtime-type-guards.md`](./docs/runtime-type-guards.md) for the
full per-language breakdown (Perl's arrayref convention, Scheme's
expression-bodied-function wrapping, ...) and what this deliberately
doesn't check (element type; array length has its own guard — next).

**Array length is a real, structural gap** in the array-parameter design
itself — a passed array's length and a separate `n`/`m` bound parameter
are two independently caller-supplied values, and nothing in the AST
ties them together (see "Array indexing" above). There's no way for
ExprForge to catch a genuine mismatch on its own, but an author who
*knows* the relationship can now say so and get a real check for it —
`fn.arrayLengths: { arr: "m" }`, same opt-in layered on `addTypeGuards`:

```js
const cyclicElemAst = {
    name: "cyclicElem", params: ["arr", "m", "i"],
    paramTypes: { arr: "number[]" },
    arrayLengths: { arr: "m" }, // "arr" is declared to have exactly "m" elements
    body: idx(v("arr"), call("wrapIndex", v("i"), v("m"))),
};

emit(cyclicElemAst, "js", undefined, { addTypeGuards: true }).source;
// function cyclicElem(arr, m, i) {
//     if (!Array.isArray(arr)) throw new Error("cyclicElem: \"arr\" must be an array");
//     if (arr.length !== m) throw new Error("cyclicElem: \"arr\".length must equal \"m\"");
//     return arr[(((i % m) + m) % m)];
// }
```

Not a complete fix — a caller can still pass a mismatched array *and* a
wrong `m` that happens to agree with it, and it's limited to the same 8
dynamic targets `addTypeGuards` already covers (no statically-typed
target here has a portable, general way to query an array's real
runtime length). It closes the common case — an author-declared bound
genuinely drifting out of sync with what's actually passed — at zero
cost when unused, not the general one. See
[`docs/runtime-type-guards.md`](./docs/runtime-type-guards.md)'s own
"Array length" section for the full per-language guard table.

## Concatenating multiple functions into one file

`emitFunction`'s default output assumes one function per compiled unit
— but a real, common pattern is emitting N functions for the same
target and concatenating them into ONE file (one `.bi`/`.cob`/`.go`
file per *program*, not per function). Several targets have some kind
of always-on preamble per function (QB64's math-safety helpers,
COBOL's comparison helpers, Go's `package`/`import`, Zig's `@import`,
PHP's `<?php` tag, Java's one-public-class-per-file rule) that's fine
in isolation but becomes a duplicate/conflicting declaration once two
functions' outputs are concatenated as-is — confirmed directly (a real
consumer report, then the same bug class found in 5 more targets by
auditing for it): the target's compiler rejects the file outright.

```js
const out1 = emit(fn1, "qb64").source;                                       // helpers included (default)
const out2 = emit(fn2, "qb64", undefined, { includeHelpers: false }).source; // helpers omitted
fs.writeFileSync("spline.bi", [out1, out2].join("\n"));
```

See [`docs/multi-function-files.md`](./docs/multi-function-files.md)
for the full per-target table (what repeats, the exact `opts` to pass,
and which targets needed no fix at all — verified, not assumed) and
`test/multi-function-files.test.js` for the permanent regression
coverage, compiled/run for real on every target.

## Infix expression syntax (`` expr` ` ``)

`add(mul(v("a"), v("b")), num(1))` is exactly what gets built, but it's
not what a human reads at a glance. `expr` is a tagged template literal
that parses ordinary infix math syntax into that same tree — same nodes,
different spelling, no new capability. See "Another layer down" above
for a full worked example (`crossLength`, hand-inlined, no macro).

```js
const { v, expr } = require("exprforge");

expr`a * b + 1`
// identical tree to add(mul(v("a"), v("b")), num(1))

expr`(-b + sqrt(b^2 - 4*a*c)) / (2*a)`
// the quadratic formula, readable as the quadratic formula
```

| Syntax | Lowers to |
|---|---|
| `+ - * /` | `add`/`sub`/`mul`/`div` — standard precedence, left-associative |
| `^` | `call("pow", base, exponent)` — **not** a `bin` node (there is no `"^"` operator in the AST; every emitter's `calls` table keys `pow` by name, even targets whose own syntax has a native `^`/`**`). Right-associative and binds *tighter* than unary minus, standard math convention: `-2^2` is `-4`, `2^3^2` is `512`. |
| `-x` | `neg(x)` |
| `name(args...)` | `call("name", ...args)` — not checked against the 22 known functions at parse time, same deferred-to-emission-time error every hand-built `call()` already gets |
| bare `name` | `v("name")` |
| `name.field` | `field(v("name"), "field")` — only meaningful when `name` is bound to a multi-output macro result (see "Macros and externs"); binds tighter than `^`, chainable (`a.b.c`) |
| `name[index]` | `idx(v("name"), indexExpr)` — see "Array indexing" above; `name` must be an array-typed parameter. Binds as tight as `.`, and freely combines/chains with it either order (`arr[i].rx`, `b.arr[i]`, `matrix[i][j]`) |
| `cond ? then : else` | `select(cmp(left, op, right), then, else)` — the **only** place a comparison (`> < >= <= == !=`) is valid, matching `cmp()`'s own documented constraint that it's never a general boolean expression. A bare `a > b` with no `?` is a parse-time error, not a deferred one. Chains naturally: `a>0 ? 1 : b>0 ? 2 : 3`. |
| `${...}` | Splices in an existing AST node as-is, or a plain JS number (auto-wrapped via `num()`). Anything else throws immediately. Plain strings aren't interpolatable — a bare identifier in the template text already means "variable", with no `${}` needed. |
| `# ...` | An end-of-line comment — runs to the next newline, produces no tokens. Works across `${...}` interpolation boundaries too: a value interpolated inside an open comment is silently dropped, never validated (not even for what would otherwise be an invalid interpolation). |

Deliberately **not** in the grammar: `let`/`outputs` blocks (it's a pure
expression grammar, same "expression AST, not a program AST" boundary
declared under "Intents" — wrap the result in `letIn`/`letChain`/`outputs`,
or reach for `fn` below, which adds exactly that) and `&&`/`||` (the AST
has no boolean-combinator node to lower them to).

```js
// Named subexpressions still go around expr(), not inside it:
letIn("mag", expr`sqrt(x^2 + y^2)`, expr`x / mag`)
```

## Full-program syntax (`` fn`...` ``)

`expr` covers one expression; `fn` covers a whole function body —
`let` bindings plus a `return`, on top of the exact same expression
grammar (every expression inside a `fn` template is parsed by the same
engine `expr` uses). Lowers to real `letChain`/`outputs` calls, same
"same nodes, different spelling" guarantee as `expr` itself. See "One
layer down" above for a full worked example (`cross3`/`crossLength`,
via `loadMacro`).

```js
const { fn } = require("exprforge");

const body = fn`
    let mag = sqrt(x^2 + y^2);
    return { nx: x / mag, ny: y / mag };
`;
// identical tree to:
//   letIn("mag", call("sqrt", ...), outputs({ nx: div(v("x"), v("mag")), ny: ... }))

const normalize2 = { name: "normalize2", params: ["x", "y"], body };
```

| Syntax | Lowers to |
|---|---|
| `let name = expr;` | one `[name, valueNode]` pair, in order — a later `let` can reference an earlier one's name |
| `return expr;` | the chain's final expression |
| `return { name: expr, ... };` | `outputs({ name: node, ... })` as the chain's final expression |
| `return { name, ... };` | shorthand for `return { name: name, ... };` — same convention JS object literals use for a property whose value is a same-named variable. Freely mixes with the explicit form: `return { rx, ry: ry * 2, rz };` |

Duplicate `let` names aren't rejected by the parser itself — same
deferred-to-`collectLets` behavior every hand-built `letIn`/`letChain`
already has. A `fn` body with no `let` statements at all is just
`return expr;`, equivalent to a bare `expr` call.

### Optional signature line

Writing `name`/`params` separately, next to the body, is fine for a
one-off — but `fn` can carry them too, with a leading `name(params):`
line:

```js
const { fn, emit, evaluate } = require("exprforge");

const normalize2 = fn`
    normalize2(x, y):
      let mag = sqrt(x^2 + y^2);
      return { nx: x / mag, ny: y / mag };
`;
// normalize2 is now the full {name, params, body} shape directly --
// no wrapping object needed.

evaluate(normalize2, [3, 4]);        // { nx: 0.6, ny: 0.8 }
emit(normalize2, "rust").source;     // ready to use immediately
```

This changes `fn`'s return type based on what you wrote, deliberately:
no signature → a bare `Node`, exactly as above and fully backward
compatible; a signature present → the full `{name, params, body}`
object. `let`/`return` still can't be used as a function name — a
signature is told apart from a statement by the same rule that tells
`let`/`return` apart from any other identifier, so naming a function
`let` just parses as (and fails as) a `let` statement instead.

### Grammar reference

Everything above, as one formal grammar instead of two separate tables —
copied verbatim from `expr.js`'s/`fn.js`'s own header comments, not a
paraphrase, so it can't drift out of sync with what the parser actually
does:

```
program        := signature? stmt* returnStmt
signature      := IDENT "(" (param ("," param)*)? ")" ":"
param          := IDENT (":" "number" "[" "]")?
stmt           := "let" IDENT "=" expression ";"
returnStmt     := "return" expression ";"
                | "return" "{" field ("," field)* "}" ";"
field          := IDENT (":" expression)?

expression     := ternary
ternary        := additive ( compOp additive "?" expression ":" expression )?
compOp         := ">" | "<" | ">=" | "<=" | "==" | "!="
additive       := multiplicative ( ("+"|"-") multiplicative )*
multiplicative := unary ( ("*"|"/") unary )*
unary          := "-" unary | power
power          := postfix ( "^" unary )?
postfix        := primary ( "." IDENT | "[" expression "]" )*
primary        := NUMBER | IDENT ("(" args ")")? | "(" expression ")" | HOLE
args           := expression ("," expression)*
```

`param`'s `:` is a different thing entirely from `field`'s — a
parameter's `: number[]` is the only type annotation this grammar has
(everything else is implicitly a scalar); `field`'s `: expression` is
the ordinary `return { name: expr }` shorthand, unrelated to types.
Omitting a param's annotation (just `IDENT`, as every parameter always
worked before this existed) means an ordinary scalar, so every `fn`
template written before array indexing existed still parses identically.

`` expr`...` `` is exactly `expression` on its own — one formula, no
`let`/`return`. `` fn`...` `` is `program` — `expression`'s entire
grammar embedded unchanged inside every `let`'s value and every
`return`, parsed by the exact same `Parser` class both tags share (not a
reimplementation — `fn` literally imports `expr.js`'s tokenizer and
parser rather than forking either).

Not shown above (lexical, not grammar): `# ...` end-of-line comments
(run to the next newline, produce no tokens); `${...}` interpolation,
which splices an existing `Node` or a plain number in directly (see
"Infix expression syntax" above) and becomes a `HOLE` token in the
grammar above; and that `let`/`return` are ordinary identifiers
*everywhere except* statement-start position — `` expr`let * 2` `` still
means `v("let") * 2`, not a syntax error, since `expr`'s own grammar has
no `stmt`/`signature` rules to make either one special.

`loadExprSource`/`loadExpr` (below) parse the exact same `program`
grammar, repeatedly, over one shared buffer — with one deliberate
difference: `signature` is no longer optional, and gains a mandatory
leading keyword:

```
signature := ("fn" | "macro") IDENT "(" (IDENT ("," IDENT)*)? ")" ":"
```

`fn`/`macro` are contextual the same way `let`/`return` already are —
special only in this exact position, ordinary identifiers everywhere
else (a parameter, or even a signature name, genuinely called `fn` still
works: `` fn`fn(x): return x * 2;` `` parses as a function named `fn`,
unaffected, since a *single* `` fn`...` `` call never runs in this
stricter mode at all — see "Loading a `.expr` file" below for what the
two keywords mean and why the keyword is mandatory there specifically.

### Editor support

[`vscode-extension/`](vscode-extension/) is a real VS Code/VSCodium
extension (same OSS core) providing syntax highlighting for this
grammar: standalone `.expr`/`.fn` files, and, the more common case,
`` expr`...` ``/`` fn`...` `` tagged templates highlighted inline inside
`.js`/`.ts` source, with `${...}` interpolation switching back to real
JS/TS highlighting for its contents. Not a second approximation of the
grammar: its TextMate patterns mirror `expr.js`'s own tokenizer
rule-for-rule, the same source of truth the playground's own CodeMirror
mode already follows. Highlighting only, no diagnostics yet (see that
directory's own README for what a real parser-backed language server
would add, and why it's a separate, larger effort).

Published on [Open VSX](https://open-vsx.org) only, not the Microsoft
Marketplace, by deliberate choice: VSCodium and other open-source VS
Code forks install from it the normal way; official VS Code users need
to manually download and side-load the `.vsix`. See
`vscode-extension/README.md`'s "Distribution" section for why.

## Printing an AST back out, and a native evaluator

Two things that fall out of `fn` existing: `emitters.expr` is a real,
registered target that prints any AST *back out* as `fn`/`expr` source
text (the reverse of parsing it). And `evaluate(fn, args)` (also
exported from the main package) is a native tree-walking interpreter
over the same AST, computing a result directly in JS with no codegen or
compile step — the same node types every emitter already handles,
backed by the real `Math.*` functions.

```js
const { emit, evaluate } = require("exprforge");

emit(normalize2, "expr").source;
// "fn normalize2(x, y):\n  let mag = sqrt(((x^2) + (y^2)));\n  return { nx: (x / mag), ny: (y / mag) };\n"

evaluate(normalize2, [3, 4]);
// { nx: 0.6, ny: 0.8 }
```

Read this output for what it actually is, not as a pretty-printer of
whatever you originally typed: `expandMacros()` runs before *every*
emitter, "expr" included (same as Rust's/COBOL's/etc. own `crossLength`
never mentions `cross3` either — see "Examples, flashiest first" above)
— so a macro-free formula like `normalize2` above prints back out
genuinely readable, but a formula built from several composed
macros/helpers prints its fully-reduced canonical form instead:
gensym'd internal let names, multi-output fields flattened to
`name__field`, all of it. That's not a readability regression to fix —
it's the same "converges on the true, expanded form" property every
other target already has, just visible here because "expr" is the one
target whose reduced output happens to also be valid input to itself
again. What that buys you is real, just not "pretty debug output": a
concrete, load-bearing way to confirm a composed formula actually
reduces to what you expect (`test/conformance.test.js`'s own round-trip
check — print, reparse, re-evaluate, compare — is exactly this, run
against every sample this project has).

### Loading a `.expr` file (`loadExpr`)

`loadExpr(path)` goes the other direction from `emit(fn, "expr")` above:
reads a `.expr` file (that same round-trip text format) and parses it as
zero or more `fn name(params): let ...; return ...;` / `macro
name(params): let ...; return ...;` definitions, each `fn`-marked one
usable directly with `evaluate()`/`emit()`/`emitMany()` — this is the
file-backed sibling of `loadExprSource` in "Examples, flashiest first"
above:

```js
const { loadExpr, evaluate } = require("exprforge");

const defs = loadExpr("./formulas/vectors.expr"); // "fn hyp(a, b): return sqrt(a^2 + b^2);"
evaluate(defs.hyp, [3, 4]); // 5
```

A function defined earlier in the file is available to a function defined
**later** in the same file — as an inline macro, the exact same
"expanded, not called" model `loadMacro` itself uses above (see that
section for why) — **regardless of whether it's marked `fn` or `macro`**.
The keyword only decides what's in the object this call actually returns:
`fn` means "hand this back to me too," `macro` means "inline-only, never
returned on its own" (see "Examples, flashiest first" above for the full
`cross3`/`crossLength` walkthrough — `cross3` is `macro`, `crossLength`
is `fn`, and only `defs.crossLength` exists). Neither keyword is optional
— every definition states one explicitly; a bare `name(params):` with
neither throws, naming both keywords and what each means. A `.expr` file
can also reference globally loaded macros, not just earlier definitions
in the same file — the two sources merge.

`loadExpr(path)` is a thin `fs.readFileSync` wrapper around
**`loadExprSource(text, label?)`** — the same parser, given source text
directly. Use that one wherever the text isn't coming from a real file on
disk (a browser text buffer, an HTTP response, ...) — the playground's
editor uses it exactly this way to let one buffer hold several
definitions. `label` (default `"loadExprSource()"`) identifies the source
in error messages, the way a file path does for `loadExpr`.

## Multiple named outputs

`outputs({ name: Node, ... })` computes several named values from ONE
shared `letIn` chain, instead of one function per value each re-deriving
the whole chain from scratch:

```js
const { num, v, add, sub, letIn, outputs } = require("exprforge");

const sumAndDiff = {
    name: "sumAndDiff",
    params: ["a", "b"],
    body: letIn("total", add(v("a"), v("b")),
          letIn("delta", sub(v("a"), v("b")),
              outputs({ sum: v("total"), diff: v("delta") })
          )),
};
```

Only valid as a function's top-level body (wrap it in `letIn`s, don't nest
it inside `bin`/`call`/`select`). Each target renders it as whatever
multi-value idiom it has, since none of them agree:

| Target | Shape |
|---|---|
| JS | object literal |
| Go, Lua, Scheme | native multiple return values (`(values ...)` in Scheme) |
| C#, Julia | a native named value tuple / named tuple |
| C / Rust / Zig | a small `...Result` struct, returned by value |
| Java, Python | a nested/local `Result` class |
| QB64, Fortran | a `SUB`/`subroutine` with the outputs as trailing by-reference (`intent(out)`) parameters |
| Perl | a hash ref (`{ rx => ..., ry => ... }`) |
| PHP | an associative array (`['rx' => ..., 'ry' => ...]`) |
| COBOL | a callable `PROGRAM-ID`, every output as a trailing `BY REFERENCE` parameter, invoked via `CALL "name" USING ...` — COBOL's *scalar* case uses this same shape too, not a `FUNCTION`-style return (see Testing below) |

Go specifically does **not** use *named* return values (`(rx, ry float64)`)
even though Go supports them and it reads nicer: those are sugar for
pre-declared locals in the function's own scope, and that collides — for
real, on the first suite this feature was built for — whenever an output
name matches an internal `letIn` name. Plain unnamed return types side-step
the whole collision class regardless of naming; a leading comment documents
the order instead (same reason Lua's return, also positional, gets one).
C#'s tuple has no such risk — a tuple literal's element names aren't
pre-declared locals the way Go's named returns are.

## Security considerations

"Trust only the layer you need" (see "Intents" above) is a claim, not just
a description — the raw AST layer specifically has to be safe to build
from untrusted input, since it's the one this README recommends reaching
for when you want the least amount of magic between your formula and the
code it emits. A few concrete guarantees that follow from that:

- **The raw builders validate their own inputs.** `num`/`v`/`bin`/`call`/
  `letIn`/`cmp`/`outputs`/`field` all reject anything that isn't a safe
  value — an identifier must match the exact same rule `expr`/`fn`'s own
  tokenizer already enforces on text it parses (start with a letter/`_`,
  then letters/digits/`_` only), an operator must be one of the fixed
  `+`/`-`/`*`/`/` (or, for `cmp`, `>`/`<`/`>=`/`<=`/`==`/`!=`) set, and a
  number must actually be finite. Without this, the raw builder layer
  would have been the *least* safe one to build from untrusted input, not
  the most — `fn`/`expr`'s own tokenizer never produces anything but a
  safe identifier to begin with, so this was the one place a malformed or
  malicious name (e.g. `v("x); process.exit(1); //")`) could otherwise
  reach emitted output completely unescaped, verbatim, in every one of 16
  targets at once.
- **`expr`/`fn` cap how deeply an expression can nest.** Parens,
  function-call arguments, and ternary branches can nest up to 100 levels
  deep (`MAX_EXPRESSION_DEPTH` in `expr.js`) before parsing fails with one
  clear, controlled error — comfortably below where a pathologically
  nested input (`"((((...))))"` or `"f(f(f(...)))"` thousands deep,
  plausible if this ever parses genuinely untrusted, unbounded-size text)
  would otherwise blow the real JS call stack with a raw "Maximum call
  stack size exceeded". A wide-but-shallow expression (many terms, no
  real nesting) is unaffected regardless of length — only genuine nesting
  depth is bounded.
- **`createSession()` isolates macro/extern registrations** between
  independent users/tenants sharing one process — see "Sessions" above.
- **A caller-supplied macro/extern throwing reports which one.** A macro
  function, or an extern's own `evaluate`/per-target template, is code
  *you* (or whoever registered it) supplied — if it has a bug, the error
  it throws is wrapped with context naming the macro/extern/target
  responsible, rather than propagating bare with no indication of where
  it came from.

What this doesn't cover, deliberately: `loadExtern`'s per-target templates
are real native code you supply — ExprForge can't verify the named symbol
actually exists in a given target, or that it behaves identically across
every target you provide a mapping for (see "Macros and externs" above).
That risk is inherent to what an extern *is*, not something a validation
layer could close without also closing off the feature itself.

## Testing

```
npm test
```

Runs `node --test`. For each sample, that's three kinds of check:

- Emitted JS vs. an independently hand-written reference implementation
  (catches a wrong formula in the AST itself).
- Every other emitted target vs. that same JS, compiled (and, for
  TypeScript, also type-checked under `--strict`) and run, with the sample
  inputs as arguments (catches an emitter bug).
- The `expr`-syntax printer (`emitters/exprsyntax.js`) vs. `fn`'s own
  parser: every sample AST in this suite is printed back out as `fn`/
  `expr` source text, reparsed, and evaluated (via `evaluate()`) to
  confirm the round trip behaves identically to the original. This is a
  stronger claim than either piece being separately unit-tested — the
  printer and the parser are two independent pieces of code that have to
  agree with each other across every real formula this project has, not
  just cases either one's own author thought to hand-write a test for.
  It's also not hypothetical: this exact check caught a real bug during
  development (a ternary printed without enough parens, so
  `crossX / (rLen > eps ? rLen : 1)` reparsed with the wrong grouping)
  that every other check here — including full cross-language conformance
  — had no way to catch, since it's specific to the printer/parser pair
  and nothing else in the pipeline touches that code path.

The compiled/interpreted-language checks need their toolchain on `PATH`
and skip (not fail) when it's missing, so `npm test` degrades gracefully
on any one machine. Every one of `tsc`/`qb64pe`/`dotnet`/`python3`/`lua`/
`perl`/`php`/`julia`/`gfortran`/`zig`/`guile3.0`/`cobc` is treated exactly
like gcc/go/rustc/javac: looked up on `PATH`, never a project
dependency — exprforge only ever generates source text for these, it
doesn't execute or type-check any of it itself. `package.json` has zero
dependencies of any kind, matching this.

CI is one workflow file per target language (`.github/workflows/test-*.yml`),
run in parallel — they have nothing to do with each other, so there's no
reason to serialize installing sixteen different toolchains (QB64-PE
alone, built from source and cached by version, takes several minutes)
into one job, and splitting by file rather than by job within one file is
also what gets each language its own real status badge above, not just
one combined "did everything pass" badge. Each workflow installs only its
own toolchain and runs `EXPRFORGE_TEST_TARGETS=<Label> npm test`; that
environment variable (read once in `test/conformance.test.js`) filters
the target lists down to just that one language, plus the toolchain-
independent JS/reference checks, which every workflow repeats — cheap,
and a redundant sanity check each time. Unset locally, so a plain
`npm test` still runs everything your own machine's installed toolchains
allow.

**Coverage**: `npm run test:coverage` runs the same suite through Node's
own built-in instrumentation (`--experimental-test-coverage` — no
external dependency), honoring whatever toolchains are on your machine,
with no threshold enforced. CI's own "Test Coverage" workflow (badge
above) is deliberately narrower and stricter: it runs only the
toolchain-free `Interpreter` slice (`EXPRFORGE_TEST_TARGETS=Interpreter`,
same filter every `test-*.yml` workflow already uses), gated on a fixed
threshold, since that's the one environment where the number means the
same thing on every run — installing zero, one, or a different subset of
the 17 per-language toolchains would make an aggregate threshold either
flaky or meaningless. Core logic (`ast.js`/`evaluate.js`/`expr.js`/
`fn.js`/`index.js`/`load-expr.js`/`macros.js`/`math/`/`primitives.js`/
`samples/`/`util.js`) sits at 95-100% in every environment, toolchains or
not; per-target emitter coverage is intentionally excluded from that
mental model — code that only really runs inside a real compiled/
interpreted program can't be exercised without that target's own
toolchain, and that verification already happens for real, by actually
compiling and running the output, in the 17 other workflows — a lower
coverage *percentage* there isn't itself a problem this gate is
positioned to catch.

A few of these needed real debugging to get right, all found by actually
compiling/running against a real toolchain rather than assumed to work:

- **QB64**: `Dim x# AS DOUBLE` (sigil *and* an `AS` clause together) is a
  syntax error; has to be `Dim x AS DOUBLE`. Its own exponential notation
  uses `D`, not `E` (`1D-9`, not `1e-9#`) — including when reading its
  `PRINT` output back, not just in literals. A chunk of QB64/BASIC
  builtins (`len`, `val`, `pos`, `log`, ... — see `QB64_RESERVED` in
  `emitters/qb64.js`) silently conflict with a same-named variable; the
  emitter throws a clear error at emission time instead of failing to
  compile later with no context. The test harness runs compiled binaries
  headless via the `$CONSOLE:ONLY` metacommand, so no display (real or
  virtual) is needed — no `xvfb-run` required for these console-only test
  programs, unlike a typical QB64 build.
- **C#**: forbids a member sharing its enclosing type's *exact* name
  (`CS0542`) — every SpEf-prefixed sample name here is already
  capitalized, so the obvious `capitalize(fn.name)` wrapper-class name
  collided with the method name outright; see `wrapperClassName` in
  `emitters/csharp.js`. Bare integer-valued literals are `int` by
  default, and `int / int` is integer division — every literal is
  suffixed `d` unconditionally to rule that out, not just the cases that
  would otherwise break.
- **Python**: `math.floor`/`math.ceil`/`math.trunc`/`round` all return
  `int`, not `float` — wrapped with `float(...)` to stay float64
  throughout, matching every other target.
- **Lua**: 5.3+ removed `math.pow` (use the `^` operator) and
  `math.atan2` (use two-argument `math.atan(y, x)`); there's no
  `math.round` or `math.trunc` or `math.sign` at any version (manual
  `floor(x+0.5)`, `math.modf(x)`, and an `and`/`or` chain respectively).
- **Perl / PHP**: every variable reference needs a `$` sigil, which
  `base.js`'s shared `emitExpr` doesn't produce for anything — both
  subclass `Emitter` to override just the `"var"` case (see "Adding a
  language" above) rather than needing a new hook every other emitter
  would have to ignore. Perl has no `log2()`/`trunc()`/`hypot()` in core
  (POSIX supplies `trunc`/`hypot`, `log2` is derived); PHP has no
  `trunc()` at all (`floor`/`ceil` picked by sign instead, not an `(int)`
  cast, which would misbehave outside PHP's platform integer range).
- **Julia**: `round()` defaults to ties-to-even (banker's rounding), not
  ties-away-from-zero like every other target here —
  `round(x, RoundNearestTiesAway)` used explicitly to actually match,
  not just avoid the untested case. `sign(-0.0)` returns `-0.0`, which is
  numerically equal to `0.0` for the tolerance-based comparisons this
  project uses, so it isn't a real divergence.
- **Fortran**: a literal without the `D0` exponent marker is parsed as
  *single*-precision first, then widened — silently losing precision
  before it reaches a `real(8)` variable, unlike every other target's
  literals — so every literal gets it, not just ones already in
  scientific notation. `FLOOR`/`CEILING` return the default `INTEGER`
  kind, not `REAL`, wrapped back with `REAL(..., 8)`. No ternary, but
  `MERGE(then, else, mask)` is a genuine expression-level conditional —
  confirmed to evaluate both branches regardless of `mask`, matching
  `select()`'s own contract exactly. The native 2-argument `SIGN(A, B)`
  ("magnitude of A, sign of B") is *not* this project's `sign(x)` —
  `SIGN(1.0, 0.0)` returns `1.0`, not `0.0` — built from `MERGE` instead.
  Every gensym'd identifier this library ever introduces internally
  (e.g. a macro's own alpha-renamed `let`, see "Macros and externs")
  starts with a letter, never `_` — Fortran is the one target that
  rejects a leading underscore outright, confirmed against a real
  compiler ("Invalid character in name").
- **Zig**: `std.debug.print` writes to **stderr** by design, not
  stdout — the conformance harness has to use
  `std.io.getStdOut().writer()` instead, or every result silently comes
  back empty. A fully-literal expression with no runtime operand (e.g.
  `sqrt(2.0)` alone) gets evaluated at Zig's extended `comptime_float`
  precision instead of truncated to an actual IEEE double, unless
  explicitly `@as(f64, ...)`-cast — every literal gets that cast, not
  just ones that would otherwise hit this.
- **Scheme (Guile)**: a bare integer literal like `2` is *exact* in
  Scheme's reader syntax, and exact arithmetic that never touches an
  inexact (float) operand stays exact — `(/ 1 3)` prints as the fraction
  `1/3`, not `0.333...`. Every literal gets `.0` appended unless it
  already has a decimal point or exponent, forcing inexactness by literal
  syntax alone rather than relying on some other operand in the same
  expression happening to already be a float.
- **COBOL (GnuCOBOL)**: has no expression-level conditional at all — no
  ternary, no `MERGE`-equivalent. `select()` is built from six small
  helper `FUNCTION-ID` modules (one per comparator), but confirmed
  against a real compile+run that a user-defined `FUNCTION` call
  *silently miscomputes* — no error, just a wrong number — when given a
  complex argument (one containing its own nested call); every argument
  to a helper gets spilled into its own `COMPUTE`d temp first, always,
  not just when an argument "looks complex." `BY VALUE` parameter passing
  is explicitly flagged "unfinished" by the compiler — every function
  uses `BY REFERENCE` (the default) instead, which is also why COBOL is
  the one target where even a *scalar* function's return value is a
  trailing by-reference parameter (see the outputs table above), not a
  `FUNCTION`-style return: calling a user `FUNCTION` by name breaks if
  that name contains an underscore (confirmed against a real compiler),
  while `CALL "name"` takes it as a plain string literal, immune to that.
  Source lines have a real ~512-byte cap — long expressions (e.g.
  `samples/kitchen-sink.js`'s summed call to all 22 functions) get
  wrapped at word boundaries. The native `FUNCTION SIGN` is
  1-argument (`SIGN(x)`), unlike Fortran's identically-named
  2-argument intrinsic — and unlike Fortran's, is genuinely zero-safe.

One test (`normalizeX`) is deliberately excluded from the QB64 check
only: it exists specifically to demonstrate the "don't guard division
with `select`" pitfall from "Named subexpressions and conditional
values" above, and QB64 is the one target where that pitfall actually
produces `NaN` (every other target, including Lua's `and`/`or`, genuinely
short-circuits around it) — that's the AST being correctly unsafe on
purpose, not an emitter bug.

## License

MIT — see [LICENSE](./LICENSE).
