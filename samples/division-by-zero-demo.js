// exprforge/samples/division-by-zero-demo.js
//
// Coverage fixture for division by a runtime zero. Before this existed no
// sample divided by zero at all, so the targets' divergence was invisible
// to CI: Python raised ZeroDivisionError, Perl died with "Illegal division
// by zero", and PHP 8 threw DivisionByZeroError, while the other targets
// returned IEEE 754 results. See docs/adr/0004-division-by-zero.md for the
// decision record and the per-target breakdown.
//
// The standardized behavior is the reference interpreter's (IEEE 754):
//   x/0   -> +Infinity or -Infinity, sign from both operands, including a
//            -0 denominator
//   0/0   -> NaN
//   NaN/0 -> NaN
//
// The zero is a runtime parameter (zeroSrc), never a literal, so no
// compiler can constant-fold the division away. A -0 denominator cannot be
// passed through a CLI argument cleanly on every target (String(-0) is
// "0"), so it is synthesized inside the expression as zeroSrc * -0.5,
// the same way math-edge-cases-demo.js synthesizes NaN internally. The
// factor is deliberately not integer-valued: Perl multiplies two
// integer-valued operands as integers, which loses the sign of zero
// (0 * -1 is +0 there), while a non-integer factor takes the float path
// and yields a true -0.0. NaN here is 0/0 itself, then divided by zero
// again.
const { v, num, div, mul, add, outputs } = require("../ast.js");

const x = v("x");
const zeroSrc = v("zeroSrc");
const negZero = mul(zeroSrc, num(-0.5));
const nan = div(zeroSrc, zeroSrc);

const divisionByZeroAst = {
    name: "divisionByZero",
    params: ["x", "zeroSrc"],
    body: outputs({
        overPosZero: div(x, zeroSrc),
        overNegZero: div(x, negZero),
        zeroOverZero: div(zeroSrc, zeroSrc),
        zeroOverNegZero: div(zeroSrc, negZero),
        nanOverZero: div(nan, zeroSrc),
        recipOfInf: div(num(1), div(x, zeroSrc)),
        ordinary: div(x, add(zeroSrc, num(4))),
    }),
};

module.exports = { divisionByZeroAst };
