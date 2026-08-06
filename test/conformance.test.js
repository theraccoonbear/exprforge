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

const { catmullRomAst, fibonacciAst, emitters } = require("../index.js");

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

const TOOLS = {
    gcc: hasTool("gcc", ["--version"]),
    go: hasTool("go", ["version"]),
    rustc: hasTool("rustc", ["--version"]),
    java: hasTool("javac", ["-version"]) && hasTool("java", ["-version"]),
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

// --- test registration ---------------------------------------------------

function registerConformance(sampleName, { ast, reference, inputs }) {
    test(`${sampleName}: emitted JS matches an independent reference implementation`, () => {
        const fn = loadJsFn(ast);
        for (const args of inputs) {
            assertClose(fn(...args), reference(...args), `args=${JSON.stringify(args)}`);
        }
    });

    const targets = [
        ["C", TOOLS.gcc, runC],
        ["Go", TOOLS.go, runGo],
        ["Rust", TOOLS.rustc, runRust],
        ["Java", TOOLS.java, runJava],
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
