// exprforge/build.js
const fs = require("fs");
const path = require("path");
const { catmullRomAst } = require("./ast.js");
const emitters = require("./emitters/registry.js");

const outDir = path.join(__dirname, "out");
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
}

for (const [lang, emitter] of Object.entries(emitters)) {
    const source = emitter.emitFunction(catmullRomAst);
    const outPath = path.join(outDir, `spline.generated.${emitter.ext}`);
    fs.writeFileSync(outPath, source);
    console.log(`[${lang}] wrote ${path.relative(__dirname, outPath)}`);
}
