// exprforge/build.js
const fs = require("fs");
const path = require("path");
const emitters = require("./emitters/registry.js");
const { catmullRomAst } = require("./samples/catmull-rom.js");
const { fibonacciAst } = require("./samples/fibonacci.js");

const samples = { "catmull-rom": catmullRomAst, fibonacci: fibonacciAst };

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
