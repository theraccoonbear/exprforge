// exprforge/index.js
const { num, v, bin, call, add, mul, sub, div, letIn, cmp, select, collectLets } = require("./ast.js");
const emitters = require("./emitters/registry.js");
const { catmullRomAst } = require("./samples/catmull-rom.js");
const { fibonacciAst } = require("./samples/fibonacci.js");
const { splineFrameAsts } = require("./samples/spline-frame.js");

/**
 * Run every registered emitter against one AST function definition.
 * Returns { [lang]: { ext, source } }.
 */
function emitAll(fn) {
    const result = {};
    for (const [lang, emitter] of Object.entries(emitters)) {
        result[lang] = { ext: emitter.ext, source: emitter.emitFunction(fn) };
    }
    return result;
}

module.exports = {
    // AST builders — use these to define your own formulas.
    num, v, bin, call, add, mul, sub, div, letIn, cmp, select, collectLets,
    // Built-in example formulas — see samples/ for the source.
    catmullRomAst,
    fibonacciAst,
    splineFrameAsts,
    samples: { catmullRom: catmullRomAst, fibonacci: fibonacciAst, splineFrame: splineFrameAsts },
    // Per-language emitter instances, keyed by name (js, qb64, c, java, go, rust).
    emitters,
    // Convenience: run every emitter at once.
    emitAll,
};
