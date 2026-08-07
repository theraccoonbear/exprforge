// exprforge/test/conformance.test.js
//
// This is the thing that actually justifies the tool's existence: proving
// the emitted targets agree numerically, not just that they compile. Each
// compiled-language block is skipped (not failed) when its toolchain isn't
// on PATH, so this suite degrades gracefully across machines — see
// .github/workflows/test-*.yml (one file per language) for the CI images
// that have them.
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
    mathDemoAst,
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
// comment and samples/spline-frame.js's safeDiv) -- and this AST
// deliberately IS that naive pattern (div(x, mag) directly in the guarded
// branch, not clamped first), specifically to demonstrate the divergence:
// JS/C/Go/Rust/Java/TS all short-circuit their ternary/if, so div-by-zero
// never actually executes there, but QB64's select always evaluates both
// branches -- 0/0 there really does produce NaN, confirmed against a real
// QB64 compiler. That's not a QB64 bug to fix; it's this AST correctly
// being unsafe on the one target that can't short-circuit around it, which
// is exactly why samples/spline-frame.js's safeDiv clamps the denominator
// instead of guarding the division directly. QB64 is excluded from this
// one test's targets below for that reason -- everywhere else, expected
// and required to agree.
const EPS = num(1e-9);
const normalizeXAst = {
    name: "normalizeX",
    params: ["x", "y", "z"],
    // "mag", not "len": LEN is a reserved QB64 builtin (string/array
    // length) -- Dim'ing a local named "len" fails to compile there. See
    // the QB64 gotchas this project's memory records from a sibling
    // project's experience.
    body: letIn(
        "mag",
        call("sqrt", add(mul(v("x"), v("x")), mul(v("y"), v("y")), mul(v("z"), v("z")))),
        select(cmp(v("mag"), ">", EPS), div(v("x"), v("mag")), num(0)),
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
        // Deliberately excludes QB64 -- see the comment on normalizeXAst
        // above for why it's expected (not a bug) to diverge there.
        skipTargets: ["QB64"],
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

const TOOLS = {
    gcc: hasTool("gcc", ["--version"]),
    go: hasTool("go", ["version"]),
    rustc: hasTool("rustc", ["--version"]),
    java: hasTool("javac", ["-version"]) && hasTool("java", ["-version"]),
    // tsc is a system tool here exactly like gcc/go/rustc/javac -- looked
    // up on PATH, never a project dependency. exprforge only ever
    // generates .ts source text; it doesn't execute or type-check
    // TypeScript itself, so there's nothing for the package to depend on.
    // If tsc isn't installed wherever this runs, these tests just skip,
    // same as Java does without a local JDK.
    tsc: hasTool("tsc", ["--version"]),
    qb64: hasTool("qb64pe", ["-v"]),
    dotnet: hasTool("dotnet", ["--version"]),
    python: hasTool("python3", ["--version"]),
    lua: hasTool("lua", ["-v"]),
};

// Optional CI-only filter: EXPRFORGE_TEST_TARGETS="Go" npm test runs only
// the Go-labeled checks (plus the toolchain-independent JS/reference ones,
// which aren't gated by this at all). Unset locally, so `npm test` on a
// dev machine still runs everything its installed toolchains allow --
// this exists so CI can run each language's checks in its own workflow
// (installing just that one toolchain) instead of one job serially
// installing all of them, most of which have nothing to do with each
// other -- also what gets each language its own status badge. See
// .github/workflows/test-*.yml.
const TARGET_FILTER = process.env.EXPRFORGE_TEST_TARGETS
    ? new Set(process.env.EXPRFORGE_TEST_TARGETS.split(",").map((s) => s.trim()))
    : null;

function targetAllowed(label) {
    return !TARGET_FILTER || TARGET_FILTER.has(label);
}

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
    execFileSync("tsc", ["--strict", "--target", "es2020", "--module", "commonjs", "--outDir", dir, srcPath]);
    const mod = require(path.join(dir, "fn.js"));
    const results = inputs.map((args) => mod[ast.name](...args));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- QB64 --------------------------------------------------------------
//
// Headless via `$CONSOLE:ONLY`: makes the compiled binary a pure text-
// console program with no SDL/graphics window, so no display (real or
// virtual) is needed, unlike a typical QB64 build. Args come in via
// COMMAND$(n); a suite's output params are just plain local variables
// passed to the SUB and read back after the CALL, since QB64 SUB params
// are by reference by default.

// QB64's PRINT, like its own literal syntax, uses D (not E) as the
// exponent marker for a double in scientific notation ("...D-17") --
// confirmed against a real compiler. Plain Number() doesn't understand
// that and silently gives NaN, so this is needed on every value QB64
// prints, not just ones near the E/D-notation-vs-fixed threshold.
function qb64ToNumber(str) {
    return Number(str.replace(/D([+-]?\d+)/i, "E$1"));
}

function runQB64(ast, inputs) {
    const source = emitters.qb64.emitFunction(ast);
    const dir = tmpDir("ef-qb64-");
    const argReads = ast.params
        .map((p, i) => `DIM ${p} AS DOUBLE : ${p} = VAL(COMMAND$(${i + 1}))`)
        .join("\n");
    const callArgs = ast.params.join(", ");
    const harness =
        `$CONSOLE:ONLY\n${source}\n${argReads}\nPRINT ${ast.name}#(${callArgs})\nSYSTEM\n`;
    const srcPath = path.join(dir, "main.bas");
    fs.writeFileSync(srcPath, harness);
    const bin = path.join(dir, "bin");
    execFileSync("qb64pe", ["-x", srcPath, "-o", bin], { stdio: "ignore" });
    const results = inputs.map((args) => qb64ToNumber(execFileSync(bin, args.map(String)).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteQB64(ast, inputs, outputNames) {
    const source = emitters.qb64.emitFunction(ast);
    const dir = tmpDir("ef-qb64-");
    const argReads = ast.params
        .map((p, i) => `DIM ${p} AS DOUBLE : ${p} = VAL(COMMAND$(${i + 1}))`)
        .join("\n");
    const callArgs = ast.params.join(", ");
    const outDecl = `DIM ${outputNames.join(" AS DOUBLE, ")} AS DOUBLE`;
    const prints = outputNames.map((n) => `PRINT ${n}`).join("\n");
    const harness =
        `$CONSOLE:ONLY\n${source}\n${argReads}\n${outDecl}\n` +
        `CALL ${ast.name}(${callArgs}, ${outputNames.join(", ")})\n${prints}\nSYSTEM\n`;
    const srcPath = path.join(dir, "main.bas");
    fs.writeFileSync(srcPath, harness);
    const bin = path.join(dir, "bin");
    execFileSync("qb64pe", ["-x", srcPath, "-o", bin], { stdio: "ignore" });
    const results = inputs.map((args) => {
        const lines = execFileSync(bin, args.map(String)).toString().trim().split("\n");
        const record = {};
        outputNames.forEach((name, i) => {
            record[name] = qb64ToNumber(lines[i]);
        });
        return record;
    });
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

// --- C# --------------------------------------------------------------
//
// dotnet build needs a project, not a single file -- a minimal SDK-style
// .csproj gets written alongside the emitted source each time. Built once
// per test (dotnet build, into an out/ subdir) and the resulting .dll run
// directly (dotnet <dll>) per input row, same compile-once-run-many shape
// as C/Go/Rust. InvariantGlobalization avoids any locale-dependent decimal
// separator surprises when parsing argv.

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <InvariantGlobalization>true</InvariantGlobalization>
  </PropertyGroup>
</Project>
`;

// Matches csharp.js's wrapperClassName -- not just capitalize(fn.name),
// since C# forbids a member sharing its enclosing type's exact name and
// every SpEf-prefixed sample name is already capitalized (see csharp.js).
function csharpClassName(fnName) {
    return `${capitalize(fnName)}Impl`;
}

function runCSharp(ast, inputs) {
    const source = emitters.csharp.emitFunction(ast);
    const className = csharpClassName(ast.name);
    const dir = tmpDir("ef-cs-");
    fs.writeFileSync(path.join(dir, `${className}.cs`), source);
    fs.writeFileSync(path.join(dir, "app.csproj"), CSPROJ);
    const parses = ast.params.map((p, i) => `double ${p} = double.Parse(args[${i}]);`).join("\n");
    const callArgs = ast.params.join(", ");
    const mainSrc = `${parses}\nConsole.WriteLine(${className}.${ast.name}(${callArgs}).ToString("G17"));\n`;
    fs.writeFileSync(path.join(dir, "Program.cs"), mainSrc);
    const outDir = path.join(dir, "out");
    execFileSync("dotnet", ["build", "-c", "Release", "-o", outDir], { cwd: dir, stdio: "ignore" });
    const dll = path.join(outDir, "app.dll");
    const results = inputs.map((args) => Number(execFileSync("dotnet", [dll, ...args.map(String)]).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteCSharp(ast, inputs, outputNames) {
    const source = emitters.csharp.emitFunction(ast);
    const className = csharpClassName(ast.name);
    const dir = tmpDir("ef-cs-");
    fs.writeFileSync(path.join(dir, `${className}.cs`), source);
    fs.writeFileSync(path.join(dir, "app.csproj"), CSPROJ);
    const parses = ast.params.map((p, i) => `double ${p} = double.Parse(args[${i}]);`).join("\n");
    const callArgs = ast.params.join(", ");
    const prints = outputNames.map((n) => `Console.WriteLine(r.${n}.ToString("G17"));`).join("\n");
    const mainSrc = `${parses}\nvar r = ${className}.${ast.name}(${callArgs});\n${prints}\n`;
    fs.writeFileSync(path.join(dir, "Program.cs"), mainSrc);
    const outDir = path.join(dir, "out");
    execFileSync("dotnet", ["build", "-c", "Release", "-o", outDir], { cwd: dir, stdio: "ignore" });
    const dll = path.join(outDir, "app.dll");
    const results = inputs.map((args) => parseSuiteOutput(execFileSync("dotnet", [dll, ...args.map(String)]), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- Python --------------------------------------------------------------
//
// No compile step -- python3 interprets the emitted source directly, with
// a small argv-reading harness appended.

function runPython(ast, inputs) {
    const source = emitters.python.emitFunction(ast);
    const dir = tmpDir("ef-py-");
    const parses = ast.params.map((p, i) => `${p} = float(sys.argv[${i + 1}])`).join("\n");
    const callArgs = ast.params.join(", ");
    const harness = `${source}\nimport sys\n${parses}\nprint(repr(${ast.name}(${callArgs})))\n`;
    const srcPath = path.join(dir, "main.py");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => Number(execFileSync("python3", [srcPath, ...args.map(String)]).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuitePython(ast, inputs, outputNames) {
    const source = emitters.python.emitFunction(ast);
    const dir = tmpDir("ef-py-");
    const parses = ast.params.map((p, i) => `${p} = float(sys.argv[${i + 1}])`).join("\n");
    const callArgs = ast.params.join(", ");
    const prints = outputNames.map((n) => `print(repr(r.${n}))`).join("\n");
    const harness = `${source}\nimport sys\n${parses}\nr = ${ast.name}(${callArgs})\n${prints}\n`;
    const srcPath = path.join(dir, "main.py");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync("python3", [srcPath, ...args.map(String)]), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- Lua -------------------------------------------------------------------
//
// No compile step -- lua interprets the emitted source directly. CLI args
// arrive via the global `arg` table (arg[1] is the first argument, like
// argv[1] in C -- arg[0] is the script name, same convention).

function runLua(ast, inputs) {
    const source = emitters.lua.emitFunction(ast);
    const dir = tmpDir("ef-lua-");
    const parses = ast.params.map((p, i) => `local ${p} = tonumber(arg[${i + 1}])`).join("\n");
    const callArgs = ast.params.join(", ");
    const harness = `${source}\n${parses}\nprint(string.format("%.17g", ${ast.name}(${callArgs})))\n`;
    const srcPath = path.join(dir, "main.lua");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => Number(execFileSync("lua", [srcPath, ...args.map(String)]).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteLua(ast, inputs, outputNames) {
    const source = emitters.lua.emitFunction(ast);
    const dir = tmpDir("ef-lua-");
    const parses = ast.params.map((p, i) => `local ${p} = tonumber(arg[${i + 1}])`).join("\n");
    const callArgs = ast.params.join(", ");
    const resultVars = outputNames.map((_, i) => `r${i}`).join(", ");
    const prints = outputNames.map((_, i) => `print(string.format("%.17g", r${i}))`).join("\n");
    const harness = `${source}\n${parses}\nlocal ${resultVars} = ${ast.name}(${callArgs})\n${prints}\n`;
    const srcPath = path.join(dir, "main.lua");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync("lua", [srcPath, ...args.map(String)]), outputNames));
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
        ["QB64", TOOLS.qb64, runSuiteQB64],
        ["C#", TOOLS.dotnet, runSuiteCSharp],
        ["Python", TOOLS.python, runSuitePython],
        ["Lua", TOOLS.lua, runSuiteLua],
    ].filter(([label]) => targetAllowed(label));

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

function registerConformance(sampleName, { ast, reference, inputs, skipTargets = [] }) {
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
        ["QB64", TOOLS.qb64, runQB64],
        ["C#", TOOLS.dotnet, runCSharp],
        ["Python", TOOLS.python, runPython],
        ["Lua", TOOLS.lua, runLua],
    ].filter(([label]) => !skipTargets.includes(label) && targetAllowed(label));

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

// --- samples/math-demo.js -------------------------------------------------
//
// Cross-language coverage for require("exprforge/math") (see
// /v0.2.0-spec.md and math/index.js). One suite exercising every helper at
// once, same shape as the splineFrame wiring above. Input rows are chosen
// to hit both the safe and degenerate/fallback path of each guarded
// helper, not just the easy case:
//   row 0: everything comfortably in the "normal" branch.
//   row 1: vector a is (0,0,0) -- normalize3's fallback kicks in for normA;
//          t is below lo -- clamp's low branch.
//   row 2: vector b is (0,0,0) -- normalize3's fallback for normB, AND
//          bx == 0 -- safeDiv's fallback (-1); t is above hi -- clamp's
//          high branch.
//   row 3: two non-axis-aligned, non-degenerate vectors; t inside [lo,hi]
//          -- clamp is a no-op, both normalize3 calls take the safe path.
const MATH_DEMO_INPUTS = [
    [3, 4, 0, 1, 0, 0, 0.5, 0, 1],
    [0, 0, 0, 1, 1, 1, -0.5, 0, 1],
    [1, 0, 0, 0, 0, 0, 1.5, 0, 1],
    [0.577, 0.577, 0.577, 0.577, -0.577, 0.577, 0.3, -1, 1],
];

registerSuiteConformance("mathDemo", { ast: mathDemoAst, inputs: MATH_DEMO_INPUTS });

test("math-demo: normalize3's fallback is used exactly when the input vector is (0,0,0)", () => {
    const mathDemo = loadJsFn(mathDemoAst);
    const safe = mathDemo(1, 0, 0, 1, 0, 0, 0.5, 0, 1);
    assert.ok(Math.abs(safe.normAX ** 2 + safe.normAY ** 2 + safe.normAZ ** 2 - 1) < 1e-9, "normal input normalizes to unit length");

    const degenerate = mathDemo(0, 0, 0, 1, 0, 0, 0.5, 0, 1);
    // Default fallback per math/index.js: (0, 1, 0).
    assertClose(degenerate.normAX, 0, "degenerate normA.x falls back to 0");
    assertClose(degenerate.normAY, 1, "degenerate normA.y falls back to 1");
    assertClose(degenerate.normAZ, 0, "degenerate normA.z falls back to 0");
});

test("math-demo: clamp actually clamps at both ends and is a no-op inside range", () => {
    const mathDemo = loadJsFn(mathDemoAst);
    assertClose(mathDemo(1, 0, 0, 1, 0, 0, -0.5, 0, 1).clamped, 0, "below lo clamps to lo");
    assertClose(mathDemo(1, 0, 0, 1, 0, 0, 1.5, 0, 1).clamped, 1, "above hi clamps to hi");
    assertClose(mathDemo(1, 0, 0, 1, 0, 0, 0.5, 0, 1).clamped, 0.5, "inside range passes through unchanged");
});

test("math-demo: safeDiv falls back to its third argument exactly when the denominator is 0", () => {
    const mathDemo = loadJsFn(mathDemoAst);
    assertClose(mathDemo(1, 0, 0, 1, 0, 0, 0.5, 0, 1).safeDivResult, 1, "1/1 takes the safe path");
    assertClose(mathDemo(1, 0, 0, 0, 0, 0, 0.5, 0, 1).safeDivResult, -1, "bx=0 falls back to -1");
});

test("math-demo: cross3's result is orthogonal to both input vectors", () => {
    const mathDemo = loadJsFn(mathDemoAst);
    const dot = (ux, uy, uz, wx, wy, wz) => ux * wx + uy * wy + uz * wz;
    for (const args of MATH_DEMO_INPUTS) {
        const [ax, ay, az, bx, by, bz] = args;
        const { crossX, crossY, crossZ } = mathDemo(...args);
        assertClose(dot(crossX, crossY, crossZ, ax, ay, az), 0, `cross·a at args=${JSON.stringify(args)}`);
        assertClose(dot(crossX, crossY, crossZ, bx, by, bz), 0, `cross·b at args=${JSON.stringify(args)}`);
    }
});

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
