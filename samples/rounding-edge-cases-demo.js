// exprforge/samples/rounding-edge-cases-demo.js
//
// Pushes edge-case inputs through floor, ceil, trunc and round on every
// executable target. Several targets implement these through an integer
// cast or an integer-returning intrinsic (Java's (long) cast, Fortran's
// FLOOR/CEILING, Python's math.floor), which silently mangles or raises
// on NaN, +-Infinity and finite values beyond the integer range.
//
// The reference interpreter is the contract:
//   - NaN -> NaN, +-Infinity -> +-Infinity
//   - finite values beyond the integer range are returned as doubles
//     (trunc(1e300) is 1e300)
//   - the sign of zero is preserved: ceil/trunc/round of -0.4 are -0, and
//     floor/ceil/trunc/round of -0 are -0
//
// NaN and the infinities are generated inside the expression from a runtime
// zero (zeroSrc), since a command-line argument cannot carry them on every
// target. A -0 cannot cross a CLI argument either (String(-0) is "0"), so
// it is synthesized as zeroSrc * -0.5 (non-integer factor so Perl keeps the
// float path). The sign of a zero result is observable only through
// division, so every op also emits 1/op(x) and 1/op(-0).
//
// Overlaps in intent with samples/non-finite-rounding-demo.js (open PR for
// the Ruby emitter): the NaN/Infinity field names here use the same
// "<op>Nan", "<op>PosInf", "<op>NegInf" scheme so the two can be merged
// into one sample later.
const { v, num, div, mul, sub, call, outputs } = require("../ast.js");

const x = v("x");
const zeroSrc = v("zeroSrc");
const nan = div(zeroSrc, zeroSrc);
const posInf = div(num(1), zeroSrc);
const negInf = sub(num(0), posInf);
const negZero = mul(zeroSrc, num(-0.5));

const ops = ["floor", "ceil", "trunc", "round"];
const fields = {};
for (const op of ops) {
    fields[`${op}X`] = call(op, x);
    fields[`${op}XSign`] = div(num(1), call(op, x));
    fields[`${op}NegZeroSign`] = div(num(1), call(op, negZero));
    fields[`${op}Nan`] = call(op, nan);
    fields[`${op}PosInf`] = call(op, posInf);
    fields[`${op}NegInf`] = call(op, negInf);
}

const roundingEdgeCasesAst = {
    name: "roundingEdgeCases",
    params: ["x", "zeroSrc"],
    body: outputs(fields),
};

module.exports = { roundingEdgeCasesAst };
