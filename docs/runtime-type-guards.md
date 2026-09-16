# Runtime type guards for array-typed parameters (`addTypeGuards`)

Status: implemented. Follow-up from #33/#34 (array parameters + `wrapIndex`/
`clampIndex`) and the comparison-operator/round() audit that followed it —
filed as #35, implemented here, opt-in, no behavior change unless asked for.

## Motivation

`fn.paramTypes` (`{ arr: "number[]" }`) is authoring-time metadata only.
`checkUnboundVars` statically rejects every way an array-typed value can be
misused *inside* a function body (see #33/#34's static-analysis work), but
it can't do anything about what a **caller** actually passes in at the call
boundary once code is emitted.

For every statically-typed target (C, Java, C#, Rust, Go, Fortran, Zig,
QB64, COBOL), that boundary is already enforced for free by the target's
own compiler — passing a scalar where `double[]`/`&[f64]`/`real(8),
dimension(0:*)` etc. is declared simply fails to compile. `evaluate()`,
ExprForge's own native interpreter, also already guards this itself (a
real `Array.isArray()` check, thrown clearly, tested).

But plain **emitted** source for the 8 dynamically-typed targets — JS,
TypeScript (only at the type-check layer, erased at runtime), Python, PHP,
Lua, Perl, Scheme, Julia — shipped with no guard at all. A caller passing
a plain number where `arr: number[]` was declared would either hit an
unrelated, confusing error several layers down (indexing a number), or in
some cases silently produce a wrong result via coercion.

## What this adds

An opt-in 4th argument to `emit()`/`emitMany()` (and the equivalent on a
session's own `emit`/`emitMany`, see `createSession()`):

```js
const { emit, cyclicElemAst } = require("exprforge");

emit(cyclicElemAst, "js").source;
// function cyclicElem(arr, m, i) {
//     return arr[(((i % m) + m) % m)];
// }

emit(cyclicElemAst, "js", undefined, { addTypeGuards: true }).source;
// function cyclicElem(arr, m, i) {
//     if (!Array.isArray(arr)) throw new Error("cyclicElem: \"arr\" must be an array");
//     return arr[(((i % m) + m) % m)];
// }
```

Default is `false` (today's existing output, byte-for-byte unchanged) —
this is additive, not a behavior change, and it's why it isn't the
default: most callers already fully control both sides of the call
boundary (their own generated code, called from their own trusted code),
and the extra line is only worth paying for when that boundary is real
(e.g. a plugin/mod API, user-supplied data crossing into a generated
function).

One guard line is generated per array-typed parameter, using each
target's real idiom for "is this actually an array-shaped value":

| Target | Check |
|---|---|
| JS / TypeScript | `Array.isArray(arr)` |
| Python | `isinstance(arr, list)` |
| PHP | `is_array($arr)` |
| Lua | `type(arr) == "table"` |
| Julia | `arr isa AbstractVector` |
| Perl | `ref($arr) eq 'ARRAY'` — Perl's own array-param convention is an ARRAYREF (`$arr->[i]`), not a plain `@array` (see `emitters/perl.js`'s own comment), so the check is on the reference, not the value |
| Scheme | `(vector? arr)` — `emitters/scheme.js`'s own `emitIndex` uses `vector-ref`, so this checks for a vector specifically, not a list |

Every other target (every statically-typed one, plus COBOL, which
doesn't support array parameters at all) has no `typeGuard` template
configured — `addTypeGuards: true` is silently a no-op for them, not an
error, same as it being silently a no-op for a function with no
array-typed parameter at all.

## Implementation

`emitters/base.js`'s `Emitter` constructor reads an optional
`config.typeGuard: (paramName, fnName) => string` — present only on the 8
dynamic-language emitters. `emitFunction(fn, registry, opts)` computes
`guardLines` (one string per array-typed parameter, empty array
otherwise) and passes it as a 4th argument to `formatFunctionImpl`/
`formatSuiteImpl`. Every emitter's `formatFunction`/`formatSuite`
accepts (and, for the 8 that need it, splices in) `guardLines = []` —
harmless as an unused trailing argument for the ~10 targets that never
receive a non-empty array.

Every guard template is written to stay exactly ONE physical line
(`if x: raise ...` in Python, `;`-joined statements in Julia, `unless
(...) { die ...; }` in Perl, etc.) so the splicing logic is identical
everywhere — except Scheme, which needed real structural handling: its
function body is a single expression, not a sequence of statements, so
there's no room to prepend an imperative check at all. `formatFunction`/
`formatSuite` there wrap the body in `(begin guard... realBody)` instead,
only when `guardLines` is non-empty (byte-for-byte unchanged otherwise).

## Verification

Every one of the 8 targets confirmed directly against a real interpreter
(not just written and assumed correct): a wrong-type call throws the
expected message, a correctly-typed call still returns the right result.
See `test/runtime-type-guards.test.js`.

## What this doesn't solve

- **Array length.** A guard proves "this is an array," not "this is the
  RIGHT array" — nothing here checks a passed array's length against a
  separately-passed `n`/`m` parameter (see #33/#34's own "What this
  doesn't add"). That's a structural limitation of the whole
  array-parameter design, not something a type guard could fix without a
  length-carrying array type, a materially larger addition.
- **Element type.** `Array.isArray([1, "two", null])` is still `true` in
  JS. These guards check array-*shape*, not that every element is
  actually a number — a deliberate scope limit, matching how nothing
  else in this library validates scalar parameter types either (a
  string passed where a number was expected isn't guarded against on any
  target, dynamic or static).
- **Statically-typed targets.** Not a gap — those targets already reject
  a type mismatch at compile time, which is strictly earlier and
  stronger than anything a runtime guard could offer.
