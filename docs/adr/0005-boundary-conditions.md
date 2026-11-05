# 0005: Boundary-condition conformance (huge, non-finite, signed-zero, degenerate operands)

**Status:** Accepted (shipped), with open decisions listed below

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
| `sign(NaN)` | NaN became 0 on C, Go, Rust, Python, Lua, PHP, Perl, Fortran, Zig, Scheme, QB64; C# `Math.Sign` threw | the zero branch now yields `x + 0.0`, so NaN stays NaN |
| `hypot` overflow/underflow/Inf/NaN | `sqrt(a*a+b*b)` overflowed (QB64, Lua, Scheme, C#); Zig `std.math.hypot` returned NaN at 1e200 and 1e-200 | Hybrid: plain `sqrt(a*a+b*b)` when the sum is in `[1e-290, 1e300]` (bit-identical to before), else scaled form with explicit Inf/NaN handling; C# uses `double.Hypot` |
| `exp` overflow | QB64 raised runtime error 6 (a fatal dialog) for `exp(710)`; Python raised `OverflowError` | QB64 helper, Python helper |
| `pow` with 0 or infinite operands, overflow | Python raised for `0 ** negative`, overflow and infinite exponents; Scheme returned NaN for `pow(0, negative)` | Python `_ef_pow` helper, Scheme guard |
| `atan2(±0, ±0)` and infinities | no divergence found on any target | none needed; now covered |
| `wrapIndex` with `m = 0`, negative `m`, fractional operands | Python raised `ZeroDivisionError`; Perl `%` truncates to integers and dies on 0; Rust `rem_euclid` and Zig `@mod` disagree for negative `m`; Scheme `modulo` rejects fractions and 0 | all follow `((i % m) + m) % m` with truncated `%` (`fmod`); `m = 0` is NaN |
| Overflow to ±Inf, subnormals | none found beyond the above | now covered |
| Unrepresentable literals | GnuCOBOL emitted a >38-digit literal that failed to compile | `cobol.js` throws "not supported for this target" at generation time |

### Documented divergences (specific, justified, tested)

- **`pow(1, NaN)`, `pow(±1, ±Inf)`**: the reference (JS), TypeScript and
  Java return NaN; every other target follows IEEE 754-2008 / C99 and
  returns 1. Not unified because matching JS would mean wrapping `pow`
  in a guard on 14 targets for a case with no practical use, and the
  C99 result is the more widely implemented one. `boundary.powIeeeCorners`
  runs only on the targets that agree with the reference.
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
- **Sign of a zero result** from `floor`/`ceil`/`trunc`/`round`/`sign`/
  `wrapIndex` is not guaranteed: `-0` in is not guaranteed `-0` out.
  Pass-through, negation, `atan2`, and `pow` with a `±0` base are
  tested for sign.
- **`wrapIndex` with non-finite operands** is unspecified (Julia and
  Fortran return a finite value for an infinite `m`).
- **Lua callers must pass floats.** The emitted Lua is float-correct
  only for float arguments: an integer-subtype argument makes `%` by
  zero an error and lets `*` wrap on overflow. The conformance harness
  now converts arguments with `+ 0.0`.

### Open decisions

1. **`sign(-0)`.** JS, TypeScript and Java return `-0` (probed); Julia's
   native `sign` is documented to do the same (not separately probed);
   every other target returns `+0` (0003 already notes this). Unifying to `-0`
   means replacing `x + 0.0` by `x` in the zero branch of each `sign`
   template (one-token change per target; QB64 and COBOL excepted).
   Unifying to `+0` means normalizing JS, TypeScript, Java and Julia.
   Left as is. The sample compares sign without a signed-zero check.
2. **Reference `round()` formula.** `sign(x) * floor(abs(x) + 0.5)`
   (0001) returns 1 for `0.49999999999999994` and rounds
   `4503599627370497` to `4503599627370498`. Targets using a native
   round (C, Rust, Go, Perl, Julia, Fortran, Zig, and now PHP, QB64, C#
   and GnuCOBOL) return 0 and `4503599627370497`, which are the correct
   values. Interpreter, JS, TypeScript, Java, Lua, Python and Scheme
   follow the formula. Options: (a) change the reference and those
   formula targets to `floor(a) + (a - floor(a) >= 0.5 ? 1 : 0)` with the
   sign reapplied (exact for all finite doubles); (b) keep the formula
   and document it. `boundary.roundPrecisionEdge` is registered as
   `todo` until decided.
3. **`pow(1, NaN)` family.** Option (a) keep the documented split above;
   (b) make the four reference-side targets follow IEEE (`1`); (c) guard
   the 14 IEEE targets to return NaN.

## Evidence

- `samples/boundary-conditions-demo.js` and the `boundary.*`
  registrations at the end of `test/conformance.test.js`.
- `test/conformance.test.js`'s `assertClose` and its comment for the
  comparison policy.
- Root `README.md`, "Numeric guarantees".
