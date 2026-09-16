// exprforge/samples/differentiate-demo.js
//
// Not a worked example -- a conformance-test fixture proving
// differentiate()'s OUTPUT compiles and runs correctly on every real
// target, not just evaluated in-process via numericalDerivative() (see
// test/differentiate.test.js's own central-difference checks, which
// only ever exercise evaluate()/JS -- they can't reveal a target-
// language syntax or semantics mismatch in the DERIVATIVE tree any more
// than any other JS-only check could, by construction; see this
// project's own comparison-operator-bug history and
// CLAUDE.md's "real compiled/executed conformance coverage" rule for
// exactly why that gap matters).
//
// f(x) = x^2 * sin(x) -- the root README's own canonical differentiate()
// example. Its derivative (2*x*sin(x) + x^2*cos(x), by the product and
// chain rules) exercises pow's chain rule, mul's product rule, and both
// sin/cos in one tree -- not exhaustive of every differentiable
// primitive (see differentiate.js's own NON_DIFFERENTIABLE set and rule
// list for the full set this doesn't individually exercise), but a real
// mix, not a trivial single-rule case.
const { v, num, call, mul } = require("../ast.js");
const { differentiate } = require("../differentiate.js");

const f = mul(call("pow", v("x"), num(2)), call("sin", v("x")));

const differentiateDemoAst = {
    name: "differentiateDemo",
    params: ["x"],
    body: differentiate(f, "x"),
};

module.exports = { differentiateDemoAst };
