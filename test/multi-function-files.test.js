// exprforge/test/multi-function-files.test.js
//
// Real, reported consumer bug (github.com/theraccoonbear/exprforge/pull/37):
// SAFE_MATH_HELPERS was unconditionally prepended to every QB64
// formatFunction/formatSuite call, so concatenating N functions into one
// compiled unit (a real, common pattern -- one .bi file per PROGRAM, not
// one file per function; the reporting consumer's own emit-spline.js does
// this for 21 functions) duplicated its 5 FUNCTION definitions N times,
// which QB64 rejects as a duplicate definition at compile time.
//
// Nothing in this repo's test suite covered that shape before this file --
// every conformance sample/harness compiles exactly one function per
// binary. Auditing every OTHER target the same way (not just the one
// reported) found the identical bug class in COBOL (never reported --
// found here first), Go, Zig, Java, and PHP -- each has its own real,
// confirmed-against-a-real-compiler failure when concatenated, and each
// has its own real fix (see the doc comment on emitFunction's own
// `opts.includeHelpers` in emitters/base.js, and each affected emitter's
// own comment on its specific fix). C, Rust, Python, Perl, Lua, Julia,
// Scheme, TypeScript, Fortran, and C# were all confirmed ALREADY correct
// (no shared file-level declaration repeated per function) -- verified
// here too, not just assumed, so a future change that accidentally
// introduces one gets caught the same way the original bug should have
// been.
//
// See docs/multi-function-files.md for the full per-target breakdown and
// exactly what each fix does.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { v, call } = require("../ast.js");
const emitters = require("../emitters/registry.js");

function hasTool(cmd, args) {
    try {
        execFileSync(cmd, args, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

function resolveTool(candidates, args) {
    for (const cmd of candidates) {
        if (hasTool(cmd, args)) return cmd;
    }
    return null;
}

const GUILE_BIN = resolveTool(["guile3.0", "guile-3.0", "guile"], ["--version"]);
const LUA_BIN = resolveTool(["lua5.4", "lua"], ["-v"]);

const TOOLS = {
    gcc: hasTool("gcc", ["--version"]),
    go: hasTool("go", ["version"]),
    rustc: hasTool("rustc", ["--version"]),
    java: hasTool("javac", ["-version"]) && hasTool("java", ["-version"]),
    tsc: hasTool("tsc", ["--version"]),
    qb64: hasTool("qb64pe", ["-v"]),
    dotnet: hasTool("dotnet", ["--version"]),
    python: hasTool("python3", ["--version"]),
    lua: LUA_BIN !== null,
    perl: hasTool("perl", ["-v"]),
    php: hasTool("php", ["--version"]),
    julia: hasTool("julia", ["--version"]),
    gfortran: hasTool("gfortran", ["--version"]),
    zig: hasTool("zig", ["version"]),
    guile: GUILE_BIN !== null,
    cobc: hasTool("cobc", ["--version"]),
};

function tmpDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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

// --- QB64 --------------------------------------------------------------

test("multi-function file: QB64 -- concatenating 2 functions compiles and runs correctly", { skip: !TOOLS.qb64 && "qb64pe not available" }, () => {
    const out1 = emitters.qb64.emitFunction(fn1, undefined, { includeHelpers: true });
    const out2 = emitters.qb64.emitFunction(fn2, undefined, { includeHelpers: false });
    const dir = tmpDir("ef-multi-qb64-");
    const harness = `$CONSOLE:ONLY\n${out1}\n${out2}\nPRINT f1#(${F1_ARG}#)\nPRINT f2#(${F2_ARG}#)\nSYSTEM\n`;
    const srcPath = path.join(dir, "main.bas");
    fs.writeFileSync(srcPath, harness);
    const bin = path.join(dir, "bin");
    execFileSync("qb64pe", ["-x", srcPath, "-o", bin]);
    const lines = execFileSync(bin, [], { input: "" }).toString().trim().split("\n");
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

test("multi-function file: COBOL -- concatenating 2 programs compiles and runs correctly", { skip: !TOOLS.cobc && "cobc not available" }, () => {
    const out1 = emitters.cobol.emitFunction(fn1, undefined, { includeHelpers: true });
    const out2 = emitters.cobol.emitFunction(fn2, undefined, { includeHelpers: false });
    const dir = tmpDir("ef-multi-cobol-");
    const fnsPath = path.join(dir, "fns.cob");
    fs.writeFileSync(fnsPath, out1 + "\n" + out2);
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
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- Go --------------------------------------------------------------------
//
// Go's per-package-per-directory model means the NATURAL multi-function
// pattern is actually separate .go files sharing one package directory
// (each keeping its own required "package exprforge" line -- not a bug,
// just how Go works) -- but this specifically tests the CONCATENATE-INTO-
// ONE-FILE pattern the consumer's report was about, since that's also a
// real, supported (opts.includeHelpers) use case, exercised through a
// real separate "package main" importing it, the idiomatic way to build
// a runnable Go program against a library package.

test("multi-function file: Go -- concatenating 2 functions into one file compiles and runs correctly", { skip: !TOOLS.go && "go not available" }, () => {
    const out1 = emitters.go.emitFunction(fn1, undefined, { includeHelpers: true });
    const out2 = emitters.go.emitFunction(fn2, undefined, { includeHelpers: false, forceMathImport: true });
    const dir = tmpDir("ef-multi-go-");
    fs.writeFileSync(path.join(dir, "go.mod"), "module goef\n\ngo 1.21\n");
    fs.mkdirSync(path.join(dir, "exprforge"));
    fs.writeFileSync(path.join(dir, "exprforge", "fns.go"), out1 + "\n" + out2);
    const mainSrc =
        `package main\n\n` +
        `import (\n\t"fmt"\n\t"goef/exprforge"\n)\n\n` +
        `func main() {\n\tfmt.Printf("%.17f\\n%.17f\\n", exprforge.F1(${F1_ARG}), exprforge.F2(${F2_ARG}))\n}\n`;
    fs.writeFileSync(path.join(dir, "main.go"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("go", ["build", "-o", bin, "."], { cwd: dir });
    const lines = execFileSync(bin, []).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- Zig -------------------------------------------------------------------

test("multi-function file: Zig -- concatenating 2 functions into one file compiles and runs correctly", { skip: !TOOLS.zig && "zig not available" }, () => {
    const out1 = emitters.zig.emitFunction(fn1, undefined, { includeHelpers: true });
    const out2 = emitters.zig.emitFunction(fn2, undefined, { includeHelpers: false });
    const dir = tmpDir("ef-multi-zig-");
    fs.writeFileSync(path.join(dir, "fn.zig"), out1 + "\n" + out2);
    const mainSrc =
        `const std = @import("std");\n` +
        `const fnmod = @import("fn.zig");\n\n` +
        `pub fn main() !void {\n` +
        `    const stdout = std.io.getStdOut().writer();\n` +
        `    try stdout.print("{d}\\n{d}\\n", .{ fnmod.f1(${F1_ARG}.0), fnmod.f2(${F2_ARG}) });\n` +
        `}\n`;
    fs.writeFileSync(path.join(dir, "main.zig"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("zig", ["build-exe", path.join(dir, "main.zig"), "-O", "ReleaseFast", `-femit-bin=${bin}`], { cwd: dir });
    const lines = execFileSync(bin, []).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- PHP ---------------------------------------------------------------

test("multi-function file: PHP -- concatenating 2 functions compiles and runs correctly", { skip: !TOOLS.php && "php not available" }, () => {
    const out1 = emitters.php.emitFunction(fn1, undefined, { includeHelpers: true });
    const out2 = emitters.php.emitFunction(fn2, undefined, { includeHelpers: false });
    const dir = tmpDir("ef-multi-php-");
    const fnsPath = path.join(dir, "fns.php");
    fs.writeFileSync(fnsPath, out1 + "\n" + out2);
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
// Java allows at most one PUBLIC top-level type per file. opts.publicClass:
// false drops the modifier so the second (and any later) class can share
// the file -- confirmed a package-private class is still fully callable
// from another class in the same file/package, which is exactly the
// situation here.

test("multi-function file: Java -- concatenating 2 classes into one file compiles and runs correctly", { skip: !TOOLS.java && "java toolchain not available" }, () => {
    const out1 = emitters.java.emitFunction(fn1, undefined, { publicClass: true });
    const out2 = emitters.java.emitFunction(fn2, undefined, { publicClass: false });
    const dir = tmpDir("ef-multi-java-");
    // The file must be named after its own public class (F1) -- Java's
    // own rule, not a choice made here.
    fs.writeFileSync(path.join(dir, "F1.java"), out1 + "\n" + out2);
    const mainSrc =
        `public class Main {\n` +
        `    public static void main(String[] a) {\n` +
        `        System.out.println(F1.f1(${F1_ARG}));\n` +
        `        System.out.println(F2.f2(${F2_ARG}));\n` +
        `    }\n` +
        `}\n`;
    fs.writeFileSync(path.join(dir, "Main.java"), mainSrc);
    execFileSync("javac", [path.join(dir, "F1.java"), path.join(dir, "Main.java")], { cwd: dir });
    const lines = execFileSync("java", ["-cp", dir, "Main"]).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- Already-correct targets: confirmed, not just assumed -------------
//
// None of these have any file-level declaration repeated per function
// (no shared import/package/open-tag/class-with-fixed-name) -- verified
// directly rather than trusted from reading the emitter source, so a
// future change that accidentally introduces one gets caught here too.

test("multi-function file: C -- concatenating 2 functions compiles and runs correctly", { skip: !TOOLS.gcc && "gcc not available" }, () => {
    const out1 = emitters.c.emitFunction(fn1);
    const out2 = emitters.c.emitFunction(fn2);
    const dir = tmpDir("ef-multi-c-");
    fs.writeFileSync(path.join(dir, "fns.c"), out1 + "\n" + out2);
    const mainSrc = `#include <stdio.h>\n#include "fns.c"\nint main() { printf("%.17f\\n%.17f\\n", f1(${F1_ARG}), f2(${F2_ARG})); return 0; }\n`;
    fs.writeFileSync(path.join(dir, "main.c"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("gcc", [path.join(dir, "main.c"), "-o", bin, "-lm"]);
    const lines = execFileSync(bin, []).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("multi-function file: Rust -- concatenating 2 functions compiles and runs correctly", { skip: !TOOLS.rustc && "rustc not available" }, () => {
    const out1 = emitters.rust.emitFunction(fn1);
    const out2 = emitters.rust.emitFunction(fn2);
    const dir = tmpDir("ef-multi-rust-");
    fs.writeFileSync(path.join(dir, "fns.rs"), out1 + "\n" + out2);
    const mainSrc = `mod fns;\nfn main() { println!("{}\\n{}", fns::f1(${F1_ARG}.0), fns::f2(${F2_ARG})); }\n`;
    fs.writeFileSync(path.join(dir, "main.rs"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("rustc", [path.join(dir, "main.rs"), "-o", bin], { cwd: dir });
    const lines = execFileSync(bin, []).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("multi-function file: Python -- concatenating 2 functions runs correctly", { skip: !TOOLS.python && "python3 not available" }, () => {
    const out1 = emitters.python.emitFunction(fn1);
    const out2 = emitters.python.emitFunction(fn2);
    const dir = tmpDir("ef-multi-py-");
    fs.writeFileSync(path.join(dir, "fns.py"), out1 + "\n" + out2);
    const output = execFileSync("python3", ["-c", `import fns; print(fns.f1(${F1_ARG})); print(fns.f2(${F2_ARG}))`], { cwd: dir })
        .toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("multi-function file: Perl -- concatenating 2 functions runs correctly", { skip: !TOOLS.perl && "perl not available" }, () => {
    const out1 = emitters.perl.emitFunction(fn1);
    const out2 = emitters.perl.emitFunction(fn2);
    const dir = tmpDir("ef-multi-perl-");
    const fnsPath = path.join(dir, "fns.pl");
    fs.writeFileSync(fnsPath, out1 + "\n" + out2);
    const output = execFileSync("perl", ["-e", `require "${fnsPath}"; print f1(${F1_ARG}), "\\n", f2(${F2_ARG}), "\\n";`])
        .toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("multi-function file: Lua -- concatenating 2 functions runs correctly", { skip: !TOOLS.lua && "lua not available" }, () => {
    const out1 = emitters.lua.emitFunction(fn1);
    const out2 = emitters.lua.emitFunction(fn2);
    const dir = tmpDir("ef-multi-lua-");
    const fnsPath = path.join(dir, "fns.lua");
    fs.writeFileSync(fnsPath, out1 + "\n" + out2);
    const output = execFileSync(LUA_BIN, ["-e", `dofile("${fnsPath}"); print(f1(${F1_ARG})); print(f2(${F2_ARG}))`])
        .toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("multi-function file: Julia -- concatenating 2 functions runs correctly", { skip: !TOOLS.julia && "julia not available" }, () => {
    const out1 = emitters.julia.emitFunction(fn1);
    const out2 = emitters.julia.emitFunction(fn2);
    const dir = tmpDir("ef-multi-julia-");
    const fnsPath = path.join(dir, "fns.jl");
    fs.writeFileSync(fnsPath, out1 + "\n" + out2);
    const output = execFileSync("julia", ["-e", `include("${fnsPath}"); println(f1(${F1_ARG})); println(f2(${F2_ARG}))`])
        .toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("multi-function file: Scheme -- concatenating 2 functions runs correctly", { skip: !TOOLS.guile && "guile not available" }, () => {
    const out1 = emitters.scheme.emitFunction(fn1);
    const out2 = emitters.scheme.emitFunction(fn2);
    const dir = tmpDir("ef-multi-scheme-");
    const fnsPath = path.join(dir, "fns.scm");
    fs.writeFileSync(
        fnsPath,
        `${out1}\n${out2}\n(display (f1 ${F1_ARG}.0)) (newline) (display (f2 ${F2_ARG})) (newline)\n`,
    );
    const output = execFileSync(GUILE_BIN, [fnsPath]).toString().trim().split("\n");
    assertClose(parseFloat(output[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(output[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("multi-function file: TypeScript -- concatenating 2 functions compiles and runs correctly", { skip: !TOOLS.tsc && "tsc not available" }, () => {
    const out1 = emitters.ts.emitFunction(fn1);
    const out2 = emitters.ts.emitFunction(fn2);
    const dir = tmpDir("ef-multi-ts-");
    fs.writeFileSync(path.join(dir, "fns.ts"), out1 + "\n" + out2);
    const mainSrc = `import { f1, f2 } from "./fns";\nconsole.log(f1(${F1_ARG}));\nconsole.log(f2(${F2_ARG}));\n`;
    fs.writeFileSync(path.join(dir, "main.ts"), mainSrc);
    const outDir = path.join(dir, "out");
    execFileSync("tsc", ["--outDir", outDir, "--module", "commonjs", "fns.ts", "main.ts"], { cwd: dir });
    const lines = execFileSync("node", [path.join(outDir, "main.js")]).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("multi-function file: Fortran -- concatenating 2 functions compiles and runs correctly", { skip: !TOOLS.gfortran && "gfortran not available" }, () => {
    const out1 = emitters.fortran.emitFunction(fn1);
    const out2 = emitters.fortran.emitFunction(fn2);
    const dir = tmpDir("ef-multi-fortran-");
    fs.writeFileSync(path.join(dir, "fns.f90"), out1 + "\n" + out2);
    const mainSrc =
        `program main\n` +
        `  real(8) :: f1, f2\n` +
        `  print *, f1(${F1_ARG}.0d0)\n` +
        `  print *, f2(${F2_ARG}d0)\n` +
        `end program main\n`;
    fs.writeFileSync(path.join(dir, "main.f90"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("gfortran", [path.join(dir, "main.f90"), path.join(dir, "fns.f90"), "-o", bin]);
    const lines = execFileSync(bin, []).toString().trim().split(/\s+/).filter(Boolean);
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("multi-function file: C# -- concatenating 2 classes into one file compiles and runs correctly", { skip: !TOOLS.dotnet && "dotnet not available" }, () => {
    const out1 = emitters.csharp.emitFunction(fn1);
    const out2 = emitters.csharp.emitFunction(fn2);
    const dir = tmpDir("ef-multi-cs-");
    // net9.0 -- matches test/conformance.test.js's own CSPROJ constant;
    // a net8.0 target failed to LAUNCH (not compile) in a real container
    // whose only installed runtime is 9.0.16 ("You must install or
    // update .NET") -- a real environment-matching issue, not something
    // to chase per-environment, so this just mirrors the value already
    // confirmed to work in every environment this project's CI runs in.
    fs.writeFileSync(
        path.join(dir, "csproj.csproj"),
        `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>\n`,
    );
    fs.writeFileSync(path.join(dir, "Fns.cs"), `using System;\n${out1}\n${out2}\n`);
    fs.writeFileSync(
        path.join(dir, "Program.cs"),
        `using System;\nclass Program { static void Main() {\n` +
        `  Console.WriteLine(F1Impl.f1(${F1_ARG}));\n` +
        `  Console.WriteLine(F2Impl.f2(${F2_ARG}));\n` +
        `} }\n`,
    );
    const outDir = path.join(dir, "out");
    execFileSync("dotnet", ["build", "-c", "Release", "-o", outDir], { cwd: dir });
    // Run via "dotnet <dll>" (the host muxer), NOT the native apphost
    // binary directly -- same convention as test/conformance.test.js's
    // own runCSharp: the apphost enforces an exact framework-version
    // match, which fails in an environment with a newer runtime only
    // installed (a real container-config quirk, unrelated to this
    // test), while the muxer resolves normally.
    const lines = execFileSync("dotnet", [path.join(outDir, "csproj.dll")]).toString().trim().split("\n");
    assertClose(parseFloat(lines[0]), F1_EXPECT, "f1");
    assertClose(parseFloat(lines[1]), F2_EXPECT, "f2");
    fs.rmSync(dir, { recursive: true, force: true });
});
