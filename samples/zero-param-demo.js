// exprforge/samples/zero-param-demo.js
//
// Not a worked example -- a conformance-test fixture proving a
// zero-parameter function compiles and runs correctly on every real
// target. Every conformance sample up to this point has at least one
// parameter, so every runX/runSuiteX harness's own argument-reading
// code generation (test/conformance.test.js) and every emitter's own
// formatFunction/formatSuite (a comma-joined parameter list, a
// destructured @_ in Perl, a `(args) => ...` reader per target, ...)
// has only ever been exercised with `fn.params.length >= 1` -- never
// proven safe at the one boundary value every one of those templates
// could plausibly mishandle (an empty join producing a stray comma, an
// empty destructure, a harness assuming at least one CLI argument to
// read).
const { num, call, add } = require("../ast.js");

const zeroParamDemoAst = {
    name: "zeroParamDemo",
    params: [],
    // sqrt(16) + sign(-3) -- a real, non-trivial computation (not just a
    // bare literal) with no inputs at all, matching how a caller might
    // legitimately use ExprForge for a fixed physical/mathematical
    // constant.
    body: add(call("sqrt", num(16)), call("sign", num(-3))),
};

module.exports = { zeroParamDemoAst };
