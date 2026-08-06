// exprforge/samples/spline-frame.js
// Gram-Schmidt frame construction and related ops for Catmull-Rom spline
// paths — the motivating use case for the let/cmp/select AST additions
// (see docs/planned-additions.md). Mirrors math from a private game
// project's spline_path.bi / spline.ts; exported here as scalar functions,
// one output component per function.
//
// IMPORTANT for QB64: function names must be unique across the entire QB64
// compilation unit. The SpEf prefix (SplineExprforge) exists to avoid
// collisions with hand-written code elsewhere in that project.
const { num, v, call, add, mul, sub, div, neg, letIn, select, cmp } = require("../ast.js");
const { forComponents } = require("../util.js");

// ── Helpers ──────────────────────────────────────────────────────────────
const PI = num(3.141592653589793);
const degToRad = (degVar) => mul(degVar, div(PI, num(180)));
const dot3 = (ax, ay, az, bx, by, bz) => add(mul(ax, bx), mul(ay, by), mul(az, bz));
const len3 = (x, y, z) => call("sqrt", dot3(x, y, z, x, y, z));

// Epsilon guard: normalize when len is big enough to trust, else fallback.
//
// select() always evaluates both branches (see ast.js), so this does NOT
// divide by lenVar directly — that would be undefined right when the guard
// is supposed to matter. Instead the denominator is clamped to a safe,
// always-nonzero value by its own select first, so the div() itself never
// sees anything near zero on any target, no matter which logical branch
// "wins".
const EPS = num(0.000001);
function safeDiv(component, lenVar, fallback) {
    const isSafe = cmp(v(lenVar), ">", EPS);
    const safeLen = select(isSafe, v(lenVar), num(1));
    return select(isSafe, div(component, safeLen), fallback);
}

// ── SpMakeFrame ──────────────────────────────────────────────────────────
// Gram-Schmidt frame from normalized tangent (tx, ty, tz).
// worldUp = (0,0,1) when |ty|>0.98, else (0,1,0). worldUp.x is always 0.
// R = normalize(T × worldUp)   U = R × T
//
// Six output components → six scalar functions sharing the same params.
// Common let chain (identical in all six — each function re-derives it;
// see docs/planned-additions.md for why per-function duplication is
// accepted for now rather than a shared-binding "suite" feature):
//   wy = select(|ty|>0.98, 0, 1)
//   wz = select(|ty|>0.98, 1, 0)
//   rx = ty*wz - tz*wy
//   ry = -tx*wz        (worldUp.x=0 collapses two terms)
//   rz = tx*wy
//   rLen = sqrt(rx²+ry²+rz²)
//   rxN = safeDiv(rx, rLen, 0)  — fallback 0
//   ryN = safeDiv(ry, rLen, 0)
//   rzN = safeDiv(rz, rLen, 1)  — fallback z=1 keeps a valid frame

const MF_PARAMS = ["tx", "ty", "tz"];
const nearVert = cmp(call("abs", v("ty")), ">", num(0.98));

function mfLetChain(body) {
    return letIn("wy", select(nearVert, num(0), num(1)),
           letIn("wz", select(nearVert, num(1), num(0)),
           letIn("rx", sub(mul(v("ty"), v("wz")), mul(v("tz"), v("wy"))),
           letIn("ry", neg(mul(v("tx"), v("wz"))),
           letIn("rz", mul(v("tx"), v("wy")),
           letIn("rLen", len3(v("rx"), v("ry"), v("rz")),
           letIn("rxN", safeDiv(v("rx"), "rLen", num(0)),
           letIn("ryN", safeDiv(v("ry"), "rLen", num(0)),
           letIn("rzN", safeDiv(v("rz"), "rLen", num(1)),
               body
           )))))))));
}

// R components (normalized) — same let chain, same params, only the
// returned component differs, so forComponents() replaces three
// hand-written near-duplicates with one template.
const [SpEfMkFrRX, SpEfMkFrRY, SpEfMkFrRZ] = forComponents(["X", "Y", "Z"], (axis) => ({
    name: `SpEfMkFrR${axis}`,
    params: MF_PARAMS,
    body: mfLetChain(v(`r${axis.toLowerCase()}N`)),
}));

// U = R × T  (using normalized R) — the three component expressions are a
// cyclic permutation, not a single formula, so they're tabulated by axis
// rather than derived generically; forComponents() still collapses the
// three function definitions built from them into one template.
const uBody = {
    X: sub(mul(v("ryN"), v("tz")), mul(v("rzN"), v("ty"))),
    Y: sub(mul(v("rzN"), v("tx")), mul(v("rxN"), v("tz"))),
    Z: sub(mul(v("rxN"), v("ty")), mul(v("ryN"), v("tx"))),
};
const [SpEfMkFrUX, SpEfMkFrUY, SpEfMkFrUZ] = forComponents(["X", "Y", "Z"], (axis) => ({
    name: `SpEfMkFrU${axis}`,
    params: MF_PARAMS,
    body: mfLetChain(uBody[axis]),
}));

// ── SpActualPos ──────────────────────────────────────────────────────────
// actual = wire + standoff*(cos(pathRoll)*U + sin(pathRoll)*R)
// Params: wx, wy_wire, wz_wire, tx, ty, tz, prDeg, so
// (wy_wire to avoid colliding with the 'wy' let-binding name inside the chain)
const AP_PARAMS = ["wx", "wy_wire", "wz_wire", "tx", "ty", "tz", "prDeg", "so"];

function apLetChain(body) {
    return letIn("wy", select(nearVert, num(0), num(1)),
           letIn("wz", select(nearVert, num(1), num(0)),
           letIn("rx", sub(mul(v("ty"), v("wz")), mul(v("tz"), v("wy"))),
           letIn("ry", neg(mul(v("tx"), v("wz"))),
           letIn("rz", mul(v("tx"), v("wy")),
           letIn("rLen", len3(v("rx"), v("ry"), v("rz")),
           letIn("rxN", safeDiv(v("rx"), "rLen", num(0)),
           letIn("ryN", safeDiv(v("ry"), "rLen", num(0)),
           letIn("rzN", safeDiv(v("rz"), "rLen", num(1)),
           letIn("ux", sub(mul(v("ryN"), v("tz")), mul(v("rzN"), v("ty"))),
           letIn("uy", sub(mul(v("rzN"), v("tx")), mul(v("rxN"), v("tz"))),
           letIn("uz", sub(mul(v("rxN"), v("ty")), mul(v("ryN"), v("tx"))),
           letIn("rad", degToRad(v("prDeg")),
           letIn("c", call("cos", v("rad")),
           letIn("s", call("sin", v("rad")),
               body
           )))))))))))))));
}

const SpEfActPosX = {
    name: "SpEfActPosX", params: AP_PARAMS,
    body: apLetChain(add(v("wx"), mul(v("so"), add(mul(v("c"), v("ux")), mul(v("s"), v("rxN")))))),
};
const SpEfActPosY = {
    name: "SpEfActPosY", params: AP_PARAMS,
    body: apLetChain(add(v("wy_wire"), mul(v("so"), add(mul(v("c"), v("uy")), mul(v("s"), v("ryN")))))),
};
const SpEfActPosZ = {
    name: "SpEfActPosZ", params: AP_PARAMS,
    body: apLetChain(add(v("wz_wire"), mul(v("so"), add(mul(v("c"), v("uz")), mul(v("s"), v("rzN")))))),
};

// ── SpRollFrame ──────────────────────────────────────────────────────────
// rolledU = cos(rad)*U - sin(rad)*R
// rolledR = sin(rad)*U + cos(rad)*R
// Params: ux, uy, uz, rx, ry, rz, crDeg
const RF_PARAMS = ["ux", "uy", "uz", "rx", "ry", "rz", "crDeg"];

function rfLetChain(body) {
    return letIn("rad", degToRad(v("crDeg")),
           letIn("c", call("cos", v("rad")),
           letIn("s", call("sin", v("rad")),
               body)));
}

const SpEfRFRUX = { name: "SpEfRFRUX", params: RF_PARAMS,
    body: rfLetChain(sub(mul(v("c"), v("ux")), mul(v("s"), v("rx")))) };
const SpEfRFRUY = { name: "SpEfRFRUY", params: RF_PARAMS,
    body: rfLetChain(sub(mul(v("c"), v("uy")), mul(v("s"), v("ry")))) };
const SpEfRFRUZ = { name: "SpEfRFRUZ", params: RF_PARAMS,
    body: rfLetChain(sub(mul(v("c"), v("uz")), mul(v("s"), v("rz")))) };
const SpEfRFRRX = { name: "SpEfRFRRX", params: RF_PARAMS,
    body: rfLetChain(add(mul(v("s"), v("ux")), mul(v("c"), v("rx")))) };
const SpEfRFRRY = { name: "SpEfRFRRY", params: RF_PARAMS,
    body: rfLetChain(add(mul(v("s"), v("uy")), mul(v("c"), v("ry")))) };
const SpEfRFRRZ = { name: "SpEfRFRRZ", params: RF_PARAMS,
    body: rfLetChain(add(mul(v("s"), v("uz")), mul(v("c"), v("rz")))) };

// ── CR basis weights ────────────────────────────────────────────────────
// Already expressible without let/select, but kept here so all spline
// math lives in one sample.
// Params: t
const CRW_PARAMS = ["t"];
function crLetChain(body) {
    return letIn("t2", mul(v("t"), v("t")),
           letIn("t3", mul(v("t2"), v("t")),
               body));
}
const SpEfCrW0 = { name: "SpEfCrW0", params: CRW_PARAMS,
    body: crLetChain(mul(num(0.5), add(neg(v("t3")), mul(num(2), v("t2")), neg(v("t"))))) };
const SpEfCrW1 = { name: "SpEfCrW1", params: CRW_PARAMS,
    body: crLetChain(mul(num(0.5), add(mul(num(3), v("t3")), mul(num(-5), v("t2")), num(2)))) };
const SpEfCrW2 = { name: "SpEfCrW2", params: CRW_PARAMS,
    body: crLetChain(mul(num(0.5), add(mul(num(-3), v("t3")), mul(num(4), v("t2")), v("t")))) };
const SpEfCrW3 = { name: "SpEfCrW3", params: CRW_PARAMS,
    body: crLetChain(mul(num(0.5), add(v("t3"), neg(v("t2"))))) };

// ── Exports ──────────────────────────────────────────────────────────────
const splineFrameAsts = [
    SpEfMkFrRX, SpEfMkFrRY, SpEfMkFrRZ,
    SpEfMkFrUX, SpEfMkFrUY, SpEfMkFrUZ,
    SpEfActPosX, SpEfActPosY, SpEfActPosZ,
    SpEfRFRUX, SpEfRFRUY, SpEfRFRUZ,
    SpEfRFRRX, SpEfRFRRY, SpEfRFRRZ,
    SpEfCrW0, SpEfCrW1, SpEfCrW2, SpEfCrW3,
];

module.exports = { splineFrameAsts };
