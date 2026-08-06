// exprforge/samples/catmull-rom.js
// Uniform Catmull-Rom spline interpolation, one scalar component at a time
// (call once per x/y/z with P0..P3 = that axis' control values).
const { num, v, mul, add, sub } = require("../ast.js");

// P(t) = 0.5 * ( 2*P1 + (-P0+P2)*t + (2*P0-5*P1+4*P2-P3)*t^2 + (-P0+3*P1-3*P2+P3)*t^3 )
const P0 = v("P0");
const P1 = v("P1");
const P2 = v("P2");
const P3 = v("P3");
const t = v("t");
const t2 = mul(t, t);
const t3 = mul(t, t, t);

const term0 = mul(num(2), P1);
const term1 = mul(sub(P2, P0), t);
const term2 = mul(add(mul(num(2), P0), mul(num(-5), P1), mul(num(4), P2), mul(num(-1), P3)), t2);
const term3 = mul(add(mul(num(-1), P0), mul(num(3), P1), mul(num(-3), P2), P3), t3);

const catmullRomAst = {
    name: "catmullRom1D",
    params: ["P0", "P1", "P2", "P3", "t"],
    body: mul(num(0.5), add(term0, term1, term2, term3)),
};

module.exports = { catmullRomAst };
