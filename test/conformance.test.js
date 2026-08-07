// exprforge/test/conformance.test.js
//
// This is the thing that actually justifies the tool's existence: proving
// the emitted targets agree numerically, not just that they compile. Each
// compiled-language block is skipped (not failed) when its toolchain isn't
// on PATH, so this suite degrades gracefully across machines — see
// .github/workflows/test.yml for the CI image that has all of them.
//
// Two independent checks per sample:
//   1. the emitted JS vs. a hand-written reference implementation that
//      shares no code with the AST/emitters — catches a wrong formula.
//   2. every other target vs. that same emitted JS — catches an emitter
//      bug (wrong operator, wrong argument order, etc.) even if the AST
//      itself is correct.
// Comparisons use a relative tolerance, not exact equality: pow/sqrt/etc.
// aren't guaranteed bit-identical across every platform's libm, and a
// bit-exact check would be flaky rather than rigorous.

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    num,
    v,
    call,
    add,
    mul,
    div,
    letIn,
    cmp,
    select,
    collectLets,
    catmullRomAst,
    fibonacciAst,
    splineFrameAsts,
    kitchenSinkAst,
    emitters,
} = require("../index.js");

function catmullRomReference(P0, P1, P2, P3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * P1 + (-P0 + P2) * t + (2 * P0 - 5 * P1 + 4 * P2 - P3) * t2 + (-P0 + 3 * P1 - 3 * P2 + P3) * t3);
}

function fibonacciReference(n) {
    // Plain iterative integer recurrence -- independent of the closed-form
    // (Binet's formula) the AST uses, so this also checks that the closed
    // form is accurate at these n, not just that every target agrees with
    // whatever it computes.
    let a = 0;
    let b = 1;
    for (let i = 0; i < n; i++) {
        [a, b] = [b, a + b];
    }
    return a;
}

// Exercises let + select + cmp together: length computed once via letIn,
// then select() picks between the normalized value and a safe fallback.
// Covers the near-zero case specifically, since that's the one a naive
// select-as-a-guard implementation gets wrong (see ast.js's select() doc
// comment and samples/spline-frame.js's safeDiv).
const EPS = num(1e-9);
const normalizeXAst = {
    name: "normalizeX",
    params: ["x", "y", "z"],
    body: letIn(
        "len",
        call("sqrt", add(mul(v("x"), v("x")), mul(v("y"), v("y")), mul(v("z"), v("z")))),
        select(cmp(v("len"), ">", EPS), div(v("x"), v("len")), num(0)),
    ),
};

function normalizeXReference(x, y, z) {
    const len = Math.sqrt(x * x + y * y + z * z);
    return len > 1e-9 ? x / len : 0;
}

const SAMPLES = {
    catmullRom: {
        ast: catmullRomAst,
        reference: catmullRomReference,
        inputs: [
            [0.0, 1.0, 2.0, 3.0, 0.0],
            [0.0, 1.0, 2.0, 3.0, 0.5],
            [0.0, 1.0, 2.0, 3.0, 1.0],
            [-4.2, 7.1, 0.0, 12.75, 0.33],
        ],
    },
    fibonacci: {
        ast: fibonacciAst,
        reference: fibonacciReference,
        inputs: [[0], [1], [2], [10], [20], [30]],
    },
    normalizeX: {
        ast: normalizeXAst,
        reference: normalizeXReference,
        inputs: [
            [1, 0, 0],
            [3, 4, 0],
            [1, 1, 1],
            [0, 0, 0], // degenerate: len=0, must fall back to 0, not divide
        ],
    },
    // Calls all 22 supported Math functions in one expression -- coverage,
    // not a formula with real meaning, so no independent reference (there
    // isn't a second sensible way to compute "call everything and sum").
    // x stays in (0, 1) so sqrt/log*/asin/acos are all simultaneously in
    // domain; d = x - y varies sign (and hits exactly 0 once) for
    // floor/ceil/round/trunc/sign, while deliberately avoiding exact .5
    // boundaries -- see samples/kitchen-sink.js for why.
    kitchenSink: {
        ast: kitchenSinkAst,
        inputs: [
            [0.5, 0.2],
            [0.3, 0.7],
            [0.9, 0.9], // d = 0 exactly
            [0.1, 2.5],
        ],
    },
};

function assertClose(actual, expected, msg) {
    const tol = 1e-9 * Math.max(1, Math.abs(expected));
    assert.ok(
        Math.abs(actual - expected) <= tol,
        `${msg}: got ${actual}, expected ${expected} (diff ${Math.abs(actual - expected)})`,
    );
}

function hasTool(cmd, args) {
    try {
        execFileSync(cmd, args, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

// typescript is a local devDependency (needed to verify the .ts output
// actually type-checks and runs), not a system tool like gcc/go/rustc/javac
// -- but it's guarded with the same hasTool/skip pattern anyway, in case
// tests ever run against a partial node_modules.
const TSC_BIN = path.join(__dirname, "..", "node_modules", ".bin", "tsc");

const TOOLS = {
    gcc: hasTool("gcc", ["--version"]),
    go: hasTool("go", ["version"]),
    rustc: hasTool("rustc", ["--version"]),
    java: hasTool("javac", ["-version"]) && hasTool("java", ["-version"]),
    tsc: hasTool(TSC_BIN, ["--version"]),
};

function tmpDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// The emitted JS implementation, loaded in-process, is the baseline every
// compiled target gets compared against.
function loadJsFn(ast) {
    const source = emitters.js.emitFunction(ast);
    const file = path.join(
        os.tmpdir(),
        `${ast.name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.js`,
    );
    fs.writeFileSync(file, source);
    const mod = require(file);
    fs.unlinkSync(file);
    return mod[ast.name];
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- C -----------------------------------------------------------------

function runC(ast, inputs) {
    const source = emitters.c.emitFunction(ast);
    const dir = tmpDir("ef-c-");
    fs.writeFileSync(path.join(dir, "fn.c"), source);
    const decls = ast.params.map((p, i) => `double ${p} = atof(argv[${i + 1}]);`).join(" ");
    const callArgs = ast.params.join(", ");
    const harness =
        `#include <stdio.h>\n#include <stdlib.h>\n#include "fn.c"\n` +
        `int main(int argc, char **argv) {\n    ${decls}\n    printf("%.17f", ${ast.name}(${callArgs}));\n    return 0;\n}\n`;
    fs.writeFileSync(path.join(dir, "main.c"), harness);
    const bin = path.join(dir, "bin");
    execFileSync("gcc", [path.join(dir, "main.c"), "-o", bin, "-lm"]);
    const results = inputs.map((args) => Number(execFileSync(bin, args.map(String)).toString()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- Go ------------------------------------------------------------------

function runGo(ast, inputs) {
    const source = emitters.go.emitFunction(ast);
    const funcDecl = source.slice(source.indexOf("func "));
    const usesMath = funcDecl.includes("math.");
    const dir = tmpDir("ef-go-");
    execFileSync("go", ["mod", "init", "ef"], { cwd: dir, stdio: "ignore" });
    const parses = ast.params
        .map((p, i) => `\t${p}, _ := strconv.ParseFloat(os.Args[${i + 1}], 64)`)
        .join("\n");
    const callArgs = ast.params.join(", ");
    const mainSrc =
        `package main\n\n` +
        `import (\n\t"fmt"\n${usesMath ? `\t"math"\n` : ""}\t"os"\n\t"strconv"\n)\n\n` +
        `${funcDecl}\n` +
        `func main() {\n${parses}\n\tfmt.Printf("%.17f", ${capitalize(ast.name)}(${callArgs}))\n}\n`;
    fs.writeFileSync(path.join(dir, "main.go"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("go", ["build", "-o", bin, "."], { cwd: dir });
    const results = inputs.map((args) => Number(execFileSync(bin, args.map(String)).toString()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- Rust ------------------------------------------------------------------

function runRust(ast, inputs) {
    const source = emitters.rust.emitFunction(ast);
    const dir = tmpDir("ef-rs-");
    const parses = ast.params
        .map((p, i) => `    let ${p}: f64 = args[${i + 1}].parse().unwrap();`)
        .join("\n");
    const callArgs = ast.params.join(", ");
    const mainSrc =
        `${source}\n` +
        `fn main() {\n` +
        `    let args: Vec<String> = std::env::args().collect();\n` +
        `${parses}\n` +
        `    print!("{:.17}", ${ast.name}(${callArgs}));\n` +
        `}\n`;
    const srcPath = path.join(dir, "main.rs");
    fs.writeFileSync(srcPath, mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("rustc", ["-O", srcPath, "-o", bin], { stdio: "ignore" });
    const results = inputs.map((args) => Number(execFileSync(bin, args.map(String)).toString()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- Java --------------------------------------------------------------

function runJava(ast, inputs) {
    const source = emitters.java.emitFunction(ast);
    const className = capitalize(ast.name);
    const dir = tmpDir("ef-java-");
    fs.writeFileSync(path.join(dir, `${className}.java`), source);
    const parses = ast.params
        .map((p, i) => `        double ${p} = Double.parseDouble(args[${i}]);`)
        .join("\n");
    const callArgs = ast.params.join(", ");
    const mainSrc =
        `public class Main {\n` +
        `    public static void main(String[] args) {\n` +
        `${parses}\n` +
        `        System.out.printf("%.17f", ${className}.${ast.name}(${callArgs}));\n` +
        `    }\n` +
        `}\n`;
    fs.writeFileSync(path.join(dir, "Main.java"), mainSrc);
    execFileSync("javac", ["-d", dir, path.join(dir, `${className}.java`), path.join(dir, "Main.java")]);
    const results = inputs.map((args) =>
        Number(execFileSync("java", ["-cp", dir, "Main", ...args.map(String)]).toString()),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- TypeScript ------------------------------------------------------------
//
// Unlike C/Go/Rust/Java, this doesn't need an argv-parsing harness or a
// printf/parse round trip: tsc both type-checks AND compiles to plain JS
// (catching a type error the same way C/Go/Rust catch build errors), and
// the result can just be require()'d and called in-process. That also
// means one function handles both scalar and suite results unchanged --
// tsc's output returns a number or an object either way, matching
// whatever registerConformance/registerSuiteConformance expects; the
// (unused, for suites) outputNames parameter is only there so this fits
// the same run(ast, inputs, outputNames) shape as the suite runners below.
function runTS(ast, inputs) {
    const source = emitters.ts.emitFunction(ast);
    const dir = tmpDir("ef-ts-");
    const srcPath = path.join(dir, "fn.ts");
    fs.writeFileSync(srcPath, source);
    execFileSync(TSC_BIN, ["--strict", "--target", "es2020", "--module", "commonjs", "--outDir", dir, srcPath]);
    const mod = require(path.join(dir, "fn.js"));
    const results = inputs.map((args) => mod[ast.name](...args));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- suite (multi-output) variants ----------------------------------------
//
// Same idea as the four run* functions above, but a suite returns several
// named values (see ast.js's outputs()), not one -- each harness prints one
// value per line, in the same field order the emitter itself used
// (Object.keys order, matching suiteOutputNames below), and each result
// comes back as a { [fieldName]: number } record instead of a bare number.

function suiteOutputNames(ast) {
    const { body } = collectLets(ast.body);
    if (body.type !== "outputs") {
        throw new Error(`test/conformance.test.js: ${ast.name} is not a suite (body.type is "${body.type}")`);
    }
    return Object.keys(body.fields);
}

function parseSuiteOutput(stdout, outputNames) {
    const lines = stdout.toString().trim().split("\n");
    const record = {};
    outputNames.forEach((name, i) => {
        record[name] = Number(lines[i]);
    });
    return record;
}

function runSuiteC(ast, inputs, outputNames) {
    const source = emitters.c.emitFunction(ast);
    const dir = tmpDir("ef-c-");
    fs.writeFileSync(path.join(dir, "fn.c"), source);
    const decls = ast.params.map((p, i) => `double ${p} = atof(argv[${i + 1}]);`).join(" ");
    const callArgs = ast.params.join(", ");
    const structName = `${capitalize(ast.name)}Result`;
    const prints = outputNames.map((n) => `printf("%.17f\\n", r.${n});`).join(" ");
    const harness =
        `#include <stdio.h>\n#include <stdlib.h>\n#include "fn.c"\n` +
        `int main(int argc, char **argv) {\n    ${decls}\n    ${structName} r = ${ast.name}(${callArgs});\n    ${prints}\n    return 0;\n}\n`;
    fs.writeFileSync(path.join(dir, "main.c"), harness);
    const bin = path.join(dir, "bin");
    execFileSync("gcc", [path.join(dir, "main.c"), "-o", bin, "-lm"]);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync(bin, args.map(String)), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteGo(ast, inputs, outputNames) {
    const source = emitters.go.emitFunction(ast);
    const funcDecl = source.slice(source.indexOf("func "));
    const usesMath = funcDecl.includes("math.");
    const dir = tmpDir("ef-go-");
    execFileSync("go", ["mod", "init", "ef"], { cwd: dir, stdio: "ignore" });
    const parses = ast.params
        .map((p, i) => `\t${p}, _ := strconv.ParseFloat(os.Args[${i + 1}], 64)`)
        .join("\n");
    const callArgs = ast.params.join(", ");
    const resultVars = outputNames.map((_, i) => `r${i}`).join(", ");
    const printFmt = outputNames.map(() => "%.17f").join("\\n");
    const mainSrc =
        `package main\n\n` +
        `import (\n\t"fmt"\n${usesMath ? `\t"math"\n` : ""}\t"os"\n\t"strconv"\n)\n\n` +
        `${funcDecl}\n` +
        `func main() {\n${parses}\n\t${resultVars} := ${capitalize(ast.name)}(${callArgs})\n\tfmt.Printf("${printFmt}\\n", ${resultVars})\n}\n`;
    fs.writeFileSync(path.join(dir, "main.go"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("go", ["build", "-o", bin, "."], { cwd: dir });
    const results = inputs.map((args) => parseSuiteOutput(execFileSync(bin, args.map(String)), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteRust(ast, inputs, outputNames) {
    const source = emitters.rust.emitFunction(ast);
    const dir = tmpDir("ef-rs-");
    const parses = ast.params
        .map((p, i) => `    let ${p}: f64 = args[${i + 1}].parse().unwrap();`)
        .join("\n");
    const callArgs = ast.params.join(", ");
    const prints = outputNames.map((n) => `println!("{:.17}", r.${n});`).join("\n    ");
    const mainSrc =
        `${source}\n` +
        `fn main() {\n` +
        `    let args: Vec<String> = std::env::args().collect();\n` +
        `${parses}\n` +
        `    let r = ${ast.name}(${callArgs});\n` +
        `    ${prints}\n` +
        `}\n`;
    const srcPath = path.join(dir, "main.rs");
    fs.writeFileSync(srcPath, mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("rustc", ["-O", srcPath, "-o", bin], { stdio: "ignore" });
    const results = inputs.map((args) => parseSuiteOutput(execFileSync(bin, args.map(String)), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteJava(ast, inputs, outputNames) {
    const source = emitters.java.emitFunction(ast);
    const className = capitalize(ast.name);
    const dir = tmpDir("ef-java-");
    fs.writeFileSync(path.join(dir, `${className}.java`), source);
    const parses = ast.params
        .map((p, i) => `        double ${p} = Double.parseDouble(args[${i}]);`)
        .join("\n");
    const callArgs = ast.params.join(", ");
    const printFmt = outputNames.map(() => "%.17f").join("\\n");
    const printArgs = outputNames.map((n) => `r.${n}`).join(", ");
    const mainSrc =
        `public class Main {\n` +
        `    public static void main(String[] args) {\n` +
        `${parses}\n` +
        `        ${className}.Result r = ${className}.${ast.name}(${callArgs});\n` +
        `        System.out.printf("${printFmt}\\n", ${printArgs});\n` +
        `    }\n` +
        `}\n`;
    fs.writeFileSync(path.join(dir, "Main.java"), mainSrc);
    execFileSync("javac", ["-d", dir, path.join(dir, `${className}.java`), path.join(dir, "Main.java")]);
    const results = inputs.map((args) =>
        parseSuiteOutput(execFileSync("java", ["-cp", dir, "Main", ...args.map(String)]), outputNames),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function registerSuiteConformance(sampleName, { ast, inputs }) {
    const outputNames = suiteOutputNames(ast);
    const targets = [
        ["C", TOOLS.gcc, runSuiteC],
        ["Go", TOOLS.go, runSuiteGo],
        ["Rust", TOOLS.rustc, runSuiteRust],
        ["Java", TOOLS.java, runSuiteJava],
        ["TypeScript", TOOLS.tsc, runTS],
    ];

    for (const [label, available, run] of targets) {
        test(
            `${sampleName}: ${label} emitted output matches JS`,
            { skip: !available && `${label} toolchain not available` },
            () => {
                const jsFn = loadJsFn(ast);
                const expected = inputs.map((args) => jsFn(...args));
                const actual = run(ast, inputs, outputNames);
                assert.strictEqual(actual.length, expected.length);
                for (let i = 0; i < inputs.length; i++) {
                    for (const name of outputNames) {
                        assertClose(
                            actual[i][name],
                            expected[i][name],
                            `${label} vs JS at args=${JSON.stringify(inputs[i])}, field "${name}"`,
                        );
                    }
                }
            },
        );
    }
}

// --- test registration ---------------------------------------------------

function registerConformance(sampleName, { ast, reference, inputs }) {
    if (reference) {
        test(`${sampleName}: emitted JS matches an independent reference implementation`, () => {
            const fn = loadJsFn(ast);
            for (const args of inputs) {
                assertClose(fn(...args), reference(...args), `args=${JSON.stringify(args)}`);
            }
        });
    }

    const targets = [
        ["C", TOOLS.gcc, runC],
        ["Go", TOOLS.go, runGo],
        ["Rust", TOOLS.rustc, runRust],
        ["Java", TOOLS.java, runJava],
        ["TypeScript", TOOLS.tsc, runTS],
    ];

    for (const [label, available, run] of targets) {
        test(
            `${sampleName}: ${label} emitted output matches JS`,
            { skip: !available && `${label} toolchain not available` },
            () => {
                const jsFn = loadJsFn(ast);
                const expected = inputs.map((args) => jsFn(...args));
                const actual = run(ast, inputs);
                assert.strictEqual(actual.length, expected.length);
                for (let i = 0; i < inputs.length; i++) {
                    assertClose(actual[i], expected[i], `${label} vs JS at args=${JSON.stringify(inputs[i])}`);
                }
            },
        );
    }
}

for (const [sampleName, sample] of Object.entries(SAMPLES)) {
    registerConformance(sampleName, sample);
}

// --- samples/spline-frame.js ---------------------------------------------
//
// The real-world motivating case for let/select/cmp, and now for outputs()
// (see ast.js): 4 suites, each replacing what used to be several separate
// functions independently re-deriving the same let-chain. No independent
// per-suite reference (that would mean re-deriving the whole Gram-Schmidt
// frame math by hand) — instead, cross-language conformance (every target
// vs. JS) for all 4, plus one independent check of a property the math
// must satisfy regardless of how it's computed: the constructed R basis
// vector is unit length, including at the degenerate (0,0,0) tangent
// where safeDiv's fallback kicks in.

const SPLINE_FRAME_INPUTS = {
    "tx,ty,tz": [
        [0, 1, 0], // near-vertical branch
        [1, 0, 0], // normal branch
        [0, 0, 0], // degenerate: safeDiv fallback
        [0.577, 0.577, 0.577],
    ],
    "wx,wy_wire,wz_wire,tx,ty,tz,prDeg,so": [
        [0, 0, 0, 1, 0, 0, 0, 1],
        [1, 2, 3, 0, 1, 0, 90, 0.5],
        [0, 0, 0, 0, 0, 0, 45, 1], // degenerate tangent
    ],
    "ux,uy,uz,rx,ry,rz,crDeg": [
        [1, 0, 0, 0, 1, 0, 0],
        [1, 0, 0, 0, 1, 0, 90],
        [0, 1, 0, 1, 0, 0, 45],
    ],
    t: [[0], [0.5], [1], [-0.3]],
};

for (const ast of splineFrameAsts) {
    const inputs = SPLINE_FRAME_INPUTS[ast.params.join(",")];
    if (!inputs) {
        throw new Error(`test/conformance.test.js: no sample inputs registered for params ${ast.params.join(",")}`);
    }
    registerSuiteConformance(`splineFrame.${ast.name}`, { ast, inputs });
}

test("spline-frame: SpEfMkFrame's R is unit length, including at the degenerate tangent", () => {
    const mkFrame = loadJsFn(splineFrameAsts.find((a) => a.name === "SpEfMkFrame"));
    const tangents = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0.99, 0.1],
        [0.577, 0.577, 0.577],
        [0, 0, 0], // degenerate -- fallback frame (0,0,1) must still be unit length
    ];
    for (const [tx, ty, tz] of tangents) {
        const { rx, ry, rz } = mkFrame(tx, ty, tz);
        const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
        assert.ok(Math.abs(len - 1) < 1e-9, `R not unit length for tangent (${tx},${ty},${tz}): len=${len}`);
    }
});
