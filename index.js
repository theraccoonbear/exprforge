// exprforge/index.js
const { num, v, bin, call, add, mul, sub, div, neg, letIn, cmp, select, collectLets } = require("./ast.js");
const { forComponents } = require("./util.js");
const emitters = require("./emitters/registry.js");
const { catmullRomAst } = require("./samples/catmull-rom.js");
const { fibonacciAst } = require("./samples/fibonacci.js");
const { splineFrameAsts } = require("./samples/spline-frame.js");
const { kitchenSinkAst } = require("./samples/kitchen-sink.js");

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
    num, v, bin, call, add, mul, sub, div, neg, letIn, cmp, select, collectLets,
    // Authoring convenience — not an AST primitive, see util.js.
    forComponents,
    // Built-in example formulas — see samples/ for the source.
    catmullRomAst,
    fibonacciAst,
    splineFrameAsts,
    // Not a worked example -- a conformance-test fixture that calls every
    // supported Math function once. See samples/kitchen-sink.js.
    kitchenSinkAst,
    samples: {
        catmullRom: catmullRomAst,
        fibonacci: fibonacciAst,
        splineFrame: splineFrameAsts,
        kitchenSink: kitchenSinkAst,
    },
    // Per-language emitter instances, keyed by name (js, qb64, c, java, go, rust).
    emitters,
    // Convenience: run every emitter at once.
    emitAll,
};
