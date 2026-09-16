// exprforge/samples/domain-safety-demo.js
//
// Locks in, via a real compiled/executed conformance test, that every
// domain-sensitive primitive (sqrt, log, log2, log10, asin, acos, pow)
// returns NaN/Infinity for an out-of-domain argument identically on
// every target -- never crashes, never silently changes type.
//
// This WASN'T true before, and it wasn't hypothetical -- found while
// auditing (not guessing) what each target's real math library actually
// does for an out-of-domain argument (sqrt of a negative, log of a
// non-positive number, asin/acos outside [-1, 1], pow with a negative
// base and a non-integer exponent). Confirmed directly against a real
// compiler/interpreter for every target, not assumed:
//
//   - JS, TypeScript, C, Rust, Go, Java, Lua, PHP, Zig, C#: already
//     correct -- clean IEEE754 NaN/-Infinity, never throw. No change
//     needed.
//   - QB64: the classic SQR/LOG/^ keywords don't return NaN -- they
//     HALT THE PROGRAM ("Illegal function call") and, in any
//     non-interactive context (a real compiled game/tool, or this
//     project's own test harness), hang forever on an interactive
//     "Continue?" prompt. Worse than a wrong answer: a real crash/hang.
//     Fixed with real helper FUNCTIONs using genuine IF/THEN/ELSE
//     *statements* (confirmed to actually short-circuit, unlike
//     select()'s own arithmetic-emulation trick, which can't guard this
//     at all -- see emitters/qb64.js's own SAFE_MATH_HELPERS comment for
//     the full story).
//   - Python: math.sqrt/log/log2/log10/asin/acos/pow all RAISE
//     ValueError for an out-of-domain argument. Fixed with an inline
//     ternary (`a if cond else b`) -- confirmed short-circuiting.
//   - Perl: the builtin sqrt/log (and log2, built from log) raise a
//     fatal error ("Can't take sqrt of -1") -- even POSIX::sqrt/
//     POSIX::log hit the identical error, confirmed not a separate
//     direct libm call. asin/acos (via POSIX) and pow (via `**`) were
//     already safe. Fixed the two real gaps with an inline ternary and a
//     confirmed-safe NaN/Infinity synthesis (9**9**9 - 9**9**9, 9**9**9).
//   - Scheme/Guile: the most dangerous divergence found -- sqrt/log/
//     asin/acos/expt don't crash OR return NaN, they silently PROMOTE TO
//     A COMPLEX NUMBER (e.g. (sqrt -1.0) => 0.0+1.0i). Fixed with a real
//     `if` guard (confirmed short-circuiting) and confirmed-safe
//     (/ 0.0 0.0) / (/ 1.0 0.0) / (/ -1.0 0.0) NaN/Infinity synthesis.
//   - Fortran: NOT fixed, deliberately -- a real but much narrower issue
//     (a COMPILE-TIME error, not a runtime crash/wrong-behavior) that
//     only triggers when BOTH the argument(s) are literal compile-time
//     constants AND out of domain (e.g. authoring `sqrt(-4)` directly
//     with literal numbers) -- confirmed a runtime VARIABLE holding the
//     identical out-of-domain value compiles and returns NaN correctly.
//     Loud and immediate (a compile error, not a silent wrong answer or
//     a hang) and avoidable by construction (don't author a literal
//     out-of-domain constant), unlike every fix above.
const { v, num, call, div, outputs } = require("../ast.js");

const x = v("x");

const domainSafetyAst = {
    name: "domainSafety",
    params: ["x"],
    body: outputs({
        sqrtR: call("sqrt", x),
        logR: call("log", x),
        asinR: call("asin", x),
        acosR: call("acos", x),
        powR: call("pow", x, div(num(1), num(3))),
        log2R: call("log2", x),
        log10R: call("log10", x),
    }),
};

module.exports = { domainSafetyAst };
