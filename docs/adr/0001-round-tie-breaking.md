# 0001: `round()` ties away from zero on every target

**Status:** Accepted (shipped)

## Context

`round(x)` at an exact `.5` boundary has three genuinely incompatible
native conventions across ExprForge's targets: ties-toward-+∞ (JS,
TypeScript, Java, Lua), ties-to-even/"banker's rounding" (Python,
Scheme, QB64, C#), and ties-away-from-zero (C, Rust, Go, Perl, Zig,
Fortran, COBOL, Julia, PHP). ExprForge's emitters were each just
forwarding to the target's own native rounding function or a
locally-"obvious" formula, so `round(-0.5)` silently returned a
different value depending only on which target compiled it — a real
violation of "author once, identical behavior everywhere," found by
auditing every target directly rather than assumed.

## Decision

Standardize `round()` on **ties away from zero** on all 18 targets,
unconditionally, no opt-out. Chosen because it was already the majority
(9 of the pre-existing 17 non-JS-family targets), and because this
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
