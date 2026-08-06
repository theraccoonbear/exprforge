// exprforge/ast.js
// Generic AST builder primitives — this is the actual library API. Compose
// these into your own expression trees; see samples/ for worked examples.
//
// Node shapes:
//   { type: "num",  value: number }
//   { type: "var",  name: string }
//   { type: "bin",  op: "+" | "-" | "*" | "/", left: Node, right: Node }
//   { type: "call", name: string, args: Node[] }   // any Math.* function
//
// Every "bin" node is emitted with explicit parens in every target, so
// operation order (and therefore floating-point rounding behavior) is
// identical everywhere.

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

function div(a, b) {
    return bin("/", a, b);
}

module.exports = { num, v, bin, call, add, mul, sub, div };
