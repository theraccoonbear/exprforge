# 0005: Boundary-condition conformance (huge, non-finite, signed-zero, degenerate operands)

**Status:** Accepted (shipped)

## Context

0001-0003 unified `round()` ties, domain errors and `min`/`max` NaN
propagation. An audit for issue #45 probed the remaining numeric
boundaries against every real toolchain, using the reference
interpreter (`evaluate.js`, JS semantics) as the specification. Before
probing, the conformance harness was changed so it could not hide
divergence:

- Finite results are compared by ULP distance (default budget 64), not
  an absolute 1e-9 below `|e| < 1`. A sample can opt into `exact`
  (`Object.is`), `signedZero`, or a tighter `maxUlps`.
- Every harness prints 17 significant digits or an exact round-trip
  form (`%.17g`, Rust `{:e}`, Java `Double.toString`, Fortran
  `ES32.16E3`) instead of fixed `%.17f`/`F0.17`.
- NaN, Infinity and `-0` are passed as ordinary arguments, which
  exercises each target's argument parsing (Lua, PHP, Scheme and QB64
  need explicit helpers in the harness; GnuCOBOL's `NUMVAL` cannot read
  them at all).
- A failing sample reports every mismatching row, not only the first.
- The QB64 harness traps runtime errors and prints the error code
  instead of opening a dialog.

The stricter comparison found one pre-existing divergence in an existing
sample: GnuCOBOL's `COS` near `cos(pi/2)` returns about 2.8e-16 where
IEEE libm returns 6.1e-17. `splineFrame.SpEfRollFrame` grants COBOL an
explicit `absTol: 1e-15` for that cancellation-to-zero residue.

## Decisions

### Unified (reference behavior now matched)

| Behavior | What was wrong | Fix |
|---|---|---|
| `floor`/`ceil`/`trunc`/`round` of NaN, ±Inf, huge values | Python raised `OverflowError`/`ValueError`; Java `trunc` went through `(long)` and saturated at 9.2e18 (NaN to 0); Fortran `FLOOR`/`CEILING` returned a 32-bit INTEGER (3e9 became -2147483648); QB64 `INT` saturated at 2^63 and `SGN*INT` mapped NaN to 0; C# `round` threw `ArithmeticException` on NaN (`Math.Sign`); PHP `round(4503599627370496.0)` returned 4503599627370497.0 | Python `isfinite` guards, Java `ceil`/`floor` select, Fortran `AINT`-based floor/ceil, QB64 helper functions, C# `Math.Round(x, AwayFromZero)`, PHP exact ties-away expression |
| `sign(NaN)`, `sign(-0)` | NaN became 0 on C, Go, Rust, Python, Lua, PHP, Perl, Fortran, Zig, Scheme, QB64; C# `Math.Sign` threw; `-0` became `+0` everywhere except JS, TypeScript, Java and Julia; R's and Octave's native `sign(-0)` is `+0` | the zero branch returns `x` itself, so NaN stays NaN and `-0` stays `-0` (`Math.sign` semantics); R and Octave wrap the native call |
| `round` | the `floor(abs(x) + 0.5)` formula was off by one at `0.49999999999999994` and above 2^52 | exact floor-plus-fraction form (see 0001 addendum) |
| `pow(1, y)`, `pow(-1, ±Inf)` | NaN on JS, TypeScript, Java and the interpreter; R and Scheme gave NaN for `pow(-1, ±Inf)` | guarded to 1 (see "pow special cases" below) |
| sign of a zero result from `floor`/`ceil`/`trunc`/`round` | `+0` for `-0` or `(-1, 0)` inputs on Python, Lua, Fortran (`ceil`) and PHP (`round`) | sign restored from the operand |
| `hypot` overflow/underflow/Inf/NaN | `sqrt(a*a+b*b)` overflowed (QB64, Lua, Scheme, C#); Zig `std.math.hypot` returned NaN at 1e200 and 1e-200 | Hybrid: plain `sqrt(a*a+b*b)` when the sum is in `[1e-290, 1e300]` (bit-identical to before), else scaled form with explicit Inf/NaN handling; C# uses `double.Hypot` |
| `exp` overflow | QB64 raised runtime error 6 (a fatal dialog) for `exp(710)`; Python raised `OverflowError` | QB64 helper, Python helper |
| `pow` with 0 or infinite operands, overflow | Python raised for `0 ** negative`, overflow and infinite exponents; Scheme returned NaN for `pow(0, negative)` | Python `_ef_pow` helper, Scheme guard |
| `atan2(±0, ±0)` and infinities | no divergence found on any target | none needed; now covered |
| `wrapIndex` with `m = 0`, negative `m`, fractional operands | Python raised `ZeroDivisionError`; Perl `%` truncates to integers and dies on 0; Rust `rem_euclid` and Zig `@mod` disagree for negative `m`; Scheme `modulo` rejects fractions and 0 | all follow `((i % m) + m) % m` with truncated `%` (`fmod`); `m = 0` is NaN |
| Overflow to ±Inf, subnormals | none found beyond the above | now covered |
| Unrepresentable literals | GnuCOBOL emitted a >38-digit literal that failed to compile | `cobol.js` throws "not supported for this target" at generation time |

### Documented divergences (specific, justified, tested)

- **`pow(-0, odd or negative integer)` on Perl**: Perl's `**` returns
  `+0` / `+Inf` where IEEE and the reference return `-0` / `-Inf`.
  `boundary.powSignedZero` skips Perl.
- **`pow(-2, 1e300)` on Zig**: `std.math.pow` returns NaN where the
  reference returns Infinity. Skipped on Zig in `boundary.pow.hugeExponent`.
- **`exp(709.5)` on Go**: `math.Exp` returns +Inf (reference
  1.3549863193146328e+308) on the tested amd64 toolchain.
  `boundary.expNearOverflow` skips Go.
- **GnuCOBOL**: cannot hold NaN or Infinity (see 0002 and 0003, results
  collapse to 0), cannot read exponent notation, NaN, Infinity or `-0`
  arguments through `NUMVAL`, rejects literals over 38 digits, aborts
  with a fatal arithmetic error on `pow(-2, 1000000000000001)`, returns
  0 for `pow(0, negative)`, and returns 0 for `wrapIndex` with `m = 0`.
  Conformance rows that need any of these are excluded for COBOL only.
- **QB64**: `PRINT`/`STR$`/`VAL` carry about 15-16 significant digits,
  so full-precision round-trip rows and values near DBL_MAX are skipped
  there (`boundary.passThrough.fullPrecision`). The harness prints
  `-0` itself because `PRINT` drops the sign of zero.
- **Sign of a zero result**: `floor`/`ceil`/`trunc`/`round`/`sign`,
  pass-through, negation, `atan2` and `pow` with a `±0` base are tested
  for sign and match the reference everywhere except GnuCOBOL, which has
  no negative zero. `wrapIndex` landing on zero is not guaranteed.
- **Perl `-0 * integer`**: Perl multiplies integer-valued operands through
  an integer path, so `-0.0 * 1` is `+0`. Probes that need to keep a
  `-0` use double negation instead of `* 1`.
- **`wrapIndex` with non-finite operands** is unspecified (Julia and
  Fortran return a finite value for an infinite `m`).
- **Lua callers must pass floats.** The emitted Lua is float-correct
  only for float arguments: an integer-subtype argument makes `%` by
  zero an error and lets `*` wrap on overflow. The conformance harness
  now converts arguments with `+ 0.0`.

### Decisions

1. **`sign(-0)` is `-0` and `sign(NaN)` is NaN on every target.** This is
   `Math.sign`, the reference. The hand-built templates return `x` in the
   final branch; Julia's native `sign` already agrees; R and Octave wrap
   theirs. GnuCOBOL has neither value.
2. **`round()` is exact** (ADR 0001 unchanged: ties away from zero),
   see the 0001 addendum. `-0` is preserved for inputs in `(-0.5, -0]`.
3. **`pow` special cases follow IEEE 754** (below).

### `pow` special cases follow IEEE 754

`pow(1, y)` is 1 for every `y`, including NaN, and `pow(-1, ±Infinity)`
is 1. Rationale: IEEE 754-2008 and C99 Annex F specify these results;
it needs the fewest guards (only the interpreter, JavaScript,
TypeScript and Java, plus R and Scheme for `pow(-1, ±Infinity)`, change
while every other target already returned 1); and it matches what C and
Fortran users expect. JavaScript's `Math.pow` and Java's `Math.pow`
deliberately deviate from IEEE here, returning NaN, so the emitted code
guards the case instead of forwarding to them. `boundary.powIeeeCorners`
runs on every target except GnuCOBOL.

## Evidence

- `samples/boundary-conditions-demo.js` and the `boundary.*`
  registrations at the end of `test/conformance.test.js`.
- `test/conformance.test.js`'s `assertClose` and its comment for the
  comparison policy.
- Root `README.md`, "Numeric guarantees".
