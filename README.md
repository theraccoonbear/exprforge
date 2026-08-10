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
[![Perl](https://github.com/theraccoonbear/exprforge/actions/workflows/test-perl.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-perl.yml)
[![PHP](https://github.com/theraccoonbear/exprforge/actions/workflows/test-php.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-php.yml)
[![Julia](https://github.com/theraccoonbear/exprforge/actions/workflows/test-julia.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-julia.yml)
[![Fortran](https://github.com/theraccoonbear/exprforge/actions/workflows/test-fortran.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-fortran.yml)
[![Zig](https://github.com/theraccoonbear/exprforge/actions/workflows/test-zig.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-zig.yml)
[![Scheme](https://github.com/theraccoonbear/exprforge/actions/workflows/test-scheme.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-scheme.yml)
[![COBOL](https://github.com/theraccoonbear/exprforge/actions/workflows/test-cobol.yml/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/test-cobol.yml)

Author a math expression once, as a small AST, and emit verified,
identical-behavior implementations in JavaScript, TypeScript, Python, C#,
Lua, QB64, C, Java, Go, Rust, Perl, PHP, Julia, Fortran, Zig, Scheme
(Guile), and COBOL (GnuCOBOL) — plus a native in-process evaluator and a
printer for exprforge's own readable syntax (see `fn`/`expr` below).

No required dependencies. You can build the AST directly with plain JS
functions, or author it as readable infix text via `expr`/`fn` (see
below) — either way, the same tree is walked once per target.

**[▶ Try it live](https://theraccoonbear.github.io/exprforge/)** — write
a `` fn`...` `` formula in the browser and watch it emitted across every
target language at once, no install required. Runs the real, current
library (see `playground/`), not a frozen demo build.

## Why

Codegen tools like SymPy already turn math expressions into code for
mainstream languages. This exists for two things SymPy doesn't do:

- Targets like QB64/BASIC that no general codegen project supports.
- A conformance test harness that actually proves the emitted targets
  agree numerically, not just that they compile.

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

Neither is "translate my code for me" — it's "prove two independent
implementations of one formula actually match," which is a narrower,
checkable claim.

## Layered by design

Everything here is layered, and the layers don't reach back into each
other — worth being explicit about, especially if you're evaluating this
for something like a migration and want to know exactly what you're
trusting:

- **The AST and its emitters — the whole value proposition.** `ast.js`'s
  builders (`num`, `v`, `add`, `mul`, `letIn`, `select`, `outputs`, ...)
  build a plain tree of plain objects; every `emitters/<lang>.js` file
  turns that tree into target-language source text. This is also the
  *entire* dependency graph for it: every emitter requires only
  `emitters/base.js` and `ast.js` — nothing else in this repo. No parser,
  no custom syntax, no interpreter sits between your AST and the code it
  emits. Every example in `samples/` is built this way, and the library
  worked exactly this way for its first two published releases, before
  anything below existed.
- **`expr`/`fn` — optional authoring sugar.** Nested builder calls
  (`add(mul(v("a"), v("b")), num(1))`) get hard to read past a few terms.
  `expr`/`fn` are a small hand-rolled tokenizer and recursive-descent
  parser that turn ordinary infix text (`` expr`a * b + 1` ``) into
  *exactly* the same tree the builders would — checked by structural unit
  tests and a full print-reparse-evaluate round trip across every sample
  this project has (see "Testing" below), not just asserted. It's
  genuinely optional: nothing in the AST/emitter layer above calls into
  it or imports it. Don't want a parser in your dependency graph, for a
  security review or otherwise? Don't call `expr`/`fn` — build the tree
  with the plain functions instead, and every emitter behaves identically
  either way.
- **The native evaluator and the `expr`-syntax printer — additive
  conveniences.** `evaluate()` (compute a result in-process, no
  target-language toolchain needed) and the `expr` emitter target (print
  any AST back out as readable text) sit off to the side the same way
  `expr`/`fn` do — nothing else depends on them either.

If you only care about "does this correctly turn my AST into
COBOL/Java/whatever" — `ast.js` and the one `emitters/<lang>.js` file you
care about are the entire surface that matters. Everything else is there
if you want it, invisible if you don't.

## Install

```
npm install exprforge
```

## Usage

```js
const { expr, emitAll } = require("exprforge");

const fn = {
    name: "lerp",
    params: ["a", "b", "t"],
    body: expr`(b - a) * t + a`,
};

const outputs = emitAll(fn);
console.log(outputs.rust.source);
console.log(outputs.c.source);
```

`` expr`(b - a) * t + a` `` and `add(v("a"), mul(sub(v("b"), v("a")), v("t")))`
build the *exact same tree* — `expr` (see below) is optional infix syntax
sugar over the same builders, not a different API. Every example below
still uses the builders directly, since that's what `expr` compiles down
to and what you'll reach for once a formula needs `${...}`-spliced
sub-expressions.

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
  flat, ordered list instead:

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

  **`select` is not a branch** — every target evaluates both `then` and
  `else`. Don't use it to guard division by zero or anything else
  undefined; clamp the operand itself with its own `select` first (see
  `safeDiv` in `samples/spline-frame.js`), or keep a real guard as
  hand-written code around the generated function.

See [`docs/planned-additions.md`](./docs/planned-additions.md) for the
full design rationale, including why the naive "guard division with
select" pattern is wrong.

## Infix expression syntax (`` expr` ` ``)

`add(mul(v("a"), v("b")), num(1))` is exactly what gets built, but it's
not what a human reads at a glance. `expr` is a tagged template literal
that parses ordinary infix math syntax into that same tree — same nodes,
different spelling, no new capability:

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
| `cond ? then : else` | `select(cmp(left, op, right), then, else)` — the **only** place a comparison (`> < >= <= == !=`) is valid, matching `cmp()`'s own documented constraint that it's never a general boolean expression. A bare `a > b` with no `?` is a parse-time error, not a deferred one. Chains naturally: `a>0 ? 1 : b>0 ? 2 : 3`. |
| `${...}` | Splices in an existing AST node as-is, or a plain JS number (auto-wrapped via `num()`). Anything else throws immediately. Plain strings aren't interpolatable — a bare identifier in the template text already means "variable", with no `${}` needed. |
| `# ...` | An end-of-line comment — runs to the next newline, produces no tokens. Works across `${...}` interpolation boundaries too: a value interpolated inside an open comment is silently dropped, never validated (not even for what would otherwise be an invalid interpolation). |

Deliberately **not** in the grammar: `let`/`outputs` blocks (it's a pure
expression grammar, same "expression AST, not a program AST" boundary as
the rest of exprforge — wrap the result in `letIn`/`letChain`/`outputs`,
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
"same nodes, different spelling" guarantee as `expr` itself:

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

Duplicate `let` names aren't rejected by the parser itself — same
deferred-to-`collectLets` behavior every hand-built `letIn`/`letChain`
already has. A `fn` body with no `let` statements at all is just
`return expr;`, equivalent to a bare `expr` call.

### Optional signature line

Writing `name`/`params` separately, next to the body, is fine for a
one-off — but `fn` can carry them too, with a leading `name(params):`
line:

```js
const { fn, emitAll, evaluate } = require("exprforge");

const normalize2 = fn`
    normalize2(x, y):
      let mag = sqrt(x^2 + y^2);
      return { nx: x / mag, ny: y / mag };
`;
// normalize2 is now the full {name, params, body} shape directly --
// no wrapping object needed.

evaluate(normalize2, [3, 4]);        // { nx: 0.6, ny: 0.8 }
emitAll(normalize2).rust.source;     // ready to use immediately
```

This changes `fn`'s return type based on what you wrote, deliberately:
no signature → a bare `Node`, exactly as above and fully backward
compatible; a signature present → the full `{name, params, body}`
object. `let`/`return` still can't be used as a function name — a
signature is told apart from a statement by the same rule that tells
`let`/`return` apart from any other identifier, so naming a function
`let` just parses as (and fails as) a `let` statement instead.

## Printing an AST back out, and a native evaluator

Two things that fall out of `fn` existing: `emitters.expr` is a real,
registered 18th target that prints any AST *back out* as `fn`/`expr`
source text (the reverse of parsing it) — useful for debugging a
formula built from several composed helpers, or just getting a readable
string to log or paste into a future `fn`/`expr` call. And `evaluate(fn,
args)` (also exported from the main package) is a native tree-walking
interpreter over the same AST, computing a result directly in JS with no
codegen or compile step — the same node types every emitter already
handles, backed by the real `Math.*` functions.

```js
const { emitAll, evaluate } = require("exprforge");

emitAll(normalize2).expr.source;
// "normalize2(x, y):\n  let mag = sqrt(((x^2) + (y^2)));\n  return { nx: (x / mag), ny: (y / mag) };\n"

evaluate(normalize2, [3, 4]);
// { nx: 0.6, ny: 0.8 }
```

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
with `select`" pitfall from the section above, and QB64 is the one
target where that pitfall actually produces `NaN` (every other target,
including Lua's `and`/`or`, genuinely short-circuits around it) — that's
the AST being correctly unsafe on purpose, not an emitter bug.

## License

MIT — see [LICENSE](./LICENSE).
