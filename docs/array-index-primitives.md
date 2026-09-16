# Array parameters + `wrapIndex`/`clampIndex` primitives

Status: implemented (see PR #34) for every registered emitter except cobol
(deferred, see its own section below), including `expr`/`fn` text syntax --
`arr[i]` indexing and `name: number[]` parameter type annotations both parse
and round-trip via `loadExprSource()`. Originally written up after a real
cross-language bug in a consumer project (Super Spaceguy Shooter / TrailForge)
traced back to logic that ExprForge structurally could not express at all.
Follows the format of `planned-additions.md` (design rationale first, node
shapes and emitter implications second) since that's what this doc was
modeled on.

## Motivation

The current AST (`num`, `var`, `bin`, `call`, `let`, `cmp`, `select`,
`outputs`, `field`) has no array type — every value is a scalar, or a fixed
named fanout via `outputs()`. That's correct for the vast majority of
`.expr` functions, which are pure vector/scalar math. But one recurring shape
of logic can't be expressed at all: **given an array of N points, pick a
small, statically-known set of them out by index, wrapping or clamping at the
array's bounds.**

The concrete case that motivated this: a consumer project generates shared
QB64 + TypeScript spline math from ExprForge (Catmull-Rom weights, frame
transport, holonomy — all pure scalar math, all genuinely single-sourced with
zero drift since day one). But the function that picks the 4 Catmull-Rom
control points for a given segment — clamping at the ends of an open path, or
wrapping around the seam of a closed one — needs array indexing conditioned
on the array's length, which the DSL has no way to express. So it was
hand-written twice, once per language:

```basic
' QB64 -- src/gameplay/spline_path.bi
Sub SpCrGhosts (sgSeg As Integer, sgNW As Integer, sgCl As Integer, _
                sgG0 As Integer, sgG1 As Integer, sgG2 As Integer, sgG3 As Integer)
    If sgCl Then
        Dim sgLast As Integer : sgLast = sgNW - 2
        If sgSeg = 0 Then sgG0 = sgLast Else sgG0 = sgSeg - 1
        sgG1 = sgSeg
        sgG2 = sgSeg + 1
        If sgSeg = sgLast Then sgG3 = 1 Else sgG3 = sgSeg + 2
    Else
        sgG0 = sgSeg - 1 : If sgG0 < 0 Then sgG0 = 0
        sgG1 = sgSeg
        sgG2 = sgSeg + 1 : If sgG2 >= sgNW Then sgG2 = sgNW - 1
        sgG3 = sgSeg + 2 : If sgG3 >= sgNW Then sgG3 = sgNW - 1
    End If
End Sub
```

```ts
// TypeScript -- spline.ts
function ghosts<T extends Vec3>(wps: T[], seg: number, closed: boolean): [T, T, T, T] {
  const n = wps.length
  if (closed) {
    const m = hasDuplicateClosingPoint(wps) ? n - 1 : n
    const at = (i: number) => wps[((i % m) + m) % m]
    return [at(seg - 1), at(seg), at(seg + 1), at(seg + 2)]
  }
  return [
    wps[Math.max(0, seg - 1)], wps[seg],
    wps[Math.min(n - 1, seg + 1)], wps[Math.min(n - 1, seg + 2)],
  ]
}
```

These two independently hand-written copies of the same intent have now
caused two real bugs: an off-by-one at the closed-loop seam (each language
got it wrong differently, at different times), and a case where one side's
caller passed an array missing its closed-loop duplicate endpoint and the
other's never could — the "shared" algorithm silently wasn't shared at the
one point that mattered. Both were caught eventually, but only by hand
cross-checking two implementations that ExprForge itself has no way to keep
honest, which is exactly the failure mode ExprForge exists to prevent for
everything else in that project's math.

**What this addition is not:** general-purpose array support, loops, or
`reduce`/`scan`. The motivating case never iterates — it picks a handful of
statically-known offsets (`seg-1, seg, seg+1, seg+2`) out of an array, each
independently wrapped or clamped. Scoping this to indexing only, with no loop
construct, keeps it inside ExprForge's existing "expression tree, no
statements" model (see `expr.js`'s header comment) rather than turning it
into a small imperative language. If a future case needs a real fold over an
array of unknown length, that's a separate, larger proposal — don't conflate
the two.

## Addition 1 — array parameter type

### Type annotation

Function parameters need an array-of-number variant, distinct from the
existing bare scalar:

```
fn ghostIndices(wps: number[], n, seg, closed):
  ...
```

### AST shape

An array-typed parameter is a `var` node carrying an `arrayOf: "number"` (or
similar) marker, distinguishable from a scalar `var` wherever parameter types
are inspected (`fn.js`'s param handling, each emitter's `formatFunction`).

### `index` node

```js
{ type: "index", target: Node, at: Node }   // target must resolve to an array-typed var
```

Builder: `idx(arrayVar, indexExpr)`.

## Addition 2 — `wrapIndex` / `clampIndex` primitives

```
wrapIndex(i, m)        ==  ((i % m) + m) % m       -- cyclic index, closed paths
clampIndex(i, lo, hi)  ==  max(lo, min(hi, i))     -- boundary clamp, open paths
```

Both are pure scalar-in/scalar-out — no array involvement themselves — so
mechanically they're new entries in `PRIMITIVE_ARITY` (`primitives.js`) and
`CALLS` (`evaluate.js`), same shape as `atan2`/`hypot` today: one JSON-ish
entry, N per-language templates.

`wrapIndex` needs `%` specifically (not `floor`/`mul`/`sub` decomposition —
negative-input floor-mod has edge cases worth avoiding, and QB64's `MOD` is
integer-only with no floating equivalent to compose from). Recommend adding
it as a primitive rather than expecting emitters to build it from `bin`
nodes, since `BIN_OPS` (`ast.js`) is `{+, -, *, /}` today and modulo
semantics famously differ across languages (Python's `%` follows the sign of
the divisor; C/JS/QB64 follow the sign of the dividend) — a primitive lets
each emitter's template paper over that instead of the caller needing to
know which convention their target uses.

With both of the above, the motivating function becomes expressible as a
straight-line, no-loop `.expr` function:

```
fn ghostIndices(wps: number[], n, seg, closed):
  let m = closed ? n - 1 : n;
  return {
    i0: closed ? wrapIndex(seg - 1, m) : clampIndex(seg - 1, 0, n - 1),
    i1: seg,
    i2: closed ? wrapIndex(seg + 1, m) : clampIndex(seg + 1, 0, n - 1),
    i3: closed ? wrapIndex(seg + 2, m) : clampIndex(seg + 2, 0, n - 1),
  };
```

Deliberately returning **indices**, not points: `outputs()` (multi-value
return) already exists and needs zero changes for four scalars. Making the
return type array-of-point instead would require struct-typed `outputs()`
fields, a materially larger addition, for a benefit (saving one line of
`wps[i0]` at each call site) that doesn't justify the cost. The caller reads
the array itself in ordinary target-language code, exactly as
`spline_path.bi`'s `SpEvalAt` already does around its hand-written
`SpCrGhosts` call today.

## Emitter implications

**QB64.** Arrays are fixed-dimension and passed by reference with bare `()`
in the parameter list, and — this is the part with no way around it — QB64
has no runtime-queryable array length at a call boundary in the general case
(`UBOUND` only works if the callee can see how the array was dimensioned,
which isn't guaranteed for a `.bi`-included Sub receiving someone else's
array). So an array-typed ExprForge parameter has to lower to *(array,
explicit count)*, matching what `spline_path.bi` already does by hand
(`seaWps() As E3D_Coord, seaNW As Integer`). There's no cleaner option — this
should be documented as an emitted-signature quirk, not hidden.

Element type: `formatFunction`/`formatSuite` in `emitters/qb64.js` hard-code
`AS DOUBLE` for scalars. For a first cut, array parameters should be
restricted to the DSL's own scalar type (arrays of `DOUBLE`/`number`), not
arbitrary structs (`E3D_Coord` and friends) — struct-typed array elements are
a separably harder problem and aren't needed for the motivating case (see
Addition 2's point about returning indices, not points).

**Index origin is a real, unresolved risk here, not just a style question**
(raised directly: does this play nicely with `OPTION BASE`/explicit-bounds
callers?). Unlike Fortran (below), QB64 gives the callee no way to redeclare
an array parameter's bounds independent of how the caller actually
dimensioned it — `arr()` inherits whatever bounds the real argument has.
Generated code that assumes `arr(0)` is the first element is only correct
if the caller's array genuinely starts at 0. Tried to confirm this
empirically (whether `LBOUND(arr)` is reliable enough at this call boundary
to self-correct via `arr(LBOUND(arr) + i)` instead of assuming 0) —
couldn't get a QB64PE binary to run headlessly in this sandbox at all (even
`PRINT "hello"` hangs on GL/display init here), so this is unverified, not
confirmed either way. Given the existing uncertainty already noted above
(`UBOUND`/`LBOUND` not guaranteed reliable at this exact call shape),
the safe choice until someone can actually test this in a real windowed
environment: **do not rely on `LBOUND` at all**. Document a hard caller
contract instead, same pattern as "Bounds safety" below — generated QB64
code requires the caller to pass an explicitly 0-based array
(`DIM arr(0 TO n-1) AS DOUBLE`), regardless of any `OPTION BASE` in effect
elsewhere in the caller's program. Passing a 1-based or custom-bound array
produces silently wrong results; this needs to be a documented calling
convention, not something ExprForge can transparently guarantee on QB64's
behalf.

**Fortran, by contrast, has a real escape hatch — confirmed, not assumed.**
A dummy argument's array bounds can be explicitly redeclared in the
callee's own signature, independent of how the caller's actual array was
dimensioned (`real(8), dimension(0:n-1), intent(in) :: arr`) — Fortran's
argument-association rules only require the total element count to match,
never the bounds. Verified directly: a caller-side array declared
`real(8) :: a(1:5)` (1-based), passed to a function whose dummy argument
redeclares it `dimension(0:n-1)`, correctly read `arr(0)` as the caller's
*first* element (confirmed with `gfortran`, not just reasoned from the
standard). So Fortran needs no `+1` translation and no caller-side
contract at all — it belongs in the same "native, 0-indexed, no
translation" tier as the languages below, not the 1-indexed tier the
Motivation section originally assumed before this was checked.

**TypeScript.** Close to free: `formatFunction` in `emitters/typescript.js`
already builds `${p}: number` per parameter; an array param just needs
`${p}: number[]` for that one parameter. No length-parameter workaround
needed — `array.length` exists natively — though it may be worth accepting a
redundant explicit count parameter anyway for signature parity with the QB64
emission of the same function, so callers don't need per-language-different
call sites.

**Every other registered emitter (c, cobol, csharp, exprsyntax, fortran, go,
java, julia, lua, perl, php, python, rust, scheme, zig).** Full support is
the default expectation for any AST-level addition, not an opt-in stretch
goal for "the languages that need it right now" — an emitter not
implementing something a new primitive/node type needs is a gap to close,
not a scope boundary to hide behind. Falling short of that needs a
profound, specific, documented reason, the same bar this project already
holds every other cross-language guarantee to (see e.g. `sign()`'s
zero-handling history, or COBOL's own confirmed nested-FUNCTION-call bug
below) — "didn't get to it yet" isn't one.

Grouped by what each target actually needs:

- **Native array type, 0-indexed, near-free** (js, ts, python, go, rust,
  java, csharp, php, perl, scheme, zig, exprsyntax): an array param is
  just that language's own array/slice/list type; `index` emits as that
  language's native subscript syntax directly.
- **Native array type, but 1-indexed** (julia, lua): same as above,
  except `index`'s emission adds the `+1` translation at the one point
  it actually matters — `wrapIndex`/`clampIndex` themselves stay 0-based
  and portable everywhere; only the final subscript expression needs to
  know its target's index origin.
- **No self-describing array length; needs array + explicit count**
  (c, qb64, fortran): same "array, explicit count" parameter lowering
  QB64 already needed (see above) — C arrays decay to a bare pointer at
  a function boundary with no length of their own, same underlying
  limitation as QB64's `UBOUND`. Fortran lands here too, but for a better
  reason than QB64/C: its dummy-argument bounds can be explicitly
  redeclared 0-based independent of the caller's own array (confirmed
  with a real `gfortran` compile, see below) — so it gets the count
  parameter without QB64's unresolved index-origin risk or C's raw
  pointer.
- **Deferred, with a real reason** (cobol): GnuCOBOL's array type
  (`OCCURS`) requires its element count fixed at compile time in the
  01-level declaration — a structurally different model from every other
  target here, where the count is an ordinary runtime parameter. Designing
  that properly (and, per this project's own standing rule, confirming it
  against a real `cobc` compile — see this file's extensive existing scar
  tissue on GnuCOBOL-specific miscompiles) is real, separate work, not a
  same-afternoon extension of the pattern above. Throws a clear
  "not supported for this target yet" error (same shape `formatSuite`
  already uses for an emitter that hasn't implemented multi-output) until
  that design pass happens — tracked as follow-up work, not abandoned
  scope.

## Bounds safety — explicitly not improved

An ExprForge array type should faithfully reproduce the bounds-safety (or
lack of it) each target already has, not paper over it. QB64 has no
bounds-checked array access; out-of-range indexing is a runtime crash or a
silent garbage read today in hand-written `spline_path.bi`, and would remain
exactly that risky in generated code. Anything else would create a QB64/TS
behavior mismatch on malformed input — the exact kind of drift this addition
exists to eliminate elsewhere. `wrapIndex`/`clampIndex` prevent
*out-of-declared-range* index values from ever being computed when used
correctly, but do nothing to protect a caller who passes the wrong `n` for
the array it's paired with.

## AST plumbing — every generic tree-walker needs an explicit `index` case

Introducing a new node *type* (as opposed to a new primitive, which just
adds a table entry) touches every function that walks the tree generically,
not only the per-target emitters discussed above. None of these need full
support on day one, but each needs an *explicit, deliberate* case rather
than silently falling through to wrong behavior:

- **`evaluate.js`'s dispatch** — needs a real `case "index"` that resolves
  `target` to an array (array-typed vars need a runtime representation in
  the interpreter's env, not just in emitted code) and indexes it with the
  evaluated `at`. Silent fallthrough here would throw an opaque "unknown
  node type" error at best; should be a real implementation, since
  `evaluate()` is how `differentiate()`'s own tests numerically verify
  results and how the playground's interpreter tab works.
- **`checkUnboundVars`** — needs to recurse into `target` and `at` by name
  (they aren't `left`/`right`/`args`, so a generic walker keyed on those
  field names won't find them automatically).
- **`collectLets`** (`ast.js`) — needs an explicit case in its `walk()` so a
  `let`-bound array var or index expression inside a `let` chain gets
  lifted correctly instead of silently skipped.
- **`expandMacros`** (`macros.js`) — needs to recurse into `index` nodes the
  same way it already does for `bin`/`call`/`select`, so a macro reference
  inside an index expression (`arr[macroCall(x)]`) expands instead of being
  left unexpanded.
- **`emitters/base.js`'s `emitExpr` switch** — needs an explicit
  `case "index":` that calls a per-emitter hook, defaulting to a clear
  "array indexing not supported for this target" throw (same shape as
  `formatSuite`'s existing pattern), not an unhandled-case crash.
- **`differentiate.js`** — `differentiateRaw`'s switch has a `default:
  throw` today; an `index` node hitting that is almost certainly *correct*
  behavior for this addition's motivating case (indexing selects which
  scalar to differentiate, it isn't itself a differentiable operation), but
  that should be a deliberate, documented case rather than an accident of
  the existing default. `simplify()` needs no change — its own `else {
  return node; }` fallback for unrecognized types already handles this
  safely (leaves `index` nodes unfolded, doesn't crash).

None of this is difficult individually, but all of it needs to happen
together before the array-param addition is safe to merge — a new node
type that only some tree-walkers know about is worse than one that
consistently throws "not supported" everywhere it isn't implemented yet.

## What this does not solve

- General iteration (`for`, `reduce`, `scan`) over an array of unknown
  length. Not proposed here; no known duplicated-across-languages need for
  it yet in the motivating project as of this writing.
- Struct/tuple-typed array elements (arrays of points, not numbers).
- Anything resembling automatic bounds checking beyond what each target
  language already provides natively.
