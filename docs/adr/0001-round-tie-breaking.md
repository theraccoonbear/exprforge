# 0001: `round()` ties away from zero on every target

**Status:** Accepted (shipped)

## Context

`round(x)` at an exact `.5` boundary has three genuinely incompatible
native conventions across ExprForge's targets: ties-toward-+∞ (JS,
TypeScript, Java, Lua), ties-to-even/"banker's rounding" (Python,
Scheme, QB64, C#, R), and ties-away-from-zero (C, Rust, Go, Perl, Ruby,
Zig, Fortran, COBOL, Julia, PHP, MATLAB/Octave). ExprForge's emitters were each just
forwarding to the target's own native rounding function or a
locally-"obvious" formula, so `round(-0.5)` silently returned a
different value depending only on which target compiled it — a real
violation of "author once, identical behavior everywhere," found by
auditing every target directly rather than assumed.

## Decision

Standardize `round()` on **ties away from zero** on every executable target,
unconditionally, no opt-out. Chosen because it was already the majority
(11 of the 20 programming-language targets), and because this
project's own Julia emitter had already, independently, chosen to match
it (`RoundNearestTiesAway`) before this decision existed — real
precedent, not an arbitrary pick. Built from `sign(x) * floor(abs(x) +
0.5)`, the same formula `emitters/cobol.js`'s hand-written `round`
template already used.

## Consequences

8 targets (JS, TypeScript, Java, Lua, Python, Scheme, QB64, C#) changed
behavior at exact `.5` boundaries — a real, one-time, non-configurable
change. A caller who genuinely needs a *different* guaranteed
tie-breaking convention should compose it from `floor`/`ceil`/`sign`/
`abs` (which already agree everywhere) instead of using `round()`.

## Evidence

- `samples/round-tie-demo.js` — full per-target breakdown of what each
  of the 8 changed targets used to do, verified directly.
- `test/conformance.test.js`'s `roundTieBoundary` registration — the
  permanent regression test.
- Root `README.md`'s "`round()` at exact `.5` boundaries" section — the
  user-facing summary and per-language table.

## Addendum: MATLAB/Octave

MATLAB/Octave `round` ties away from zero natively (verified in Octave:
`round(-2.5)` is `-3`), so the emitter uses it directly, with no
derivation. It is covered by `roundTieBoundary` under the "Octave" label.

## Addendum: exactness requirement

`sign(x) * floor(abs(x) + 0.5)` is not exact: `abs(x) + 0.5` rounds, so
it returns 1 for `0.49999999999999994` and rounds `4503599627370497`
(above 2^52, where the addition is inexact) to `4503599627370498`.
`round()` therefore must be exact for every finite double. Targets
without a native ties-away rounder compute `f = floor(|x|)`, then
`f + 1` when `|x| - f >= 0.5` (the subtraction is exact), and reapply the
sign of `x`. The sign of a zero result is kept: `round(-0.4)` and
`round(-0)` are `-0`, as `Math.sign(x) * r` yields in the reference.
Applies to the interpreter, JavaScript, TypeScript, Java, Lua, Python,
Scheme, R and QB64. Native exact rounders (C, Go, Rust, Zig, Julia,
Fortran, Perl, PHP expression, C#, MATLAB/Octave) are unchanged, and
GnuCOBOL's decimal arithmetic is exact already.
`boundary.roundPrecisionEdge` enforces this on every target.
