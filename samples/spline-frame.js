// exprforge/samples/spline-frame.js
// Gram-Schmidt frame construction and related ops for Catmull-Rom spline
// paths — the motivating use case for the let/cmp/select AST additions,
// and now for outputs() (see ast.js). Mirrors math from a private game
// project's spline_path.bi / spline.ts.
//
// Each group below shares one let-chain across several *related* outputs
// (e.g. SpMakeFrame's R and U vectors) and is emitted as ONE suite —
// computed once — instead of one function per output. That used to be six
// separate functions here, each independently re-deriving the same
// 9-step chain (including a sqrt) from scratch; a caller wanting the
// whole frame paid for that chain six times over for one tangent vector.
// See docs/planned-additions.md and the outputs() doc comment in ast.js.
//
// IMPORTANT for QB64: function/SUB names must be unique across the entire
// QB64 compilation unit. The SpEf prefix (SplineExprforge) exists to avoid
// collisions with hand-written code elsewhere in that project.
const { num, v, call, add, mul, sub, div, neg, letIn, select, cmp, outputs } = require("../ast.js");

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
// One shared let chain, six named outputs (rx,ry,rz,ux,uy,uz), computed
// once per call instead of once per output. The pre-normalization cross
// product is named crossX/Y/Z, deliberately NOT rx/ry/rz, even though
// that's its usual name here: it would collide with the "rx"/"ry"/"rz"
// *output* field names below in any language whose multi-return mechanism
// shares a namespace with local variables (this collided for real in Go's
// named-return-values form before that was changed to avoid relying on it —
// kept renamed anyway, both for clarity and because QB64's output-param
// SUBs are structurally the same risk and can't be verified here).
//   wy = select(|ty|>0.98, 0, 1)
//   wz = select(|ty|>0.98, 1, 0)
//   crossX = ty*wz - tz*wy
//   crossY = -tx*wz        (worldUp.x=0 collapses two terms)
//   crossZ = tx*wy
//   rLen = sqrt(crossX²+crossY²+crossZ²)
//   rxN = safeDiv(crossX, rLen, 0)  — fallback 0
//   ryN = safeDiv(crossY, rLen, 0)
//   rzN = safeDiv(crossZ, rLen, 1)  — fallback z=1 keeps a valid frame

const MF_PARAMS = ["tx", "ty", "tz"];
const nearVert = cmp(call("abs", v("ty")), ">", num(0.98));

function mfLetChain(body) {
    return letIn("wy", select(nearVert, num(0), num(1)),
           letIn("wz", select(nearVert, num(1), num(0)),
           letIn("crossX", sub(mul(v("ty"), v("wz")), mul(v("tz"), v("wy"))),
           letIn("crossY", neg(mul(v("tx"), v("wz"))),
           letIn("crossZ", mul(v("tx"), v("wy")),
           letIn("rLen", len3(v("crossX"), v("crossY"), v("crossZ")),
           letIn("rxN", safeDiv(v("crossX"), "rLen", num(0)),
           letIn("ryN", safeDiv(v("crossY"), "rLen", num(0)),
           letIn("rzN", safeDiv(v("crossZ"), "rLen", num(1)),
               body
           )))))))));
}

// U = R × T (using normalized R) — a cyclic permutation, not one formula,
// so it's tabulated by axis rather than derived generically.
const uX = sub(mul(v("ryN"), v("tz")), mul(v("rzN"), v("ty")));
const uY = sub(mul(v("rzN"), v("tx")), mul(v("rxN"), v("tz")));
const uZ = sub(mul(v("rxN"), v("ty")), mul(v("ryN"), v("tx")));

const SpEfMkFrame = {
    name: "SpEfMkFrame",
    params: MF_PARAMS,
    body: mfLetChain(outputs({
        rx: v("rxN"), ry: v("ryN"), rz: v("rzN"),
        ux: uX, uy: uY, uz: uZ,
    })),
};

// ── SpActualPos ──────────────────────────────────────────────────────────
// actual = wire + standoff*(cos(pathRoll)*U + sin(pathRoll)*R)
// Params: wx, wy_wire, wz_wire, tx, ty, tz, prDeg, so
// (wy_wire to avoid colliding with the 'wy' let-binding name inside the chain)
const AP_PARAMS = ["wx", "wy_wire", "wz_wire", "tx", "ty", "tz", "prDeg", "so"];

function apLetChain(body) {
    return letIn("wy", select(nearVert, num(0), num(1)),
           letIn("wz", select(nearVert, num(1), num(0)),
           letIn("crossX", sub(mul(v("ty"), v("wz")), mul(v("tz"), v("wy"))),
           letIn("crossY", neg(mul(v("tx"), v("wz"))),
           letIn("crossZ", mul(v("tx"), v("wy")),
           letIn("rLen", len3(v("crossX"), v("crossY"), v("crossZ")),
           letIn("rxN", safeDiv(v("crossX"), "rLen", num(0)),
           letIn("ryN", safeDiv(v("crossY"), "rLen", num(0)),
           letIn("rzN", safeDiv(v("crossZ"), "rLen", num(1)),
           letIn("ux", sub(mul(v("ryN"), v("tz")), mul(v("rzN"), v("ty"))),
           letIn("uy", sub(mul(v("rzN"), v("tx")), mul(v("rxN"), v("tz"))),
           letIn("uz", sub(mul(v("rxN"), v("ty")), mul(v("ryN"), v("tx"))),
           letIn("rad", degToRad(v("prDeg")),
           letIn("c", call("cos", v("rad")),
           letIn("s", call("sin", v("rad")),
               body
           )))))))))))))));
}

const SpEfActualPos = {
    name: "SpEfActualPos",
    params: AP_PARAMS,
    body: apLetChain(outputs({
        x: add(v("wx"), mul(v("so"), add(mul(v("c"), v("ux")), mul(v("s"), v("rxN"))))),
        y: add(v("wy_wire"), mul(v("so"), add(mul(v("c"), v("uy")), mul(v("s"), v("ryN"))))),
        z: add(v("wz_wire"), mul(v("so"), add(mul(v("c"), v("uz")), mul(v("s"), v("rzN"))))),
    })),
};

// ── SpRollFrame ──────────────────────────────────────────────────────────
// rolledU = cos(rad)*U - sin(rad)*R
// rolledR = sin(rad)*U + cos(rad)*R
// Params: ux, uy, uz, rx, ry, rz, crDeg
// Output field names are prefixed (rolledUx, not ux) since ux/uy/uz/rx/ry/rz
// are already taken by the *input* params.
const RF_PARAMS = ["ux", "uy", "uz", "rx", "ry", "rz", "crDeg"];

function rfLetChain(body) {
    return letIn("rad", degToRad(v("crDeg")),
           letIn("c", call("cos", v("rad")),
           letIn("s", call("sin", v("rad")),
               body)));
}

const SpEfRollFrame = {
    name: "SpEfRollFrame",
    params: RF_PARAMS,
    body: rfLetChain(outputs({
        rolledUx: sub(mul(v("c"), v("ux")), mul(v("s"), v("rx"))),
        rolledUy: sub(mul(v("c"), v("uy")), mul(v("s"), v("ry"))),
        rolledUz: sub(mul(v("c"), v("uz")), mul(v("s"), v("rz"))),
        rolledRx: add(mul(v("s"), v("ux")), mul(v("c"), v("rx"))),
        rolledRy: add(mul(v("s"), v("uy")), mul(v("c"), v("ry"))),
        rolledRz: add(mul(v("s"), v("uz")), mul(v("c"), v("rz"))),
    })),
};

// ── CR basis weights ────────────────────────────────────────────────────
// Already expressible without let/select, but kept here so all spline
// math lives in one sample. Shares t2/t3 across all four weights.
// Params: t
const CRW_PARAMS = ["t"];

const SpEfCrWeights = {
    name: "SpEfCrWeights",
    params: CRW_PARAMS,
    body: letIn("t2", mul(v("t"), v("t")),
          letIn("t3", mul(v("t2"), v("t")),
              outputs({
                  w0: mul(num(0.5), add(neg(v("t3")), mul(num(2), v("t2")), neg(v("t")))),
                  w1: mul(num(0.5), add(mul(num(3), v("t3")), mul(num(-5), v("t2")), num(2))),
                  w2: mul(num(0.5), add(mul(num(-3), v("t3")), mul(num(4), v("t2")), v("t"))),
                  w3: mul(num(0.5), add(v("t3"), neg(v("t2")))),
              })
          )),
};

// ── Exports ──────────────────────────────────────────────────────────────
const splineFrameAsts = [SpEfMkFrame, SpEfActualPos, SpEfRollFrame, SpEfCrWeights];

module.exports = { splineFrameAsts };
