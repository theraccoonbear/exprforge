// exprforge/samples/comparison-ops-demo.js
//
// Coverage fixture proving every cmp() operator emits VALID, CORRECT
// syntax on every real compiled/interpreted target -- not just
// evaluate(). Written after a real, shipped bug: qb64.js/fortran.js/
// lua.js all passed cmp()'s op straight through as a raw JS/C token in
// their emitSelect, and every one of ">" "<" ">=" "<=" happens to be
// spelled identically across all 18 targets -- so the bug (QB64 has
// neither "==" nor "!="; Fortran has no "!="; Lua has no "!=") went
// completely uncaught. The reason: no sample ANYWHERE in this project,
// including the ones already wired into this file's own real-compiler
// runs, ever used "=="/"!=" in a cmp() node before this file existed --
// see test/comparison-operators.test.js's own header comment for the
// full story (that file covers the same ground at the string/static
// level; this one is what actually compiles and runs "=="/"!=" through
// every available real toolchain, closing the actual gap that let the
// bug ship, not just the symptom).
const { v, num, cmp, select, outputs } = require("../ast.js");

const a = v("a");
const b = v("b");

function flag(op) {
    return select(cmp(a, op, b), num(1), num(0));
}

const comparisonOpsAst = {
    name: "comparisonOps",
    params: ["a", "b"],
    body: outputs({
        gt: flag(">"),
        lt: flag("<"),
        ge: flag(">="),
        le: flag("<="),
        eq: flag("=="),
        ne: flag("!="),
    }),
};

module.exports = { comparisonOpsAst };
