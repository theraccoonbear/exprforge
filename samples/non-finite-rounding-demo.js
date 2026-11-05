// exprforge/samples/non-finite-rounding-demo.js
//
// Pushes NaN, +Infinity and -Infinity through floor, ceil, trunc and round
// on every executable target. Some languages raise or return an integer
// type for these inputs (Ruby's Float#floor raises FloatDomainError, for
// example), so the reference interpreter's behavior is the contract: each
// operation returns its non-finite argument unchanged.
//
// The non-finite values are generated inside the expression from a runtime
// zero (zeroSrc), since a command-line argument cannot carry NaN or
// Infinity on every target: NaN is 0/0 and the infinities are x/0 and
// 0 - x/0. Finite rounding of x itself is included as a sanity row.
const { v, num, div, sub, call, outputs } = require("../ast.js");

const x = v("x");
const zeroSrc = v("zeroSrc");
const nan = div(zeroSrc, zeroSrc);
const posInf = div(x, zeroSrc);
const negInf = sub(num(0), posInf);

const ops = ["floor", "ceil", "trunc", "round"];
const fields = {};
for (const op of ops) {
    fields[`${op}Nan`] = call(op, nan);
    fields[`${op}PosInf`] = call(op, posInf);
    fields[`${op}NegInf`] = call(op, negInf);
    fields[`${op}Finite`] = call(op, x);
}

const nonFiniteRoundingAst = {
    name: "nonFiniteRounding",
    params: ["x", "zeroSrc"],
    body: outputs(fields),
};

module.exports = { nonFiniteRoundingAst };
