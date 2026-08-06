// exprforge/build.js
const fs = require("fs");
const path = require("path");
const emitters = require("./emitters/registry.js");
const { catmullRomAst } = require("./samples/catmull-rom.js");
const { fibonacciAst } = require("./samples/fibonacci.js");
const { splineFrameAsts } = require("./samples/spline-frame.js");
const { kitchenSinkAst } = require("./samples/kitchen-sink.js");

const samples = { "catmull-rom": catmullRomAst, fibonacci: fibonacciAst, "kitchen-sink": kitchenSinkAst };

const outDir = path.join(__dirname, "out");
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
}

for (const [sampleName, ast] of Object.entries(samples)) {
    for (const [lang, emitter] of Object.entries(emitters)) {
        const source = emitter.emitFunction(ast);
        const outPath = path.join(outDir, `${sampleName}.generated.${emitter.ext}`);
        fs.writeFileSync(outPath, source);
        console.log(`[${lang}] wrote ${path.relative(__dirname, outPath)}`);
    }
}

// spline-frame.js exports many functions (one per output component) rather
// than one AST, so it gets its own loop: one file per (function, language).
for (const ast of splineFrameAsts) {
    for (const [lang, emitter] of Object.entries(emitters)) {
        const source = emitter.emitFunction(ast);
        const outPath = path.join(outDir, `spline-frame.${ast.name}.generated.${emitter.ext}`);
        fs.writeFileSync(outPath, source);
        console.log(`[${lang}] wrote ${path.relative(__dirname, outPath)}`);
    }
}
