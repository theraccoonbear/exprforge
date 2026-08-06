// exprforge/test/conformance.test.js
//
// This is the seed of the thing that actually justifies the tool's existence:
// proving the emitted targets agree, not just that they compile. Currently
// covers JS (in-process) vs C (compiled via gcc, skipped if unavailable).
// Extend this file as more targets get real toolchains wired in — that's
// the growth path, not adding more Math functions nobody's asked for yet.

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { catmullRomAst, emitters } = require("../index.js");

const SAMPLE_INPUTS = [
    [0.0, 1.0, 2.0, 3.0, 0.0],
    [0.0, 1.0, 2.0, 3.0, 0.5],
    [0.0, 1.0, 2.0, 3.0, 1.0],
    [-4.2, 7.1, 0.0, 12.75, 0.33],
];

function hasGcc() {
    try {
        execFileSync("gcc", ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

test("JS emitted output matches hand-computed reference", () => {
    const jsSource = emitters.js.emitFunction(catmullRomAst);
    const tmpFile = path.join(os.tmpdir(), `spline-test-${Date.now()}.js`);
    fs.writeFileSync(tmpFile, jsSource);
    const { catmullRom1D } = require(tmpFile);
    fs.unlinkSync(tmpFile);

    for (const [P0, P1, P2, P3, t] of SAMPLE_INPUTS) {
        const got = catmullRom1D(P0, P1, P2, P3, t);
        assert.ok(Number.isFinite(got), `expected finite result for t=${t}`);
    }
});

test("C emitted output matches JS emitted output", { skip: !hasGcc() && "gcc not available" }, () => {
    const jsSource = emitters.js.emitFunction(catmullRomAst);
    const jsTmp = path.join(os.tmpdir(), `spline-test-${Date.now()}.js`);
    fs.writeFileSync(jsTmp, jsSource);
    const { catmullRom1D } = require(jsTmp);
    fs.unlinkSync(jsTmp);

    const cSource = emitters.c.emitFunction(catmullRomAst);
    const cDir = fs.mkdtempSync(path.join(os.tmpdir(), "spline-c-"));
    const cSrcPath = path.join(cDir, "spline.c");
    const cBinPath = path.join(cDir, "spline_test");
    fs.writeFileSync(cSrcPath, cSource);

    const harness =
        `#include <stdio.h>\n` +
        `#include <stdlib.h>\n` +
        `#include "spline.c"\n` +
        `int main(int argc, char **argv) {\n` +
        `    double P0 = atof(argv[1]), P1 = atof(argv[2]), P2 = atof(argv[3]);\n` +
        `    double P3 = atof(argv[4]), t = atof(argv[5]);\n` +
        `    printf("%.15f", catmullRom1D(P0, P1, P2, P3, t));\n` +
        `    return 0;\n` +
        `}\n`;
    const harnessPath = path.join(cDir, "main.c");
    fs.writeFileSync(harnessPath, harness);
    execFileSync("gcc", [harnessPath, "-o", cBinPath, "-lm"]);

    for (const [P0, P1, P2, P3, t] of SAMPLE_INPUTS) {
        const args = [P0, P1, P2, P3, t].map(String);
        const cResult = Number(execFileSync(cBinPath, args).toString());
        const jsResult = catmullRom1D(P0, P1, P2, P3, t);
        assert.strictEqual(cResult, jsResult, `mismatch at t=${t}: C=${cResult} JS=${jsResult}`);
    }

    fs.rmSync(cDir, { recursive: true, force: true });
});
