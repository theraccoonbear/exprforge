// exprforge/samples/array-suite-demo.js
//
// Not a worked example -- a conformance-test fixture proving the
// combination of two features that were each independently proven this
// session, but never TOGETHER: an array-typed parameter (#33/#34) used
// inside a multi-output outputs() suite (#36 extended every
// runX/runSuiteX harness for array arguments, but only ever registered
// a SCALAR array-param sample -- cyclicElem/clampedElem, both plain
// `return`, never `outputs()`). Written and locally spot-checked once
// during #36's own development (a single hand-run C compile, never a
// permanent test) -- this is that check turned into real, permanent,
// every-target coverage instead of a one-off.
const { v, num, add, sub, call, idx, outputs } = require("../ast.js");

const arr = v("arr");
const m = v("m");
const i = v("i");

const arraySuiteAst = {
    name: "arraySuite",
    params: ["arr", "m", "i"],
    paramTypes: { arr: "number[]" },
    body: outputs({
        cur: idx(arr, call("wrapIndex", i, m)),
        nextElem: idx(arr, call("wrapIndex", add(i, num(1)), m)),
        prevElem: idx(arr, call("wrapIndex", sub(i, num(1)), m)),
    }),
};

module.exports = { arraySuiteAst };
