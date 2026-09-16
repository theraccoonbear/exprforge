// exprforge/samples/math-edge-cases-demo.js
//
// Locks in, via a real compiled/executed conformance test, that min()/
// max() propagate NaN identically on every target -- never silently pick
// an arbitrary operand.
//
// This WASN'T true before, and it wasn't hypothetical -- found the same
// way the comparison-operator bug (see samples/comparison-ops-demo.js)
// and the domain-error divergence (see samples/domain-safety-demo.js)
// were found: by auditing every target's real min/max behavior with a
// NaN operand, not assuming they agree. Confirmed directly, not guessed:
//
//   - JS, TypeScript, Go, Java, C#, Julia, Scheme, Fortran: already
//     correct -- native min/max propagate NaN regardless of which
//     operand it's in. No change needed.
//   - C (fmin/fmax), Rust (.min()/.max()), Zig (@min/@max): all three
//     are C99-style NaN-IGNORING by spec -- if exactly one operand is
//     NaN, the OTHER (real) value comes back, confirmed both orders.
//     Fixed with an explicit isnan()/.is_nan()/std.math.isNan() guard.
//   - Python (builtin min/max), Lua (math.min/max), QB64 (_MIN/_MAX):
//     all three are comparison-based and POSITION-DEPENDENT -- since a
//     comparison against NaN is always false, whichever argument comes
//     FIRST silently wins whenever either is NaN (confirmed:
//     min(nan,5)==nan but min(5,nan)==5, same for max). Fixed with an
//     explicit self-inequality NaN test (an IEEE NaN never compares
//     equal to itself) ahead of the real call.
//   - PHP (min/max): the same position-dependent landmine, but the
//     OPPOSITE position wins (whichever argument comes SECOND).
//     Fixed the same way, using is_nan().
//   - Perl (List::Util::min/max): not even internally consistent with
//     itself -- min is first-wins, max is second-wins. Fixed the same
//     way, using the project's existing confirmed-safe NaN self-
//     inequality test and NaN-synthesis idiom (see domain-safety-demo.js).
//   - COBOL: NOT fixed, deliberately -- FUNCTION MAX returns the real
//     operand (ignores NaN, like C/Rust/Zig above), but FUNCTION MIN is
//     flatly wrong, not just divergent: confirmed it returns a literal 0
//     whenever either operand is NaN, neither operand's actual value.
//     A real fix needs a new helper FUNCTION-ID (COBOL has no ternary),
//     which is exactly the shape already confirmed to crash cobc with a
//     fatal cob_decimal error when 2+ distinct helper FUNCTION-IDs are
//     called from one PROCEDURE DIVISION (see emitters/cobol.js's own
//     min:/max: comment, and the same skipTargets reasoning already
//     applied to comparisonOps/nestedSelect/domainSafety/arraySuite).
//     Left as a documented, tracked divergence instead of risking that
//     crash class to fix an intrinsic this narrow.
//
// See docs/adr/0003-min-max-nan-propagation.md for the full decision
// record. NaN is synthesized internally via sqrt() of a NEGATIVE
// PARAMETER (negSrc) -- reusing domain-safety-demo's own already-
// verified-safe per-target NaN synthesis -- rather than trying to pass
// a literal NaN through each target's own CLI-argument-parsing code,
// which is untested, unrelated territory this sample isn't trying to
// cover.
//
// negSrc MUST be a genuine runtime parameter, not a literal constant
// (e.g. sqrt(neg(num(1)))) -- confirmed directly (a real gfortran
// compile failure, caught by this sample's own first conformance run)
// that a literal negative constant hits Fortran's own already-known,
// already-documented compile-time-constant-folding domain-error gap
// (see docs/adr/0002-domain-error-handling.md's own Fortran exception,
// and samples/domain-safety-demo.js for the same pattern) -- a
// DIFFERENT, unrelated, already-tracked issue that would otherwise look
// like a false failure of THIS sample's own min/max fix.
const { v, call, outputs } = require("../ast.js");

const nanVal = call("sqrt", v("negSrc"));

const mathEdgeCasesAst = {
    name: "mathEdgeCases",
    // NOT "real" -- a reserved Fortran type keyword, confirmed by this
    // sample's own second conformance run (a real emitters/fortran.js
    // checkReservedNames rejection, not a min/max bug either).
    params: ["realVal", "negSrc"],
    body: outputs({
        minNanFirst: call("min", nanVal, v("realVal")),
        minNanSecond: call("min", v("realVal"), nanVal),
        maxNanFirst: call("max", nanVal, v("realVal")),
        maxNanSecond: call("max", v("realVal"), nanVal),
    }),
};

module.exports = { mathEdgeCasesAst };
