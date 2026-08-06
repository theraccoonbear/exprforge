// exprforge/samples/fibonacci.js
// nth Fibonacci number via the closed form (Binet's formula), not recursion
// or a loop — exprforge has no control flow (see README), so this is the
// shape a "fibonacci" example has to take here:
//
//   F(n) = (phi^n - psi^n) / sqrt(5)
//   phi  = (1 + sqrt(5)) / 2   (golden ratio)
//   psi  = (1 - sqrt(5)) / 2
//
// float64 throughout, so exact only up to about n=70 before precision drifts.
const { num, v, call, sub, add, div } = require("../ast.js");

const sqrt5 = call("sqrt", num(5));
const phi = div(add(num(1), sqrt5), num(2));
const psi = div(sub(num(1), sqrt5), num(2));
const n = v("n");

const fibonacciAst = {
    name: "fibonacci",
    params: ["n"],
    body: div(sub(call("pow", phi, n), call("pow", psi, n)), sqrt5),
};

module.exports = { fibonacciAst };
