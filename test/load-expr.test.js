// exprforge/test/load-expr.test.js
//
// loadExpr(path) -- see load-expr.js's own header comment. Writes
// throwaway .expr fixtures into a fresh temp dir per test file run (same
// "actually exercise the real file-loading path" discipline
// test/package.test.js uses, not just testing the parser in isolation).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { evaluate, emit, loadExpr } = require("../index.js");
// Registers exprforge/math's macros (dot3/len3/cross3/normalize3/
// safeDiv) globally -- exercised below to confirm a .expr file can
// reference them too, not just earlier definitions in the same file.
require("../math/index.js");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exprforge-load-expr-"));

function writeExpr(name, contents) {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, contents);
    return filePath;
}

test("loadExpr parses a single definition, usable directly with evaluate()", () => {
    const filePath = writeExpr("single.expr", `
        hyp(a, b):
        return sqrt(a^2 + b^2);
    `);
    const defs = loadExpr(filePath);
    assert.deepStrictEqual(Object.keys(defs), ["hyp"]);
    assert.strictEqual(evaluate(defs.hyp, [3, 4]), 5);
});

test("loadExpr parses zero definitions (empty file) as an empty object", () => {
    const filePath = writeExpr("empty.expr", "");
    assert.deepStrictEqual(loadExpr(filePath), {});
});

test("an earlier definition in the file is available to a later one as an inline macro", () => {
    const filePath = writeExpr("cross.expr", `
        cross3(ax, ay, az, bx, by, bz):
          let rx = ay * bz - az * by;
          let ry = az * bx - ax * bz;
          let rz = ax * by - ay * bx;
          return { rx, ry, rz };

        crossLength(ax, ay, az, bx, by, bz):
          let c = cross3(ax, ay, az, bx, by, bz);
          return sqrt(c.rx^2 + c.ry^2 + c.rz^2);
    `);
    const defs = loadExpr(filePath);
    assert.deepStrictEqual(Object.keys(defs), ["cross3", "crossLength"]);
    // (1,0,0) x (0,1,0) = (0,0,1), length 1.
    assert.strictEqual(evaluate(defs.crossLength, [1, 0, 0, 0, 1, 0]), 1);
    // cross3 itself still works standalone too.
    assert.deepStrictEqual(evaluate(defs.cross3, [1, 0, 0, 0, 1, 0]), { rx: 0, ry: 0, rz: 1 });
});

test("crossLength's own body has no leftover reference to cross3 -- fully inlined, not a real call", () => {
    const filePath = writeExpr("cross2.expr", `
        cross3(ax, ay, az, bx, by, bz):
          let rx = ay * bz - az * by;
          let ry = az * bx - ax * bz;
          let rz = ax * by - ay * bx;
          return { rx, ry, rz };

        crossLength(ax, ay, az, bx, by, bz):
          let c = cross3(ax, ay, az, bx, by, bz);
          return sqrt(c.rx^2 + c.ry^2 + c.rz^2);
    `);
    const defs = loadExpr(filePath);
    const source = emit(defs.crossLength, "js").source;
    assert.doesNotMatch(source, /cross3/);
});

test("a .expr file can reference a globally loaded macro (exprforge/math), not just earlier local definitions", () => {
    const filePath = writeExpr("normalize.expr", `
        normalizedX(x, y, z):
        let n = normalize3(x, y, z);
        return n.x;
    `);
    const defs = loadExpr(filePath);
    assert.strictEqual(evaluate(defs.normalizedX, [3, 0, 0]), 1);
});

test("a definition with no \"name(params):\" signature line throws", () => {
    const filePath = writeExpr("nosig.expr", "return 1 + 2;");
    assert.throws(() => loadExpr(filePath), /every definition needs a "name\(params\):" signature line/);
});

test("two definitions sharing a name in one file throws", () => {
    const filePath = writeExpr("dupe.expr", `
        f(x): return x;
        f(x): return x * 2;
    `);
    assert.throws(() => loadExpr(filePath), /duplicate function name "f"/);
});

test("a later definition can't reference an EARLIER one's own not-yet-defined self, or anything defined after it", () => {
    const filePath = writeExpr("forward.expr", `
        f(x): return g(x);
        g(x): return x * 2;
    `);
    // "g" isn't registered yet when f's body is expanded -- f's call to
    // g survives as a plain unmapped call node.
    const defs = loadExpr(filePath);
    assert.throws(() => evaluate(defs.f, [1]), /no mapping for Math function "g"/);
});

test("loading a nonexistent file throws (Node's own fs error, not swallowed)", () => {
    assert.throws(() => loadExpr(path.join(tmpDir, "does-not-exist.expr")), /ENOENT/);
});
