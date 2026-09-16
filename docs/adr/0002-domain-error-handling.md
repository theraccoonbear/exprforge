# 0002: Out-of-domain math primitives return NaN/Infinity on every target

**Status:** Accepted (shipped)

## Context

`sqrt`/`log`/`log2`/`log10`/`asin`/`acos`/`pow` given an out-of-domain
argument (a negative `sqrt`, a non-positive `log`, `asin`/`acos` outside
`[-1, 1]`, `pow` with a negative base and a non-integer exponent) behave
completely differently across targets — not just "a different number,"
but different in *kind*: a hard crash, a language exception, a silent
type change, or a silently wrong value. Found by auditing each target's
real math library directly, triggered by a real consumer report about a
related comparison-operator bug that prompted a full audit of this
class of divergence.

## Decision

Standardize on clean IEEE754 `NaN`/`±Infinity` propagation — never
throw, never crash, never change result type — on every target where
that's achievable without disproportionate risk:

- **QB64**: `SQR`/`LOG`/`^` halt the program and hang on an interactive
  prompt in a non-interactive context. Fixed with real helper
  `FUNCTION`s using genuine `IF`/`THEN`/`ELSE` *statements* (confirmed
  to actually short-circuit, unlike `select()`'s arithmetic-emulation
  trick, which can't guard this at all).
- **Python**: raises `ValueError`. Fixed with an inline `if`/`else`
  ternary (confirmed short-circuiting).
- **Perl**: the builtin `sqrt`/`log`/`log2` raise a fatal error;
  `asin`/`acos`/`pow` were already fine. Fixed with an inline ternary
  and a confirmed-safe NaN/Infinity synthesis idiom.
- **Scheme/Guile**: the most dangerous divergence found — silently
  **promotes to a complex number** instead of crashing or returning
  NaN. Fixed with a real `if` guard (confirmed short-circuiting).
- **GnuCOBOL**: silently returns `0` — not NaN, not a crash, just a
  wrong number. **Deliberately left as-is.** A fix needs 5 different
  `IF`-guarded helper functions piled into one compilation unit — the
  exact shape already confirmed to trigger a fatal GnuCOBOL codegen bug
  (`cob_decimal`) when 2+ distinct helper `FUNCTION-ID`s are called from
  one `PROCEDURE DIVISION`. Not worth risking that crash class to fix a
  target whose math intrinsics are already documented elsewhere as not
  fully reliable.
- **Fortran**: narrow, deliberate exception — `gfortran` refuses to
  *compile* an expression made entirely of literal, out-of-domain
  constants (the identical value through a runtime variable compiles
  and returns NaN correctly). Loud and immediate, avoidable by
  construction. Not fixed.
- Every other target (JS, TypeScript, C, Rust, Go, Java, Lua, PHP, Zig,
  C#) was already correct.

## Consequences

QB64/Python/Perl/Scheme changed real, observable behavior (no more
crash/exception/complex-number-promotion). GnuCOBOL and Fortran carry
confirmed, tracked, unfixed divergences — a caller relying on either for
out-of-domain math needs to know that going in.

## Evidence

- `samples/domain-safety-demo.js` — full per-target breakdown, verified
  directly.
- `test/conformance.test.js`'s `domainSafety` registration (with
  `skipTargets: ["COBOL"]`) — the permanent regression test.
- Root `README.md`'s "Domain errors" section — user-facing summary.
