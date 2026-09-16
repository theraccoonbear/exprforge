// exprforge/samples/kitchen-sink.js
// Not a worked example like the other samples/ — a synthetic function with
// no real-world meaning, built to call every supported Math function
// (see README's "Supported Math functions") at least once in a single
// expression. Exists purely as a conformance-test fixture: the other
// samples only exercise 5 of the 22 functions between them, so most of
// the `calls` tables in emitters/*.js — several with hand-rolled,
// easy-to-get-wrong expansions (QB64's asin/acos as ATN+SQR identities,
// C's ternary-based sign, Java's log2/round/trunc, Go's Copysign-based
// sign) — had never actually been run through a compiler.
//
// x is kept in (0, 1) by every caller (see test/conformance.test.js's
// inputs for this sample) so sqrt/log/log2/log10/asin/acos all stay in
// their valid domain simultaneously. d = x - y is free to land anywhere
// -- positive, negative, or exactly zero -- and carries the functions
// that care about sign: floor/ceil/round/trunc/sign. (round() ties AWAY
// FROM ZERO identically on every target now -- see samples/
// round-tie-demo.js and the root README's "round() at exact .5
// boundaries" section for the real, since-fixed three-way divergence
// this used to have, and why this file's own inputs still don't bother
// landing exactly on a .5 boundary for d: this file's whole point is
// exercising the OTHER 21 primitives across every target for the first
// time, not re-proving round()'s tie-breaking, which round-tie-demo.js
// already covers on its own, more precisely.)
const { v, call, add, sub } = require("../ast.js");

const x = v("x");
const y = v("y");
const d = sub(x, y);

const kitchenSinkAst = {
    name: "kitchenSink",
    params: ["x", "y"],
    body: add(
        call("sqrt", x),
        call("abs", d),
        call("pow", x, y),
        call("sin", x),
        call("cos", x),
        call("tan", x),
        call("asin", x),
        call("acos", x),
        call("atan", x),
        call("atan2", y, x),
        call("log", x),
        call("log2", x),
        call("log10", x),
        call("exp", x),
        call("floor", d),
        call("ceil", d),
        call("round", d),
        call("trunc", d),
        call("sign", d),
        call("min", x, y),
        call("max", x, y),
        call("hypot", x, y),
    ),
};

module.exports = { kitchenSinkAst };
