// exprforge/samples/array-index-demo.js
// Worked example for array-typed parameters + the index/wrapIndex/
// clampIndex primitives (see docs/array-index-primitives.md) -- the same
// motivating shape as that doc's own `ghostIndices` example (a consumer
// project picking Catmull-Rom control points out of an array, wrapping
// at a closed path's seam / clamping at an open path's ends), reduced to
// the smallest function that actually reads through an array-typed
// parameter via `idx()` rather than just returning indices for the
// caller to look up itself.
//
// Written with fn`...` text syntax (via a direct fn([source]) call, same
// convention samples/macro-demo.js already uses for loadMacro's AST-fn-def
// tier) rather than raw AST builders -- this is the one sample whose
// entire point is the new `arr[i]` / `name: number[]` surface syntax, so
// showing the syntax IS the example, not an implementation detail to hide
// behind builder calls.
const { fn } = require("../fn.js");

// cyclicElem(arr, m, i) reads arr[wrapIndex(i, m)] -- the element m
// positions "around" from i, wrapping at the array's bounds instead of
// going out of range. m is passed separately rather than read from
// arr.length (no such property exists on an AST-level array param --
// see docs/array-index-primitives.md's "Emitter implications" section
// on why array length is always caller-supplied, never introspected).
const cyclicElemAst = fn([`
cyclicElem(arr: number[], m, i):
  return arr[wrapIndex(i, m)];
`]);

// clampedElem(arr, n, i) is the open-path counterpart: reads arr[i],
// clamped into [0, n-1] instead of wrapped -- the same "pick a point
// near a computed offset without running off the end of the array"
// shape, for a path that doesn't close on itself.
const clampedElemAst = fn([`
clampedElem(arr: number[], n, i):
  return arr[clampIndex(i, 0, n - 1)];
`]);

module.exports = { cyclicElemAst, clampedElemAst };
