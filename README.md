# ExprForge 🔢🔨

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

Author a math expression once, as a small AST, and emit verified,
identical-behavior implementations in JavaScript, TypeScript, Python, C#,
Lua, QB64, C, Java, Go, and Rust.

No parser, no dependencies. You build the AST directly with plain JS
functions; the same tree is walked once per target language.

## Why

Codegen tools like SymPy already turn math expressions into code for
mainstream languages. This exists for two things SymPy doesn't do:

- Targets like QB64/BASIC that no general codegen project supports.
- A conformance test harness that actually proves the emitted targets
  agree numerically, not just that they compile.

## Install

```
npm install exprforge
```

## Usage

```js
const { num, v, bin, mul, add, sub, emitAll } = require("exprforge");

const fn = {
    name: "lerp",
    params: ["a", "b", "t"],
    body: add(v("a"), mul(sub(v("b"), v("a")), v("t"))),
};

const outputs = emitAll(fn);
console.log(outputs.rust.source);
console.log(outputs.c.source);
```

## Samples

`samples/` has worked, non-trivial examples (also exported from the
package individually, or together as `samples`):

- `samples/catmull-rom.js` — uniform Catmull-Rom spline interpolation.
- `samples/fibonacci.js` — nth Fibonacci number via Binet's closed form.
  There's no loop/recursion version because exprforge has no control flow
  (see below) — this is what "fibonacci" looks like as a pure expression.
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
  `sign()` disagreeing with everyone else at exactly zero (see below) —
  the other samples between them only ever exercised 5 of the 22.
- `samples/math-demo.js` — also not a worked example: a conformance-test
  fixture exercising every `exprforge/math` helper (see below) in one
  suite.

`npm run build` emits all of them, for every target language, into `out/`.

## Supported Math functions

`sqrt abs pow sin cos tan asin acos atan atan2 log log2 log10 exp
floor ceil round trunc sign min max hypot`

Add more by extending a target's `calls` table in `emitters/<lang>.js`.
Requesting an unmapped function throws at build time, not silently.

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

## Adding a language

Write `emitters/<lang>.js` exporting an `Emitter` instance (see any
existing file as a template), then add one line to
`emitters/registry.js`. Nothing else changes — proven by the TypeScript
emitter, added with no changes to `base.js`, `build.js`, or `index.js`.

## Named subexpressions and conditional values

Beyond `num`/`v`/`bin`/`call`, two more node types stay inside the
expression model without introducing control flow:

- **`letIn(name, value, body)`** — name a subexpression to avoid
  recomputing it (e.g. `sqrt(x²+y²+z²)` once, then divide three
  components by it). Every `let` in a function gets lifted into an ordered
  list of local declarations ahead of the return statement/expression, in
  every target.
- **`select(cond, then, else)` + `cmp(left, op, right)`** — conditional
  *value* selection. Every target has a genuinely different way to spell
  this: a native ternary where one exists (C, Java, C#), `if`-as-expression
  in Rust, `a if cond else b` in Python, `cond and a or b` in Lua (safe
  there specifically because only `nil`/`false` are falsy in Lua — a
  number is always truthy, so this never mis-selects at zero), an
  immediately-invoked function in Go (which has neither ternary nor an
  `if`-expression), and the equivalent arithmetic expression in QB64
  (which has no conditional expression syntax whatsoever).

  **`select` is not a branch** — every target evaluates both `then` and
  `else`. Don't use it to guard division by zero or anything else
  undefined; clamp the operand itself with its own `select` first (see
  `safeDiv` in `samples/spline-frame.js`), or keep a real guard as
  hand-written code around the generated function.

See [`docs/planned-additions.md`](./docs/planned-additions.md) for the
full design rationale, including why the naive "guard division with
select" pattern is wrong.

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
| Go, Lua | native multiple return values |
| C# | a native named value tuple (`(double rx, double ry)`) |
| C / Rust | a small `...Result` struct, returned by value |
| Java, Python | a nested/local `Result` class |
| QB64 | a `SUB` with the outputs as trailing by-reference parameters |

Go specifically does **not** use *named* return values (`(rx, ry float64)`)
even though Go supports them and it reads nicer: those are sugar for
pre-declared locals in the function's own scope, and that collides — for
real, on the first suite this feature was built for — whenever an output
name matches an internal `letIn` name. Plain unnamed return types side-step
the whole collision class regardless of naming; a leading comment documents
the order instead (same reason Lua's return, also positional, gets one).
C#'s tuple has no such risk — a tuple literal's element names aren't
pre-declared locals the way Go's named returns are.

## What this deliberately doesn't do

- No control flow (loops, branches, calling other generated functions) —
  this is an expression AST, not a program AST.
- No RNG — can't be made to produce identical output across languages,
  so it isn't offered as if it could.
- No arbitrary precision / complex numbers — float64 only, for now.

## Testing

```
npm test
```

Runs `node --test`. For each sample, that's two kinds of check:

- Emitted JS vs. an independently hand-written reference implementation
  (catches a wrong formula in the AST itself).
- Every other emitted target vs. that same JS, compiled (and, for
  TypeScript, also type-checked under `--strict`) and run, with the sample
  inputs as arguments (catches an emitter bug).

The compiled/interpreted-language checks need their toolchain on `PATH`
and skip (not fail) when it's missing, so `npm test` degrades gracefully
on any one machine. Every one of `tsc`/`qb64pe`/`dotnet`/`python3`/`lua`
is treated exactly like gcc/go/rustc/javac: looked up on `PATH`, never a
project dependency — exprforge only ever generates source text for these,
it doesn't execute or type-check any of it itself. `package.json` has
zero dependencies of any kind, matching this.

CI is one workflow file per target language (`.github/workflows/test-*.yml`),
run in parallel — they have nothing to do with each other, so there's no
reason to serialize installing nine different toolchains (QB64-PE alone,
built from source and cached by version, takes several minutes) into one
job, and splitting by file rather than by job within one file is also
what gets each language its own real status badge above, not just one
combined "did everything pass" badge. Each workflow installs only its own
toolchain and runs `EXPRFORGE_TEST_TARGETS=<Label> npm test`; that
environment variable (read once in `test/conformance.test.js`) filters
the target lists down to just that one language, plus the toolchain-
independent JS/reference checks, which every workflow repeats — cheap,
and a redundant sanity check each time. Unset locally, so a plain
`npm test` still runs everything your own machine's installed toolchains
allow.

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

One test (`normalizeX`) is deliberately excluded from the QB64 check
only: it exists specifically to demonstrate the "don't guard division
with `select`" pitfall from the section above, and QB64 is the one
target where that pitfall actually produces `NaN` (every other target,
including Lua's `and`/`or`, genuinely short-circuits around it) — that's
the AST being correctly unsafe on purpose, not an emitter bug.

## License

MIT — see [LICENSE](./LICENSE).
