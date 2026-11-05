# 0004: Division by zero follows IEEE 754 on every target where achievable

**Status:** Accepted (shipped)

## Context

Every `bin` node with op `/` is emitted as a plain division. With a zero
denominator at runtime the targets diverged in kind, not just in value:

- JS (the reference interpreter), TypeScript, C, Go, Rust, Java, Lua, C#,
  Zig, Julia, Ruby, R, Fortran, Scheme, QB64 and MATLAB/Octave (verified under
  Octave 11.1) return IEEE 754 results:
  `x/0` is `+Infinity` or `-Infinity`, `0/0` is `NaN`.
- **Python** raises `ZeroDivisionError`.
- **Perl** dies with "Illegal division by zero".
- **PHP 8** throws `DivisionByZeroError`.
- **GnuCOBOL** does not raise either: `COMPUTE` is decimal arithmetic, a
  zero denominator is a size error, and the target field is left
  unchanged (so the caller sees a stale value, typically `0`).

No conformance sample divided by a runtime zero, so CI could not see any
of this.

## Decision

Standardize on the reference interpreter's IEEE 754 behavior:

- `x/0` is `+Infinity` or `-Infinity`; the sign is the product of both
  operand signs, including a `-0` denominator.
- `0/0` and `NaN/0` are `NaN`.

Per target:

- **PHP:** `fdiv()` (PHP 8.0+), exact IEEE division.
- **Python:** a `_exprforge_div(a, b)` helper `def`, emitted once per
  file. It performs `a / b` inside `try`/`except ZeroDivisionError`, so
  the normal path costs nothing; the handler returns NaN for a zero or
  NaN numerator and otherwise `copysign(inf, a) * copysign(1.0, b)`.
- **Perl:** a `_exprforge_div` `sub`, emitted once per file, using the
  existing `9**9**9` Infinity/NaN synthesis and `POSIX::copysign` for
  the sign of a zero denominator.
- A helper function (not an inline conditional) is used for Python and
  Perl because an inline guard would need the numerator and denominator
  text twice, evaluating each sub-expression more than once. Both are
  emitted through the new `emitDiv` hook in `emitters/base.js`. When the
  denominator is a nonzero numeric literal the plain `/` is kept, since
  it can never be zero.
- The helper follows the `includeHelpers` mechanism
  (`docs/multi-function-files.md`): emitted by default, omitted with
  `{ includeHelpers: false }` on every call after the first of a
  concatenated file (Perl warns on a redefined sub under `use warnings`).
- **QB64, Scheme, and all other targets:** verified with real
  toolchains (see Evidence) to already return IEEE results, including
  the sign for a `-0` denominator. No change; ordinary division is
  byte-for-byte unchanged there.

## Justified exceptions

- **GnuCOBOL: not fixed, structural.** `COMPUTE` evaluates in decimal
  arithmetic, which has no Infinity or NaN. Confirmed with a real
  `cobc` 3.2 program: a `MOVE` preserves an Infinity bit pattern held in
  a `COMP-2` field, but `COMPUTE y = inf` stores `0`, and `COMPUTE y =
  nan + 1` stores `1`. Even if a guarded division could produce
  Infinity as a final `MOVE`, any further arithmetic on it inside an
  expression would silently lose it, so identical results are not
  reachable. The division is still emitted as plain `COMPUTE`; a zero
  denominator leaves the target unchanged. The conformance registration
  uses `skipTargets: ["COBOL"]`. This is tracked follow-up, not settled
  scope.
- **Go and Fortran: literal zero denominator.** The compilers reject a
  division by a literal constant zero at compile time (Go: "division by
  zero"; gfortran: "Division by zero"), even for floating-point
  operands. Loud, immediate and avoidable by construction (the same
  shape as the Fortran exception in ADR 0002); a runtime variable
  holding zero compiles and returns IEEE results, which is what the
  conformance sample uses.
- **Perl: `-0` from integer arithmetic.** Perl multiplies two
  integer-valued operands as integers, so `0 * -1` is `+0` in Perl
  itself, before any division happens. The division helper honors a
  genuine `-0.0` (for example `0 * -0.5`); the sample synthesizes `-0`
  that way for this reason.

## Consequences

Python, Perl and PHP no longer raise on a zero denominator; they return
the same values as the interpreter. Python and Perl output now carries
one small helper definition per file. GnuCOBOL carries a confirmed,
tracked, unfixed divergence.

## Evidence

- `samples/division-by-zero-demo.js` — the fixture: `x/0`, `x/-0`,
  `0/0`, `0/-0`, `NaN/0`, `1/(x/0)` and an ordinary division, with the
  zero a runtime parameter and `-0` synthesized in the expression.
- `test/conformance.test.js`'s `divisionByZero` registration (with
  `skipTargets: ["COBOL"]`) — compiled/executed on every available
  toolchain.
- `test/division.test.js` — static per-emitter checks of each target's
  division form, single evaluation of operands, `includeHelpers`, and a
  real concatenated-file run for Python and Perl.
