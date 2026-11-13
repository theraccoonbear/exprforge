// exprforge/samples -- the built-in example and conformance-fixture
// formulas, keyed by name. See each file in samples/ for its own header
// comment. Not loaded by the main entry point or any other subpath.
// macro-demo.js and array-macro-demo.js (and math-demo.js, through
// exprforge/math) register macros in the default registry at import.
const { catmullRomAst } = require("./catmull-rom.js");
const { fibonacciAst } = require("./fibonacci.js");
const { splineFrameAsts } = require("./spline-frame.js");
const { kitchenSinkAst } = require("./kitchen-sink.js");
const { mathDemoAst } = require("./math-demo.js");
const { macroDemoAst } = require("./macro-demo.js");
const { cyclicElemAst, clampedElemAst } = require("./array-index-demo.js");
const { comparisonOpsAst } = require("./comparison-ops-demo.js");
const { nestedSelectAst } = require("./nested-select-demo.js");
const { numberExtremesAst } = require("./number-extremes-demo.js");
const { roundTieBoundaryAst } = require("./round-tie-demo.js");
const { domainSafetyAst } = require("./domain-safety-demo.js");
const { arraySuiteAst } = require("./array-suite-demo.js");
const { arrayMacroDemoAst } = require("./array-macro-demo.js");
const { mathEdgeCasesAst } = require("./math-edge-cases-demo.js");
const { divisionByZeroAst } = require("./division-by-zero-demo.js");
const { nonFiniteRoundingAst, roundingZeroSignAst } = require("./non-finite-rounding-demo.js");
const { differentiateDemoAst } = require("./differentiate-demo.js");
const { zeroParamDemoAst } = require("./zero-param-demo.js");

module.exports = {
    catmullRom: catmullRomAst,
    fibonacci: fibonacciAst,
    splineFrame: splineFrameAsts,
    kitchenSink: kitchenSinkAst,
    mathDemo: mathDemoAst,
    macroDemo: macroDemoAst,
    cyclicElem: cyclicElemAst,
    clampedElem: clampedElemAst,
    comparisonOps: comparisonOpsAst,
    nestedSelect: nestedSelectAst,
    numberExtremes: numberExtremesAst,
    roundTieBoundary: roundTieBoundaryAst,
    domainSafety: domainSafetyAst,
    arraySuite: arraySuiteAst,
    arrayMacroDemo: arrayMacroDemoAst,
    mathEdgeCases: mathEdgeCasesAst,
    divisionByZero: divisionByZeroAst,
    nonFiniteRounding: nonFiniteRoundingAst,
    roundingZeroSign: roundingZeroSignAst,
    differentiateDemo: differentiateDemoAst,
    zeroParamDemo: zeroParamDemoAst,
};
