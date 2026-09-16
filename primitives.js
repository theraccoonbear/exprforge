// exprforge/primitives.js
//
// The fixed, non-extensible set of built-in Math primitives (see ast.js's
// call() node, evaluate.js's CALLS table, and every emitters/<lang>.js's
// own `calls` table -- all three already have to agree on this same set
// of names, per evaluate.js's own header comment) plus each one's exact,
// required argument count.
//
// A standalone module with no dependencies of its own, specifically so
// evaluate.js, emitters/base.js, and macros.js can all require it without
// risking a cycle (macros.js already can't require evaluate.js back,
// since evaluate.js requires macros.js -- see macros.js's own comment on
// this). Update this table too if a new built-in primitive is ever
// added -- same "two lists have to stay in sync" precedent evaluate.js's
// own header comment already documents for CALLS vs. every emitter's
// `calls` table; this is a third.
const PRIMITIVE_ARITY = {
    sqrt: 1, abs: 1, sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1,
    log: 1, log2: 1, log10: 1, exp: 1, floor: 1, ceil: 1, round: 1,
    trunc: 1, sign: 1,
    pow: 2, atan2: 2, min: 2, max: 2, hypot: 2,
    // wrapIndex/clampIndex: pure scalar-in/scalar-out (see
    // docs/array-index-primitives.md) -- mechanically identical to every
    // other 2/3-arg primitive above, nothing array-specific about the
    // primitives themselves. wrapIndex(i, m) is cyclic index wrapping
    // (closed paths); clampIndex(i, lo, hi) is boundary clamping (open
    // paths). wrapIndex needs `%` specifically, not floor/mul/sub
    // decomposition -- see the design doc for why modulo's differing
    // sign convention across targets (Python follows the divisor;
    // C/JS/QB64 follow the dividend) makes this worth a primitive rather
    // than expecting each emitter to compose one from bin() nodes.
    wrapIndex: 2, clampIndex: 3,
};

module.exports = { PRIMITIVE_ARITY };
