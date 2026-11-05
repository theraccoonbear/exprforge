// exprforge/samples/boundary-conditions-demo.js
//
// Probes for numeric boundary behavior (issue #45): each AST exposes one
// primitive (or a small group) directly to huge, non-finite, signed-zero,
// subnormal and degenerate operands, so test/conformance.test.js can
// compare every real toolchain against the reference interpreter
// (JS semantics) on exactly those inputs. NaN, Infinity and -0 are passed
// as ordinary command-line arguments, which also exercises each target
// harness's own text-to-double parsing. See README "Numeric guarantees"
// and docs/adr/0005-boundary-conditions.md for the outcome per behavior.
const { v, num, call, add, mul, neg, outputs } = require("../ast.js");

const x = v("x");
const y = v("y");

const roundingBoundaryAst = {
    name: "roundingBoundary",
    params: ["x"],
    body: outputs({
        floorX: call("floor", x),
        ceilX: call("ceil", x),
        truncX: call("trunc", x),
        roundX: call("round", x),
    }),
};

// Double negation instead of `* 1`: it keeps the sign call inside an
// arithmetic expression for GnuCOBOL (see passThroughAst) and preserves -0,
// whereas Perl's `-0.0 * 1` takes an integer fast path and returns +0.
const signBoundaryAst = {
    name: "signBoundary",
    params: ["x"],
    body: neg(neg(call("sign", x))),
};

const hypotBoundaryAst = {
    name: "hypotBoundary",
    params: ["x", "y"],
    body: call("hypot", x, y),
};

const powBoundaryAst = {
    name: "powBoundary",
    params: ["x", "y"],
    body: call("pow", x, y),
};

const atan2BoundaryAst = {
    name: "atan2Boundary",
    params: ["y", "x"],
    body: call("atan2", y, x),
};

// Multiplying by 1 keeps every value (NaN, Infinity, -0) bit-identical while
// giving GnuCOBOL 3.1's cobc an arithmetic COMPUTE; a bare assignment or a
// bare intrinsic as the whole body fails there with a missing cob_decimal
// type in cobc's generated C (same cobc codegen class as the comparisonOps
// skip in test/conformance.test.js).
const passThroughAst = {
    name: "passThrough",
    params: ["x"],
    body: mul(x, num(1)),
};

const passThroughBareAst = {
    name: "passThroughBare",
    params: ["x"],
    body: x,
};

const negateAst = {
    name: "negateBoundary",
    params: ["x"],
    body: neg(x),
};

const overflowBoundaryAst = {
    name: "overflowBoundary",
    params: ["x"],
    body: outputs({
        squared: mul(x, x),
        doubled: add(x, x),
        expX: call("exp", x),
        shrunk: mul(mul(x, num(1e-300)), num(1e-300)),
        halved: mul(x, num(0.5)),
    }),
};

const wrapIndexBoundaryAst = {
    name: "wrapIndexBoundary",
    params: ["x", "y"],
    body: call("wrapIndex", x, y),
};

module.exports = {
    roundingBoundaryAst,
    signBoundaryAst,
    hypotBoundaryAst,
    powBoundaryAst,
    atan2BoundaryAst,
    passThroughAst,
    passThroughBareAst,
    negateAst,
    overflowBoundaryAst,
    wrapIndexBoundaryAst,
};
