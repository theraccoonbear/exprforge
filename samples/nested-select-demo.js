// exprforge/samples/nested-select-demo.js
//
// select() nested inside another select()'s then/else branch (a chained
// ternary, e.g. "a>0 ? 1 : b>0 ? 2 : 3") -- not exercised by any OTHER
// sample wired into real compiled/interpreted conformance before this
// file existed: every select() usage in this project's other
// real-compiled samples (spline-frame.js) is a single, unnested level.
// Written as part of the same audit that found the ==/!= operator-
// translation bug (see samples/comparison-ops-demo.js): a different,
// plausible risk in the exact same code path (each emitter's own
// emitSelect override), not ruled out empirically until this file
// existed -- e.g. QB64's arithmetic-emulation trick and Go's
// immediately-invoked-function trick both have to correctly recurse
// into a `then`/`else` that's itself another select(), not just a
// leaf value.
const { v, num, cmp, select } = require("../ast.js");

const a = v("a");
const b = v("b");

// a>0 ? 1 : (b>0 ? 2 : (b<0 ? 3 : 4)) -- three levels deep, every branch
// reachable by a real input row (see test/conformance.test.js's own
// inputs for this sample).
const nestedSelectAst = {
    name: "nestedSelect",
    params: ["a", "b"],
    body: select(
        cmp(a, ">", num(0)),
        num(1),
        select(
            cmp(b, ">", num(0)),
            num(2),
            select(cmp(b, "<", num(0)), num(3), num(4)),
        ),
    ),
};

module.exports = { nestedSelectAst };
