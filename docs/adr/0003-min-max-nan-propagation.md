# 0003: `min()`/`max()` propagate NaN on every target

**Status:** Accepted (shipped)

## Context

Following up on 0001/0002's normalization work, `min`/`max` with a NaN
operand were audited the same way and found to diverge just as badly —
confirmed directly against a real compiler/interpreter for every
target, both argument orders:

- **Propagates NaN already** (no fix needed): JS, TypeScript, Go, Java,
  C#, Julia, Scheme.
- **NaN-ignoring** (returns the real operand regardless of position):
  C (`fmin`/`fmax`), Rust (`.min()`/`.max()`), Zig (`@min`/`@max`) — all
  three by spec (C99-style `fmin`/`fmax` semantics).
- **Position-dependent, first-argument-wins**: Python (comparison-based
  — a comparison against NaN is always `False`, so the first argument
  is never replaced), Lua (same shape), QB64 (`_MIN`/`_MAX`, same
  shape).
- **Position-dependent, second-argument-wins**: PHP (`min`/`max`) — the
  same landmine, opposite position.
- **Internally inconsistent with itself**: Perl (`List::Util::min`
  first-wins, `List::Util::max` second-wins — not even a consistent
  rule between its own two functions).
- **Flatly wrong, not just divergent**: GnuCOBOL's `FUNCTION MIN`
  returns a literal `0` for a NaN operand — neither operand's actual
  value, in either order. `FUNCTION MAX` at least returns the real
  operand (NaN-ignoring, like C/Rust/Zig).
- **Context-dependent, previously unknown**: Fortran (`MIN`/`MAX`) —
  the trickiest one found. `MIN(nan, 5.0d0)` at a top-level `PROGRAM`'s
  own scope correctly returns NaN, but the IDENTICAL expression, called
  from inside a `SUBROUTINE`/`FUNCTION` (every real target ExprForge
  ever emits is one — no ExprForge-generated Fortran runs at top-level
  scope), silently drops the NaN and returns the real operand instead.
  Confirmed reproducible at both `-O0` and `-O2` (not an optimizer
  artifact), regardless of whether the NaN arrives via a dummy argument,
  a local variable, or a nested `SQRT` call — narrowed down to a
  minimal repro (see this ADR's own Evidence section) before concluding
  it's genuinely about the subroutine-call boundary itself, not
  anything about how the NaN was produced. Not the same issue as the
  already-known compile-time-literal-constant gap (0002) — this one
  happens with perfectly ordinary runtime variables. A real gfortran
  bug (this container's version: `GNU Fortran (GCC) 15.2.1`), likely
  worth an upstream report.

## Decision

Standardize on **NaN propagation** (any NaN operand → NaN result),
matching the interpreter (`evaluate.js`, JS-based, the reference every
conformance test compares against) and the largest existing group (7 of
17 execution targets, for free). Fixed with an explicit guard ahead of
the real call on every non-conforming target except one:

- **C/Rust/Zig**: `isnan()`/`.is_nan()`/`std.math.isNan()` guard.
- **Python/Lua/QB64**: self-inequality NaN test (`x != x` / `x ~= x` /
  `x <> x` — an IEEE NaN never compares equal to itself) ahead of the
  call. QB64 needed new helper `FUNCTION`s (`ef_safe_min#`/
  `ef_safe_max#`), same pattern as 0002's QB64 fix.
- **PHP**: `is_nan()` guard.
- **Perl**: same self-inequality test plus the existing confirmed-safe
  NaN synthesis idiom from 0002.
- **Fortran**: fixed, not documented-and-left, despite being a genuine
  compiler bug rather than a documented language convention — unlike
  0002's Fortran exception, this one is fully avoidable at the call
  site with no risk (no crash class to avoid reintroducing, unlike
  GnuCOBOL below). `MERGE` (already this file's own `sign:` entry's own
  tool — an elemental intrinsic, evaluates both arguments
  unconditionally, safe here since neither branch can crash) picks
  between `MIN`/`MAX`'s own occasionally-wrong result and `a + b`
  (guaranteed NaN whenever either operand is, regardless of which one),
  gated on Fortran's own self-inequality NaN test (`/=`).
- **GnuCOBOL**: **not fixed, deliberately.** A real fix needs a new
  helper `FUNCTION-ID` (COBOL has no ternary) — the exact shape already
  confirmed (0002, and `comparisonOps`/`nestedSelect`/`arraySuite`'s own
  `skipTargets`) to crash `cobc` with a fatal `cob_decimal` error when
  2+ distinct helper `FUNCTION-ID`s are called from one `PROCEDURE
  DIVISION`. Left as a documented, tracked divergence instead of risking
  that crash class to fix an intrinsic this narrow.

## Consequences

C/Rust/Zig/Python/Lua/PHP/Perl/QB64 all changed real, observable
behavior for a NaN operand to `min`/`max` (previously silent, arbitrary,
sometimes position-dependent — now always NaN, matching every other
target). GnuCOBOL carries a confirmed, tracked, unfixed divergence for
this specific case, on top of the ones already tracked in 0002.

## Related, lower-severity finding — not fixed, flagged only

JS's and Java's *native* `sign(-0.0)` return `-0.0` (sign-preserving,
per each language's own documented semantics), while every other
target's `sign()` (built from a `> 0 / < 0 / else 0` ternary, or a
zero-normalizing native function) returns `+0.0`. Numerically equal
either way (`-0.0 == 0.0` is true in every target, and
`test/conformance.test.js`'s `assertClose` treats them as matching) —
only observable to a caller doing an `Object.is`-style or
sign-bit-sensitive check. Not pursued further: no confirmed real-world
impact found, unlike the min/max divergence above.

## Evidence

- `samples/math-edge-cases-demo.js` — full per-target breakdown,
  verified directly (including the raw builtin behavior AND the actual
  emitted-code behavior for every fix).
- `test/conformance.test.js`'s `mathEdgeCases` registration (with
  `skipTargets: ["COBOL"]`) — the permanent regression test.
- `emitters/c.js`/`rust.js`/`zig.js`/`python.js`/`lua.js`/`php.js`/
  `perl.js`/`qb64.js`'s own `min:`/`max:` comments — the per-target fix
  rationale, next to the code.
- `emitters/cobol.js`'s own `min:`/`max:` comment — the unfixed-target
  rationale.
