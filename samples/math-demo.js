// exprforge/samples/math-demo.js
// Not a worked example -- a conformance-test fixture for math/index.js,
// same role samples/kitchen-sink.js plays for the core Math intrinsics:
// exercises every exprforge/math helper in one suite, purely so
// test/conformance.test.js can prove the generated code agrees across
// every target. Calls normalize3() twice (once per input vector) in the
// same function specifically to prove its internal gensym'd let-binding
// doesn't collide with itself -- see the comment on normalizeGensymCounter
// in math/index.js.
const { v, num, outputs } = require("../ast.js");
const { safeDiv, dot3, len3, cross3, normalize3, clamp } = require("../math/index.js");

// "byy", not "by": BY is a reserved COBOL keyword (BY REFERENCE/BY VALUE/
// BY CONTENT) -- confirmed against a real compiler ("syntax error,
// unexpected BY") that it can't be used as a data-item name there, same
// kind of unavoidable per-language collision as "len"/"mag" below.
const MATH_DEMO_PARAMS = ["ax", "ay", "az", "bx", "byy", "bz", "t", "lo", "hi"];

const cross = cross3(v("ax"), v("ay"), v("az"), v("bx"), v("byy"), v("bz"));
const normA = normalize3(v("ax"), v("ay"), v("az"));
const normB = normalize3(v("bx"), v("byy"), v("bz"));

const MathDemo = {
    name: "MathDemo",
    params: MATH_DEMO_PARAMS,
    body: outputs({
        dot: dot3(v("ax"), v("ay"), v("az"), v("bx"), v("byy"), v("bz")),
        // "mag", not "len": LEN is a reserved QB64 builtin (string/array
        // length) -- see test/conformance.test.js's normalizeXAst comment.
        mag: len3(v("ax"), v("ay"), v("az")),
        crossX: cross.x,
        crossY: cross.y,
        crossZ: cross.z,
        normAX: normA.x,
        normAY: normA.y,
        normAZ: normA.z,
        normBX: normB.x,
        normBY: normB.y,
        normBZ: normB.z,
        clamped: clamp(v("t"), v("lo"), v("hi")),
        // ax/bx as numerator/denominator: exercises both the safe path
        // (bx away from zero) and the fallback (bx == 0, see
        // test/conformance.test.js's math-demo input rows).
        safeDivResult: safeDiv(v("ax"), v("bx"), num(-1)),
    }),
};

module.exports = { mathDemoAst: MathDemo };
