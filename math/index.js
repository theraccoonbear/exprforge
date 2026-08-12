// exprforge/math/index.js
// Standard math utilities — see docs/v0.2.0-math-utilities.md for the
// design doc this implements. This module is level 1: pure compositions of
// the level-0 AST primitives (ast.js), built to save every consumer from
// re-deriving the same safe-math/vector patterns samples/spline-frame.js
// used to hand-roll locally (dot3/len3/safeDiv/EPS there predate this file
// and motivated it). No new emitter logic — emitAll handles these
// transparently, same as any other AST the caller builds by hand.
//
// require("exprforge/math") is a separate export path from require("exprforge")
// itself (see package.json's "exports" map) — additive, not merged into the
// core barrel.
const { num, v, call, add, mul, sub, div, letIn, cmp, select } = require("../ast.js");
const { loadMacro } = require("../macros.js");

// Shared epsilon for all near-zero guards below. Exposed so callers can
// reuse it in their own cmp() calls for consistency with safeDiv/normalize3,
// same convention as samples/spline-frame.js's local EPS.
const EPS = num(0.000001);

// Guard against division by zero: numerator/denominatorExpr when
// |denominatorExpr| > EPS, else fallback. Per select()'s doc comment in
// ast.js, both branches of a select are always evaluated on every target —
// so this does NOT guard the division directly (div(numerator,
// denominatorExpr) would still be reached with a near-zero denominator on
// any target that can't short-circuit, e.g. QB64). Instead the denominator
// is clamped to a safe, always-nonzero value by its own select first,
// mirroring the local safeDiv in samples/spline-frame.js.
//
// denominatorExpr is referenced twice in the resulting tree (once for the
// |.| > EPS check, once in the clamped-denominator select) — cheap if it's
// a var reference or a simple expression, but if it's an expensive
// subexpression (e.g. a len3() call), pass an already-letIn-bound v(name)
// instead of the raw expression to avoid computing it twice per emitted
// target. normalize3() below does exactly that internally.
function safeDiv(numerator, denominatorExpr, fallback) {
    const isSafe = cmp(call("abs", denominatorExpr), ">", EPS);
    const safeDenom = select(isSafe, denominatorExpr, num(1));
    return select(isSafe, div(numerator, safeDenom), fallback);
}

// 3-D dot product: ax*bx + ay*by + az*bz.
function dot3(ax, ay, az, bx, by, bz) {
    return add(mul(ax, bx), mul(ay, by), mul(az, bz));
}

// 3-D Euclidean length: sqrt(x² + y² + z²). Emits a sqrt intrinsic (see
// README's "Supported Math functions").
function len3(x, y, z) {
    return call("sqrt", dot3(x, y, z, x, y, z));
}

// 3-D cross product. Returns a plain JS object { x, y, z } of AST nodes,
// NOT an AST node itself — a deliberate ergonomic choice so callers can
// destructure and name each component in their own letIn chain, rather
// than exprforge picking the names for them.
function cross3(ax, ay, az, bx, by, bz) {
    return {
        x: sub(mul(ay, bz), mul(az, by)),
        y: sub(mul(az, bx), mul(ax, bz)),
        z: sub(mul(ax, by), mul(ay, bx)),
    };
}

// Monotonic counter behind normalize3's internal let-binding names — see
// the comment inside normalize3 for why it needs one at all. Global (not
// per-call-site) is deliberately overkill: it only has to avoid colliding
// with another normalize3() binding inside the same function body, and a
// process-wide counter trivially guarantees that regardless of how many
// times normalize3 is called across however many functions.
//
// The name itself starts with a letter, not "__" -- confirmed against a
// real Fortran compiler ("Invalid character in name") that a leading
// underscore isn't a valid identifier start there, unlike JS/Python/etc.
// This is an internal implementation detail (never part of any documented
// return value or public name), so there's nothing for a leading-"__"
// convention to usefully signal here that a portable identifier can't
// signal just as well.
let normalizeGensymCounter = 0;

// Safe-normalize a 3-D vector. Returns { x, y, z } (same shape as cross3).
// Falls back to (fx, fy, fz) — default (0, 1, 0) — when the vector's length
// is at or below EPS.
//
// Per the spec's recommendation, this computes len3(x, y, z) ONCE and
// shares it across all three divisions (one EPS check, one sqrt), instead
// of calling safeDiv three times against three independent len3() calls.
// The mechanism: the length is let-bound inside the `x` field's own tree,
// and `y`/`z` just reference that bound name bare. collectLets (ast.js)
// hoists a let found anywhere in a function body to one flat, ordered list
// regardless of which sibling subtree it was found in — see
// test/ast.test.js's "collectLets hoists a let nested inside one output
// field's own value" for the exact behavior this relies on. The gensym'd
// name avoids a "duplicate let binding name" throw if normalize3 is called
// more than once inside one function (e.g. normalizing two vectors).
function normalize3(x, y, z, fx = num(0), fy = num(1), fz = num(0)) {
    const lenName = `efMathNrmLen${normalizeGensymCounter++}`;
    return {
        x: letIn(lenName, len3(x, y, z), safeDiv(x, v(lenName), fx)),
        y: safeDiv(y, v(lenName), fy),
        z: safeDiv(z, v(lenName), fz),
    };
}

// Clamps val to [lo, hi]. Expressed as nested select/cmp — no runtime
// intrinsic required, matching cmp/select's existing usage elsewhere (see
// samples/spline-frame.js). val is referenced three times in the resulting
// tree; pass a var reference (or an already-let-bound one) if it's not
// already cheap to re-evaluate.
function clamp(val, lo, hi) {
    return select(cmp(val, "<", lo), lo, select(cmp(val, ">", hi), hi, val));
}

// Also registered as macros (see macros.js/issue #21 ask 3), usable
// directly inside fn`...`/expr`...` template TEXT, not just from
// JS-authoring -- e.g. `fn`rodrigues(...): let b = cross3(ax, ay, az,
// bx, by, bz); let bLen = sqrt(b.rx^2 + b.ry^2 + b.rz^2); ...``. Every
// one of these already has exactly the signature loadMacro() wants
// ((...argNodes) => Node | {field: Node}) with no wrapping needed --
// this IS the "safe, inline-expanded, built from existing primitives"
// tier's worked example, not a separate mechanism layered on top of it.
// `clamp` is deliberately excluded: it's a 3-argument (val, lo, hi) helper
// whose own doc comment already flags `val` as re-evaluated three times
// if it's not cheap -- fine for JS-authoring callers who control that,
// but not offered as a macro name here since a fn`...` author has no
// equivalent "pass an already-let-bound reference" convention to reach
// for if they trip over the same cost.
loadMacro("dot3", dot3);
loadMacro("len3", len3);
loadMacro("cross3", cross3);
loadMacro("normalize3", normalize3);
loadMacro("safeDiv", safeDiv);

module.exports = { EPS, safeDiv, dot3, len3, cross3, normalize3, clamp };
