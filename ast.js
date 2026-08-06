// exprforge/ast.js
// Hand-authored AST for uniform Catmull-Rom spline interpolation, one scalar
// component at a time (call once per x/y/z with P0..P3 = that axis' control values).
//
// Node shapes:
//   { type: "num",  value: number }
//   { type: "var",  name: string }
//   { type: "bin",  op: "+" | "-" | "*" | "/", left: Node, right: Node }
//   { type: "call", name: string, args: Node[] }   // any Math.* function
//
// Every "bin" node is emitted with explicit parens in BOTH targets, so operation
// order (and therefore floating-point rounding behavior) is identical everywhere.

function num(value) {
    return { type: "num", value };
}

function v(name) {
    return { type: "var", name };
}

function bin(op, left, right) {
    return { type: "bin", op, left, right };
}

function call(name, ...args) {
    return { type: "call", name, args };
}

function add(...terms) {
    return terms.reduce((acc, t) => (acc === null ? t : bin("+", acc, t)), null);
}

function mul(...terms) {
    return terms.reduce((acc, t) => (acc === null ? t : bin("*", acc, t)), null);
}

function sub(a, b) {
    return bin("-", a, b);
}

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

module.exports = { num, v, bin, call, add, mul, sub, catmullRomAst };
