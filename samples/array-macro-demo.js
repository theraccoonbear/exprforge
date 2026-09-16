// exprforge/samples/array-macro-demo.js
//
// Not a worked example -- a conformance-test fixture proving an
// array-typed parameter threaded THROUGH a macro call compiles and runs
// correctly on every real target, not just evaluate()/expandMacros()
// in-process (which this session already verified during the original
// footgun audit -- see docs/array-index-primitives.md's own history --
// but never through a real compiler). expandMacros() always runs before
// checkUnboundVars/emission (see emitters/base.js's own emitFunction),
// so by the time any real target ever sees this, `cyclicPick`'s call is
// already fully inlined -- arr is used correctly (only ever as an index
// target) in the EXPANDED tree, even though the unexpanded caller below
// passes it as a bare call argument, which would otherwise be rejected
// by ast.js's own array-misuse check if checkUnboundVars ever ran on
// this BEFORE expansion (it never does).
const { v, num, add, call } = require("../ast.js");
const { fn } = require("../fn.js");
const { loadMacro } = require("../macros.js");

loadMacro("cyclicPick", fn(["cyclicPick(arr: number[], m, i): return arr[wrapIndex(i, m)];"]));

const arrayMacroDemoAst = {
    name: "arrayMacroDemo",
    params: ["arr", "m", "i"],
    paramTypes: { arr: "number[]" },
    body: add(call("cyclicPick", v("arr"), v("m"), v("i")), num(1)),
};

module.exports = { arrayMacroDemoAst };
