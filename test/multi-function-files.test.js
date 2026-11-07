// exprforge/test/multi-function-files.test.js
//
// emitFile() emits several functions as one complete source file. This
// file compiles or runs that output for real, against every available
// toolchain, for every target that has a toolchain: a repeated
// declaration (QB64/COBOL helper FUNCTIONs, Go's package clause, a second
// PHP open tag, Java's one-public-class rule, Zig's duplicate import) is
// only visible to a real compiler.
//
// Background: github.com/theraccoonbear/exprforge/pull/37 reported QB64
// helpers duplicated when per-function outputs were concatenated by hand;
// auditing every other target found the same bug class in COBOL, Go, Zig,
// Java and PHP. emitFile() owns that now. Registry-driven static checks
// that every emitter defines each helper and import exactly once live in
// test/emit-file.test.js.
//
// See docs/multi-function-files.md for the per-target layout.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { tmpDir, compileQb64, runQb64, QB64_ERROR_PROLOGUE, QB64_ERROR_HANDLER } = require("./harness-util.js");
const { v, num, call, add, sub, cmp, select } = require("../ast.js");
const emitters = require("../emitters/registry.js");
const { emitFile } = require("../index.js");
const { DOTNET_TFM } = require("./dotnet-tfm.js");

const { TOOLS, bin, queried } = require("./toolchains.js");
const GUILE_BIN = bin("scheme");
const LUA_BIN = bin("lua");

// Two real functions, deliberately using DIFFERENT primitives (sqrt/log)
// so a mixup between them is obvious in the results -- f1(16) == 4,
// f2(E) == 1 (natural log of e), checked with a loose tolerance below.
const fn1 = { name: "f1", params: ["x"], body: call("sqrt", v("x")) };
const fn2 = { name: "f2", params: ["x"], body: call("log", v("x")) };
const F1_ARG = 16;
const F2_ARG = 2.718281828;
const F1_EXPECT = 4;
const F2_EXPECT = 1;
const TOL = 1e-4;

function assertClose(actual, expected, msg) {
    assert.ok(Math.abs(actual - expected) < TOL, `${msg}: got ${actual}, expected ~${expected}`);
}

// emitFile(): one complete source file per target, compiled or run for real.
function file(fns, lang, opts) {
    return emitFile(fns, lang, undefined, opts).source;
}

// --- QB64 --------------------------------------------------------------

test("whole file: QB64 -- 2 functions compile and run correctly", { skip: !TOOLS.qb64 && "qb64pe not available" }, () => {
    const src = file([fn1, fn2], "qb64");
    const dir = tmpDir("ef-multi-qb64-");
    const harness = `$CONSOLE:ONLY\n${src}\n${QB64_ERROR_PROLOGUE}PRINT f1#(${F1_ARG}#)\nPRINT f2#(${F2_ARG}#)\nSYSTEM\n${QB64_ERROR_HANDLER}`;
    const srcPath = path.join(dir, "main.bas");
    fs.writeFileSync(srcPath, harness);
    const bin = path.join(dir, "bin");
    compileQb64(srcPath, bin);
    const lines = runQb64(bin, []).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- COBOL ---------------------------------------------------------------
//
// GnuCOBOL programs are CALLable subprograms, not standalone executables
// (PROCEDURE DIVISION USING ...) -- same convention as
// test/conformance.test.js's own runCobol, a separate driver "mainharness"
// program CALLs each by name.
//
// NOT the shared fn1/fn2 (sqrt/log) every other target's test uses:
// compiling two programs that each use a decimal-heavy intrinsic (SQRT,
// LOG) together hits the fatal "unknown type name 'cob_decimal'" GnuCOBOL
// codegen bug already documented elsewhere in this project, a separate
// pre-existing GnuCOBOL fragility. Plain arithmetic never touches that
// path. Each function uses select(cmp(...)) with a different comparator,
// so the union of the two programs' ef-cmp-* helpers (gt and lt) has to be
// defined exactly once across the file.
const cobolFn1 = { name: "f1", params: ["x"], body: select(cmp(v("x"), ">", num(0)), add(v("x"), num(1)), sub(v("x"), num(1))) };
const cobolFn2 = { name: "f2", params: ["x"], body: select(cmp(v("x"), "<", num(0)), add(v("x"), num(1)), sub(v("x"), num(1))) };

test("whole file: COBOL -- 2 programs compile and run correctly, helpers defined once", { skip: !TOOLS.cobol && "cobc not available" }, () => {
    const src = file([cobolFn1, cobolFn2], "cobol");
    assert.strictEqual((src.match(/FUNCTION-ID\. ef-cmp-gt\./g) || []).length, 1);
    assert.strictEqual((src.match(/FUNCTION-ID\. ef-cmp-lt\./g) || []).length, 1);
    assert.strictEqual((src.match(/PROGRAM-ID\. f[12]\./g) || []).length, 2);
    assert.strictEqual((src.match(/>>SOURCE FORMAT FREE/g) || []).length, 1);
    const dir = tmpDir("ef-multi-cobol-");
    const fnsPath = path.join(dir, "fns.cob");
    fs.writeFileSync(fnsPath, src);
    const driver =
        `       >>SOURCE FORMAT FREE\n` +
        `       IDENTIFICATION DIVISION.\n` +
        `       PROGRAM-ID. mainharness.\n` +
        `       DATA DIVISION.\n` +
        `       WORKING-STORAGE SECTION.\n` +
        `       01 WS-X USAGE COMP-2.\n` +
        `       01 WS-R1 USAGE COMP-2.\n` +
        `       01 WS-R2 USAGE COMP-2.\n` +
        `       PROCEDURE DIVISION.\n` +
        `           COMPUTE WS-X = ${F1_ARG}\n` +
        `           CALL "f1" USING WS-X WS-R1\n` +
        `           COMPUTE WS-X = ${F2_ARG}\n` +
        `           CALL "f2" USING WS-X WS-R2\n` +
        `           DISPLAY WS-R1\n` +
        `           DISPLAY WS-R2\n` +
        `           STOP RUN.\n`;
    const driverPath = path.join(dir, "main.cob");
    fs.writeFileSync(driverPath, driver);
    const bin = path.join(dir, "bin");
    execFileSync("cobc", ["-x", "-free", "-o", bin, driverPath, fnsPath]);
    const lines = execFileSync(bin, []).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_ARG + 1, "f1");
    assertClose(parseFloat(lines[1]), F2_ARG - 1, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- Go --------------------------------------------------------------------
//
// Go requires every import before any other declaration. fn0 uses no
// library function and comes first: the import still lands at the top.

const fn0 = { name: "f0", params: ["x"], body: add(v("x"), num(1)) };
const F0_ARG = 2;
const F0_EXPECT = 3;

function importedOnce(src, needle, label) {
    assert.strictEqual(src.split(needle).length - 1, 1, `${label}: ${needle} should appear exactly once`);
}

test("whole file: Go -- imports hoisted above every declaration, file builds and runs", { skip: !TOOLS.go && "go not available" }, () => {
    const src = file([fn0, fn1, fn2], "go");
    importedOnce(src, "package exprforge", "go");
    importedOnce(src, `import "math"`, "go");
    assert.ok(src.indexOf(`import "math"`) < src.indexOf("func F0("));
    const dir = tmpDir("ef-multi-go-");
    fs.writeFileSync(path.join(dir, "go.mod"), "module goef\n\ngo 1.21\n");
    fs.mkdirSync(path.join(dir, "exprforge"));
    fs.writeFileSync(path.join(dir, "exprforge", "fns.go"), src);
    const mainSrc =
        `package main\n\n` +
        `import (\n\t"fmt"\n\t"goef/exprforge"\n)\n\n` +
        `func main() {\n\tfmt.Printf("%.17f\\n%.17f\\n%.17f\\n", exprforge.F0(${F0_ARG}), exprforge.F1(${F1_ARG}), exprforge.F2(${F2_ARG}))\n}\n`;
    fs.writeFileSync(path.join(dir, "main.go"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("go", ["build", "-o", bin, "."], { cwd: dir });
    const lines = execFileSync(bin, []).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F0_EXPECT, "f0");
    assertClose(parseFloat(lines[1]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[2]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: Go -- a file that uses no library function has no import", () => {
    const src = file([fn0], "go");
    assert.ok(!src.includes("import"));
});

// --- Zig -------------------------------------------------------------------

test("whole file: Zig -- std imported once at the top, file builds and runs", { skip: !TOOLS.zig && "zig not available" }, () => {
    const src = file([fn0, fn2, fn1], "zig");
    importedOnce(src, `const std = @import("std");`, "zig");
    assert.ok(src.indexOf("const std") < src.indexOf("pub fn f0("));
    const dir = tmpDir("ef-multi-zig-");
    fs.writeFileSync(path.join(dir, "fn.zig"), src);
    const mainSrc =
        `const std = @import("std");\n` +
        `const fnmod = @import("fn.zig");\n\n` +
        `pub fn main() !void {\n` +
        `    const stdout = std.io.getStdOut().writer();\n` +
        `    try stdout.print("{d}\\n{d}\\n{d}\\n", .{ fnmod.f0(${F0_ARG}.0), fnmod.f1(${F1_ARG}.0), fnmod.f2(${F2_ARG}) });\n` +
        `}\n`;
    fs.writeFileSync(path.join(dir, "main.zig"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("zig", ["build-exe", path.join(dir, "main.zig"), "-O", "ReleaseFast", `-femit-bin=${bin}`], { cwd: dir });
    const lines = execFileSync(bin, []).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F0_EXPECT, "f0");
    assertClose(parseFloat(lines[1]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[2]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- PHP ---------------------------------------------------------------

test("whole file: PHP -- one open tag, file runs", { skip: !TOOLS.php && "php not available" }, () => {
    const src = file([fn1, fn2], "php");
    importedOnce(src, "<?php", "php");
    const dir = tmpDir("ef-multi-php-");
    const fnsPath = path.join(dir, "fns.php");
    fs.writeFileSync(fnsPath, src);
    const mainSrc = `<?php\nrequire '${fnsPath}';\necho f1(${F1_ARG}) . "\\n";\necho f2(${F2_ARG}) . "\\n";\n`;
    const mainPath = path.join(dir, "main.php");
    fs.writeFileSync(mainPath, mainSrc);
    const lines = execFileSync("php", [mainPath]).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- Java --------------------------------------------------------------
//
// One public class holds every function as a static method. The file must
// be named after that class (Java's own rule): wrapperName picks it.

test("whole file: Java -- one class wrapping every function compiles and runs", { skip: !TOOLS.java && "java toolchain not available" }, () => {
    const src = file([fn1, fn2], "java", { wrapperName: "Fns" });
    importedOnce(src, "public final class Fns", "java");
    assert.strictEqual((src.match(/\bclass\b/g) || []).length, 1);
    const dir = tmpDir("ef-multi-java-");
    fs.writeFileSync(path.join(dir, "Fns.java"), src);
    const mainSrc =
        `public class Main {\n` +
        `    public static void main(String[] a) {\n` +
        `        System.out.println(Fns.f1(${F1_ARG}));\n` +
        `        System.out.println(Fns.f2(${F2_ARG}));\n` +
        `    }\n` +
        `}\n`;
    fs.writeFileSync(path.join(dir, "Main.java"), mainSrc);
    execFileSync("javac", [path.join(dir, "Fns.java"), path.join(dir, "Main.java")], { cwd: dir });
    const lines = execFileSync("java", ["-cp", dir, "Main"]).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: Java -- two suites in one class get distinct result types", { skip: !TOOLS.java && "java toolchain not available" }, () => {
    const { outputs } = require("../ast.js");
    const suiteA = { name: "sa", params: ["x"], body: outputs({ p: add(v("x"), num(1)), q: sub(v("x"), num(1)) }) };
    const suiteB = { name: "sb", params: ["x"], body: outputs({ p: add(v("x"), num(2)), q: sub(v("x"), num(2)) }) };
    const dir = tmpDir("ef-multi-java-suite-");
    fs.writeFileSync(path.join(dir, "Fns.java"), file([suiteA, suiteB], "java", { wrapperName: "Fns" }));
    fs.writeFileSync(
        path.join(dir, "Main.java"),
        `public class Main { public static void main(String[] a) {\n` +
        `  Fns.SaResult r = Fns.sa(10); Fns.SbResult s = Fns.sb(10);\n` +
        `  System.out.println(r.p + " " + r.q + " " + s.p + " " + s.q);\n` +
        `} }\n`,
    );
    execFileSync("javac", [path.join(dir, "Fns.java"), path.join(dir, "Main.java")], { cwd: dir });
    assert.strictEqual(execFileSync("java", ["-cp", dir, "Main"]).toString().trim(), "11.0 9.0 12.0 8.0");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- Targets with no file-level declaration of their own ---------------

test("whole file: C -- math.h included once, above every function", { skip: !TOOLS.c && "gcc not available" }, () => {
    const src = file([fn0, fn1, fn2], "c");
    importedOnce(src, "#include <math.h>", "c");
    assert.ok(src.indexOf("#include <math.h>") < src.indexOf("double f0("));
    const dir = tmpDir("ef-multi-c-");
    fs.writeFileSync(path.join(dir, "fns.c"), src);
    const mainSrc = `#include <stdio.h>\n#include "fns.c"\nint main() { printf("%.17f\\n%.17f\\n%.17f\\n", f0(${F0_ARG}), f1(${F1_ARG}), f2(${F2_ARG})); return 0; }\n`;
    fs.writeFileSync(path.join(dir, "main.c"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("gcc", ["-Werror=implicit-function-declaration", path.join(dir, "main.c"), "-o", bin, "-lm"]);
    const lines = execFileSync(bin, []).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F0_EXPECT, "f0");
    assertClose(parseFloat(lines[1]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[2]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: Rust -- 2 functions compile and run correctly", { skip: !TOOLS.rust && "rustc not available" }, () => {
    const dir = tmpDir("ef-multi-rust-");
    fs.writeFileSync(path.join(dir, "fns.rs"), file([fn1, fn2], "rust"));
    const mainSrc = `mod fns;\nfn main() { println!("{}\\n{}", fns::f1(${F1_ARG}.0), fns::f2(${F2_ARG})); }\n`;
    fs.writeFileSync(path.join(dir, "main.rs"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("rustc", [path.join(dir, "main.rs"), "-o", bin], { cwd: dir });
    const lines = execFileSync(bin, []).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: Python -- math imported once, above every function", { skip: !TOOLS.python && "python3 not available" }, () => {
    const src = file([fn0, fn1, fn2], "python");
    importedOnce(src, "import math", "python");
    assert.ok(src.indexOf("import math") < src.indexOf("def f0("));
    const dir = tmpDir("ef-multi-py-");
    fs.writeFileSync(path.join(dir, "fns.py"), src);
    const output = execFileSync("python3", ["-I", "-c", `import sys; sys.path.insert(0, "."); import fns; print(fns.f0(${F0_ARG})); print(fns.f1(${F1_ARG})); print(fns.f2(${F2_ARG}))`], { cwd: dir })
        .toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F0_EXPECT, "f0");
    assertClose(parseFloat(output[1]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[2]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: Perl -- POSIX and List::Util once each, one 1; terminator at the end", { skip: !TOOLS.perl && "perl not available" }, () => {
    const fnFloor = { name: "fl", params: ["x"], body: call("floor", v("x")) };
    const fnMin = { name: "mn", params: ["x"], body: call("min", v("x"), num(10)) };
    const fnFloor2 = { name: "fl2", params: ["x"], body: call("floor", v("x")) };
    const fnMin2 = { name: "mn2", params: ["x"], body: call("min", v("x"), num(10)) };
    const src = file([fn0, fnFloor, fnMin, fnFloor2, fnMin2], "perl");
    importedOnce(src, "use POSIX ();", "perl");
    importedOnce(src, "use List::Util ();", "perl");
    importedOnce(src, "\n1;\n", "perl");
    assert.ok(src.endsWith("\n1;\n"));
    const dir = tmpDir("ef-multi-perl-");
    const fnsPath = path.join(dir, "fns.pl");
    fs.writeFileSync(fnsPath, src);
    const output = execFileSync("perl", ["-w", "-e", `require "${fnsPath}"; print f0(${F0_ARG}), "\\n", fl(2.5), "\\n", mn(3), "\\n", fl2(7.5), "\\n", mn2(30), "\\n";`])
        .toString().trim().split("\n");
    assert.deepStrictEqual(output.map(Number), [3, 2, 3, 7, 10]);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: Perl -- sqrt and log together run", { skip: !TOOLS.perl && "perl not available" }, () => {
    const dir = tmpDir("ef-multi-perl-sl-");
    const fnsPath = path.join(dir, "fns.pl");
    fs.writeFileSync(fnsPath, file([fn1, fn2], "perl"));
    const output = execFileSync("perl", ["-e", `require "${fnsPath}"; print f1(${F1_ARG}), "\\n", f2(${F2_ARG}), "\\n";`])
        .toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: Ruby -- helpers defined once, 2 functions run", { skip: !TOOLS.ruby && "ruby not available" }, () => {
    const src = file([fn1, fn2], "ruby");
    assert.strictEqual((src.match(/^def _ef_sqrt\(/gm) || []).length, 1);
    assert.strictEqual((src.match(/^def _ef_log\(/gm) || []).length, 1);
    assert.ok(src.indexOf("def _ef_log(") < src.indexOf("def f1("), "helpers come before the functions");
    const dir = tmpDir("ef-multi-rb-");
    const fnsPath = path.join(dir, "fns.rb");
    fs.writeFileSync(fnsPath, src);
    const output = execFileSync("ruby", ["-e", `require "${fnsPath}"; puts f1(${F1_ARG}); puts f2(${F2_ARG})`])
        .toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: Lua -- 2 functions run", { skip: !TOOLS.lua && "lua not available" }, () => {
    const dir = tmpDir("ef-multi-lua-");
    const fnsPath = path.join(dir, "fns.lua");
    fs.writeFileSync(fnsPath, file([fn1, fn2], "lua"));
    const output = execFileSync(LUA_BIN, ["-e", `dofile("${fnsPath}"); print(f1(${F1_ARG})); print(f2(${F2_ARG}))`])
        .toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: Julia -- 2 functions run", { skip: !TOOLS.julia && "julia not available" }, () => {
    const dir = tmpDir("ef-multi-julia-");
    const fnsPath = path.join(dir, "fns.jl");
    fs.writeFileSync(fnsPath, file([fn1, fn2], "julia"));
    const output = execFileSync("julia", ["-e", `include("${fnsPath}"); println(f1(${F1_ARG})); println(f2(${F2_ARG}))`])
        .toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: R -- 2 functions run", { skip: !TOOLS.r && "Rscript not available" }, () => {
    const dir = tmpDir("ef-multi-r-");
    const fnsPath = path.join(dir, "fns.R");
    fs.writeFileSync(fnsPath, file([fn1, fn2], "r") + `\ncat(sprintf("%.17g", f1(${F1_ARG})), "\\n", sep = "")\ncat(sprintf("%.17g", f2(${F2_ARG})), "\\n", sep = "")\n`);
    const output = execFileSync("Rscript", [fnsPath]).toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: MATLAB/Octave -- script-file layout, helpers once, runs", { skip: !TOOLS.matlab && "octave-cli not available" }, () => {
    const src = file([fn1, fn2], "matlab");
    assert.ok(src.includes("\n1;\n"), "Octave script-file marker");
    assert.strictEqual((src.match(/function ef_r = ef_sqrt\(/g) || []).length, 1);
    assert.strictEqual((src.match(/function ef_r = ef_log\(/g) || []).length, 1);
    const dir = tmpDir("ef-multi-octave-");
    fs.writeFileSync(path.join(dir, "fns.m"), src);
    fs.writeFileSync(
        path.join(dir, "ef_driver.m"),
        `source("fns.m");\nprintf("%.17g\\n", f1(${F1_ARG}));\nprintf("%.17g\\n", f2(${F2_ARG}));\n`,
    );
    const output = execFileSync("octave-cli", ["--norc", "ef_driver.m"], { cwd: dir }).toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("single function: MATLAB/Octave -- carries only the helpers it uses", () => {
    const out1 = emitters.matlab.emitFunction(fn1);
    const out2 = emitters.matlab.emitFunction(fn2);
    assert.ok(out1.includes("function ef_r = ef_sqrt") && !out1.includes("ef_log"));
    assert.ok(out2.includes("function ef_r = ef_log(") && !out2.includes("ef_sqrt"));
    assert.ok(!out1.includes("\n1;\n"));
});

test("MATLAB/Octave -- one function per file, each self-contained (the MATLAB layout)", { skip: !TOOLS.matlab && "octave-cli not available" }, () => {
    const dir = tmpDir("ef-multi-octave-files-");
    fs.writeFileSync(path.join(dir, "f1.m"), file([fn1], "matlab"));
    fs.writeFileSync(path.join(dir, "f2.m"), file([fn2], "matlab"));
    fs.writeFileSync(
        path.join(dir, "ef_driver.m"),
        `printf("%.17g\\n", f1(${F1_ARG}));\nprintf("%.17g\\n", f2(${F2_ARG}));\n`,
    );
    const output = execFileSync("octave-cli", ["--norc", "ef_driver.m"], { cwd: dir }).toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: Scheme -- 2 functions run", { skip: !TOOLS.scheme && "guile not available" }, () => {
    const dir = tmpDir("ef-multi-scheme-");
    const fnsPath = path.join(dir, "fns.scm");
    fs.writeFileSync(
        fnsPath,
        `${file([fn1, fn2], "scheme")}\n(display (f1 ${F1_ARG}.0)) (newline) (display (f2 ${F2_ARG})) (newline)\n`,
    );
    const output = execFileSync(GUILE_BIN, [fnsPath]).toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: TypeScript -- 2 functions compile and run correctly", { skip: !TOOLS.ts && "tsc not available" }, () => {
    const dir = tmpDir("ef-multi-ts-");
    fs.writeFileSync(path.join(dir, "fns.ts"), file([fn1, fn2], "ts"));
    const mainSrc = `import { f1, f2 } from "./fns";\nconsole.log(f1(${F1_ARG}));\nconsole.log(f2(${F2_ARG}));\n`;
    fs.writeFileSync(path.join(dir, "main.ts"), mainSrc);
    const outDir = path.join(dir, "out");
    execFileSync("tsc", ["--outDir", outDir, "--module", "commonjs", "fns.ts", "main.ts"], { cwd: dir });
    const lines = execFileSync("node", [path.join(outDir, "main.js")]).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: Fortran -- one module holding every function compiles and runs", { skip: !TOOLS.fortran && "gfortran not available" }, () => {
    const src = file([fn1, fn2], "fortran");
    importedOnce(src, "\nmodule ExprForge\n", "fortran");
    const dir = tmpDir("ef-multi-fortran-");
    fs.writeFileSync(path.join(dir, "fns.f90"), src);
    const mainSrc =
        `program main\n` +
        `  use ExprForge\n` +
        `  implicit none\n` +
        `  print *, f1(${F1_ARG}.0d0)\n` +
        `  print *, f2(${F2_ARG}d0)\n` +
        `end program main\n`;
    fs.writeFileSync(path.join(dir, "main.f90"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("gfortran", ["fns.f90", "main.f90", "-o", bin], { cwd: dir });
    const lines = execFileSync(bin, []).toString().trim().split(/\s+/).filter(Boolean);
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("whole file: C# -- one static class holding every function compiles and runs", { skip: !TOOLS.csharp && "dotnet not available" }, () => {
    const src = file([fn1, fn2], "csharp");
    importedOnce(src, "public static class ExprForge", "csharp");
    const dir = tmpDir("ef-multi-cs-");
    // TargetFramework from test/dotnet-tfm.js (highest installed SDK, or
    // EXPRFORGE_DOTNET_TFM). Fns.cs deliberately has NO using directive:
    // the emitted class must stand alone.
    fs.writeFileSync(
        path.join(dir, "csproj.csproj"),
        `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>${DOTNET_TFM}</TargetFramework><ImplicitUsings>disable</ImplicitUsings></PropertyGroup></Project>\n`,
    );
    fs.writeFileSync(path.join(dir, "Fns.cs"), src);
    fs.writeFileSync(
        path.join(dir, "Program.cs"),
        `using System;\nclass Program { static void Main() {\n` +
        `  Console.WriteLine(ExprForge.f1(${F1_ARG}));\n` +
        `  Console.WriteLine(ExprForge.f2(${F2_ARG}));\n` +
        `} }\n`,
    );
    const outDir = path.join(dir, "out");
    execFileSync("dotnet", ["build", "-c", "Release", "-o", outDir], { cwd: dir });
    // Run via "dotnet <dll>" (the host muxer), NOT the native apphost
    // binary directly -- same convention as test/conformance.test.js's
    // own runCSharp.
    const lines = execFileSync("dotnet", [path.join(outDir, "csproj.dll")]).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- Static layout checks (no toolchain needed) --------------------------

test("whole file: expr -- a file is the concatenation of fn definitions and round-trips", () => {
    const { loadExprSource } = require("../load-expr.js");
    const src = file([fn1, fn2], "expr");
    const loaded = loadExprSource(src);
    assert.deepStrictEqual(Object.keys(loaded).sort(), ["f1", "f2"]);
});

test("whole file: LaTeX -- document wrap yields one document with one block per function", () => {
    const src = file([fn1, fn2], "latex", { wrap: "document" });
    assert.strictEqual(src.split("\\documentclass").length - 1, 1);
    assert.strictEqual(src.split("\\begin{document}").length - 1, 1);
    assert.strictEqual(src.split("\\[").length - 1, 2);
    assert.strictEqual(src.split("\\]").length - 1, 2);
    const plain = file([fn1, fn2], "latex");
    assert.strictEqual(plain.split("\n").filter(Boolean).length, 2);
});

test("emitFile -- rejects an empty list, duplicate names and the removed options", () => {
    assert.throws(() => emitFile([], "python"), /non-empty array/);
    assert.throws(() => emitFile([fn1, fn1], "python"), /duplicate function name "f1"/);
    assert.throws(() => emitFile([fn1], "nope"), /no emitter registered/);
    for (const removed of ["includeHelpers", "emittedHelpers", "forceMathImport", "publicClass"]) {
        assert.throws(() => emitFile([fn1], "python", undefined, { [removed]: true }), new RegExp(`opts\\.${removed} was removed in 0\\.10\\.0`));
        assert.throws(() => emitters.python.emitFunction(fn1, undefined, { [removed]: true }), /removed in 0\.10\.0/);
    }
});

test("every toolchain-backed executable target has a whole-file test above", () => {
    for (const [lang, emitter] of Object.entries(emitters)) {
        const probes = emitter.meta.toolchain && emitter.meta.toolchain.probes;
        if (!probes) continue;
        assert.ok(queried.has(lang), `${lang}: no whole-file test consults TOOLS.${lang}`);
    }
});
