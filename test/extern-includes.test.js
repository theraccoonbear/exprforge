// An extern's per-target template is free-form code that can call any
// library function, so import selection for a target cannot rely on a fixed
// name pattern to know the template needs its library. The C emitter marks
// extern use while emitting (see `onExtern` in emitters/base.js) and always
// includes <math.h> then. These tests use j0(), a libm function absent from
// the C emitter's own math.h name list, and compile with the real compiler
// with implicit declarations as errors.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { tmpDir } = require("./harness-util.js");
const { v, num, call, add, outputs } = require("../ast.js");
const { createSession } = require("../index.js");
const emitters = require("../emitters/registry.js");

function hasGcc() {
    try {
        execFileSync("gcc", ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}
const skip = !hasGcc() && "gcc not available";

function session() {
    const s = createSession();
    s.loadExtern("bessel0", { evaluate: (x) => x, c: ([x]) => `j0(${x})` });
    return s;
}

function build(dir, src, mainBody) {
    fs.writeFileSync(path.join(dir, "fns.c"), src);
    fs.writeFileSync(path.join(dir, "main.c"), `#include <stdio.h>\n#include "fns.c"\nint main() { ${mainBody} return 0; }\n`);
    const bin = path.join(dir, "bin");
    execFileSync("gcc", ["-Werror=implicit-function-declaration", path.join(dir, "main.c"), "-o", bin, "-lm"]);
    return execFileSync(bin, []).toString().trim();
}

test("C extern calling j0 includes <math.h>, compiles and runs", { skip }, () => {
    const s = session();
    const fn = { name: "f", params: ["x"], body: add(call("bessel0", v("x")), num(1)) };
    const src = s.emit(fn, "c").source;
    assert.ok(src.includes("#include <math.h>"), src);
    const dir = tmpDir("ef-extern-c-");
    const out = build(dir, src, `printf("%.12f\\n", f(0.0));`);
    assert.strictEqual(parseFloat(out), 2);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("C: extern use includes <math.h>; no extern and no math name, no include", () => {
    const s = session();
    const withExtern = s.emit({ name: "f", params: ["x"], body: call("bessel0", v("x")) }, "c").source;
    assert.ok(withExtern.includes("#include <math.h>"));
    const without = emitters.c.emitFunction({ name: "g", params: ["x"], body: add(v("x"), num(1)) });
    assert.ok(!without.includes("#include <math.h>"));
});

test("C multi-function file: extern in a later function brings <math.h> once", { skip }, () => {
    const s = session();
    const plain = { name: "p", params: ["x"], body: add(v("x"), num(1)) };
    const ext = { name: "q", params: ["x"], body: call("bessel0", v("x")) };
    const ext2 = { name: "r", params: ["x"], body: add(call("bessel0", v("x")), num(2)) };
    const emittedHelpers = new Set();
    const src = [plain, ext, ext2].map((f) => s.emit(f, "c", { emittedHelpers }).source).join("\n");
    assert.strictEqual(src.split("#include <math.h>").length - 1, 1);
    assert.ok(src.indexOf("#include <math.h>") > src.indexOf("double p("));
    const dir = tmpDir("ef-extern-c-multi-");
    const out = build(dir, src, `printf("%.12f %.12f %.12f\\n", p(1.0), q(0.0), r(0.0));`);
    assert.deepStrictEqual(out.split(" ").map(Number), [2, 1, 3]);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("C suite: extern in an output brings <math.h>", { skip }, () => {
    const s = session();
    const fn = { name: "st", params: ["x"], body: outputs({ a: call("bessel0", v("x")), b: add(v("x"), num(1)) }) };
    const src = s.emit(fn, "c").source;
    assert.ok(src.includes("#include <math.h>"), src);
    const dir = tmpDir("ef-extern-c-suite-");
    const out = build(dir, src, `StResult r = st(0.0); printf("%.12f %.12f\\n", r.a, r.b);`);
    assert.deepStrictEqual(out.split(" ").map(Number), [1, 1]);
    fs.rmSync(dir, { recursive: true, force: true });
});
