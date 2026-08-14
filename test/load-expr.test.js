// exprforge/test/load-expr.test.js
//
// loadExpr(path)/loadExprSource(text) -- see load-expr.js's own header
// comment. Writes throwaway .expr fixtures into a fresh temp dir per
// test file run (same "actually exercise the real file-loading path"
// discipline test/package.test.js uses, not just testing the parser in
// isolation) for loadExpr() specifically; loadExprSource() is exercised
// directly against strings, since its whole point is not needing a file.
//
// Every fixture below uses fn.js's requireExportKeyword grammar --
// "fn name(...):" or "macro name(...):", never a bare "name(...):" --
// see load-expr.js's/fn.js's own header comments for the full rationale
// (every definition states, explicitly, whether it's meant to come back
// out of this call or only be inlined into something else in the same
// source; there's no default to get wrong).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { evaluate, emit, loadExpr, loadExprSource } = require("../index.js");
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

test("loadExpr parses a single \"fn\" definition, usable directly with evaluate()", () => {
    const filePath = writeExpr("single.expr", `
        fn hyp(a, b):
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

test("an earlier definition in the file is available to a later one as an inline macro, regardless of fn/macro", () => {
    const filePath = writeExpr("cross.expr", `
        fn cross3(ax, ay, az, bx, by, bz):
          let rx = ay * bz - az * by;
          let ry = az * bx - ax * bz;
          let rz = ax * by - ay * bx;
          return { rx, ry, rz };

        fn crossLength(ax, ay, az, bx, by, bz):
          let c = cross3(ax, ay, az, bx, by, bz);
          return sqrt(c.rx^2 + c.ry^2 + c.rz^2);
    `);
    const defs = loadExpr(filePath);
    // Both marked "fn" here -- both come back, both independently usable.
    assert.deepStrictEqual(Object.keys(defs), ["cross3", "crossLength"]);
    // (1,0,0) x (0,1,0) = (0,0,1), length 1.
    assert.strictEqual(evaluate(defs.crossLength, [1, 0, 0, 0, 1, 0]), 1);
    assert.deepStrictEqual(evaluate(defs.cross3, [1, 0, 0, 0, 1, 0]), { rx: 0, ry: 0, rz: 1 });
});

test("crossLength's own body has no leftover reference to cross3 -- fully inlined, not a real call", () => {
    const filePath = writeExpr("cross2.expr", `
        macro cross3(ax, ay, az, bx, by, bz):
          let rx = ay * bz - az * by;
          let ry = az * bx - ax * bz;
          let rz = ax * by - ay * bx;
          return { rx, ry, rz };

        fn crossLength(ax, ay, az, bx, by, bz):
          let c = cross3(ax, ay, az, bx, by, bz);
          return sqrt(c.rx^2 + c.ry^2 + c.rz^2);
    `);
    const defs = loadExpr(filePath);
    const source = emit(defs.crossLength, "js").source;
    assert.doesNotMatch(source, /cross3/);
});

test("a .expr file can reference a globally loaded macro (exprforge/math), not just earlier local definitions", () => {
    const filePath = writeExpr("normalize.expr", `
        fn normalizedX(x, y, z):
        let n = normalize3(x, y, z);
        return n.x;
    `);
    const defs = loadExpr(filePath);
    assert.strictEqual(evaluate(defs.normalizedX, [3, 0, 0]), 1);
});

test("a bare \"name(params):\" signature with no \"fn\"/\"macro\" keyword throws", () => {
    const filePath = writeExpr("bare.expr", `
        hyp(a, b):
        return sqrt(a^2 + b^2);
    `);
    assert.throws(() => loadExpr(filePath), /every definition needs to start with "fn".*or "macro"/);
});

test("a definition with no signature line at all throws the same \"fn\"/\"macro\" error -- there's no separate case for that anymore", () => {
    const filePath = writeExpr("nosig.expr", "return 1 + 2;");
    assert.throws(() => loadExpr(filePath), /every definition needs to start with "fn".*or "macro"/);
});

test("two definitions sharing a name in one file throws, even split across fn and macro", () => {
    const filePath = writeExpr("dupe.expr", `
        macro f(x): return x;
        fn f(x): return x * 2;
    `);
    assert.throws(() => loadExpr(filePath), /duplicate function name "f"/);
});

test("a later definition can't reference an EARLIER one's own not-yet-defined self, or anything defined after it", () => {
    const filePath = writeExpr("forward.expr", `
        fn f(x): return g(x);
        fn g(x): return x * 2;
    `);
    // "g" isn't registered yet when f's body is expanded -- f's call to
    // g survives as a plain unmapped call node.
    const defs = loadExpr(filePath);
    assert.throws(() => evaluate(defs.f, [1]), /no mapping for Math function "g"/);
});

test("loading a nonexistent file throws (Node's own fs error, not swallowed)", () => {
    assert.throws(() => loadExpr(path.join(tmpDir, "does-not-exist.expr")), /ENOENT/);
});

// --- "fn" vs "macro": what actually ends up in the returned object ------

test("a \"macro\"-marked definition is registered for inlining but never appears in the returned object", () => {
    const defs = loadExprSource(`
        macro helper(x): return x * 2;
        fn f(x): return helper(x) + 1;
    `);
    assert.deepStrictEqual(Object.keys(defs), ["f"]);
    assert.strictEqual(evaluate(defs.f, [5]), 11);
    // "helper" was inlined into f -- no trace of a real call to it left,
    // same guarantee crossLength/cross3 demonstrate above.
    assert.doesNotMatch(emit(defs.f, "js").source, /helper/);
});

test("several \"macro\"-marked helpers behind one \"fn\" result: only the fn shows up", () => {
    const defs = loadExprSource(`
        macro double(x): return x * 2;
        macro triple(x): return x * 3;
        fn combo(x): return double(x) + triple(x);
    `);
    assert.deepStrictEqual(Object.keys(defs), ["combo"]);
    assert.strictEqual(evaluate(defs.combo, [2]), 10); // 2*2 + 2*3
});

test("several independent \"fn\" definitions in one buffer all come back, unrelated to each other", () => {
    const defs = loadExprSource(`
        fn a(x): return x + 1;
        fn b(x): return x - 1;
    `);
    assert.deepStrictEqual(Object.keys(defs), ["a", "b"]);
    assert.strictEqual(evaluate(defs.a, [5]), 6);
    assert.strictEqual(evaluate(defs.b, [5]), 4);
});

test("a \"macro\"-only buffer (nothing marked \"fn\") returns an empty object -- every definition was inlined into another, none independently exported", () => {
    const defs = loadExprSource(`
        macro helper(x): return x * 2;
    `);
    assert.deepStrictEqual(defs, {});
});

// --- deep macro chains: macro-calling-macro-calling-macro, through the ---
// --- new "fn"/"macro" keyword syntax specifically -------------------------
//
// The underlying inline-expansion mechanism (toMacro/fileRegistry) isn't
// new -- test/macros.test.js already covers macro-calling-macro via
// loadMacro() directly. What's new and specifically worth covering here:
// that the SAME chaining works correctly when every link in the chain is
// written with the new mandatory "fn"/"macro" signature keyword, that
// every intermediate "macro" link is invisible both in the returned defs
// object AND in the final emitted output (fully inlined, transitively,
// not just one level), and that this holds at real depth, not just for
// a two-link toy example.

test("a five-link linear macro chain fully inlines, transitively, with only the final \"fn\" in defs", () => {
    const defs = loadExprSource(`
        macro m1(x): return x + 1;
        macro m2(x): return m1(x) * 2;
        macro m3(x): return m2(x) - 3;
        macro m4(x): return m3(x) / 2;
        macro m5(x): return m4(x) + 10;
        fn final(x): return m5(x);
    `);
    assert.deepStrictEqual(Object.keys(defs), ["final"]);
    // m1(4)=5, m2=10, m3=7, m4=3.5, m5=13.5
    assert.strictEqual(evaluate(defs.final, [4]), 13.5);
    const source = emit(defs.final, "js").source;
    assert.doesNotMatch(source, /\bm[1-5]\b/);
});

test("a diamond composition -- two macros both depending on a shared earlier macro -- resolves correctly, no duplicate-registration issue", () => {
    const defs = loadExprSource(`
        macro base(x): return x * x;
        macro left(x): return base(x) + 1;
        macro right(x): return base(x) - 1;
        fn combo(x): return left(x) + right(x);
    `);
    assert.deepStrictEqual(Object.keys(defs), ["combo"]);
    // base(3)=9, left=10, right=8, combo=18 -- independently: 2*base(3)=18.
    assert.strictEqual(evaluate(defs.combo, [3]), 18);
    const source = emit(defs.combo, "js").source;
    assert.doesNotMatch(source, /\b(base|left|right)\b/);
});

test("a multi-output macro participating mid-chain -- fields threaded through another macro, then a fn -- still resolves and inlines fully", () => {
    const defs = loadExprSource(`
        macro pair(x, y): return { sum: x + y, diff: x - y };
        macro scaled(x, y):
          let p = pair(x, y);
          return { total: p.sum * 2, delta: p.diff * 3 };
        fn combined(x, y):
          let s = scaled(x, y);
          return s.total + s.delta;
    `);
    assert.deepStrictEqual(Object.keys(defs), ["combined"]);
    // pair(5,2) = {sum:7, diff:3}; scaled = {total:14, delta:9}; combined = 23.
    assert.strictEqual(evaluate(defs.combined, [5, 2]), 23);
    const source = emit(defs.combined, "js").source;
    assert.doesNotMatch(source, /\b(pair|scaled)\b/);
});

test("a much deeper (12-link) macro chain still resolves correctly and inlines completely -- not just a small toy depth", () => {
    // Built programmatically and checked against an independent plain-JS
    // reference computing the identical recurrence, rather than hand-
    // arithmetic -- the point here is depth/mechanism, not one specific
    // formula, and 12 levels of by-hand arithmetic invites a transcription
    // error a generated cross-check doesn't.
    const DEPTH = 12;
    const lines = ["macro d1(x): return x + 1;"];
    for (let i = 2; i <= DEPTH; i++) {
        const op = i % 2 === 0 ? `d${i - 1}(x) * 1.5` : `d${i - 1}(x) - 2`;
        lines.push(`macro d${i}(x): return ${op};`);
    }
    lines.push(`fn deepest(x): return d${DEPTH}(x);`);
    const defs = loadExprSource(lines.join("\n"));

    assert.deepStrictEqual(Object.keys(defs), ["deepest"]);

    function reference(x) {
        let value = x + 1;
        for (let i = 2; i <= DEPTH; i++) {
            value = i % 2 === 0 ? value * 1.5 : value - 2;
        }
        return value;
    }
    assert.strictEqual(evaluate(defs.deepest, [7]), reference(7));
    const source = emit(defs.deepest, "js").source;
    assert.doesNotMatch(source, /\bd\d+\b/);
});

test("a macro deep in a chain that tries to call itself still throws the same cycle error, even through several other macros first", () => {
    // Structural non-recursion still holds no matter how deep the chain
    // wrapping it is -- see the README's "What this doesn't buy you"
    // section. m1 here is an AST-fn-def macro (see fn.js), so this is
    // caught by declaration ordering, not a runtime cycle guard: m1's own
    // self-reference is simply unresolved (m1 isn't registered yet while
    // ITS OWN body is being expanded), surviving as an ordinary unmapped
    // call -- the same outcome loadExprSource's own top-level forward-
    // reference tests above already document, just several links deeper.
    assert.throws(
        () => {
            const defs = loadExprSource(`
                macro m1(x): return m1(x) + 1;
                macro m2(x): return m1(x) * 2;
                fn final(x): return m2(x);
            `);
            evaluate(defs.final, [1]);
        },
        /no mapping for Math function "m1"/,
    );
});

// --- loadExprSource(text) -- the no-filesystem entry point ---------------

test("loadExprSource parses source text directly, with no file involved at all", () => {
    const defs = loadExprSource(`
        macro cross3(ax, ay, az, bx, by, bz):
          let rx = ay * bz - az * by;
          let ry = az * bx - ax * bz;
          let rz = ax * by - ay * bx;
          return { rx, ry, rz };

        fn crossLength(ax, ay, az, bx, by, bz):
          let c = cross3(ax, ay, az, bx, by, bz);
          return sqrt(c.rx^2 + c.ry^2 + c.rz^2);
    `);
    assert.deepStrictEqual(Object.keys(defs), ["crossLength"]);
    assert.strictEqual(evaluate(defs.crossLength, [1, 0, 0, 0, 1, 0]), 1);
    assert.doesNotMatch(emit(defs.crossLength, "js").source, /cross3/);
});

test("loadExprSource's default label (\"loadExprSource()\") shows up in its own error messages when none is given", () => {
    assert.throws(() => loadExprSource("return 1 + 2;"), /loadExprSource\(\): every definition needs to start with/);
});

test("a custom label (e.g. for a browser buffer with no real file path) shows up in error messages instead", () => {
    assert.throws(() => loadExprSource("return 1 + 2;", "playground"), /playground: every definition needs to start with/);
});

test("loadExpr(path) is just loadExprSource(fileContents) plus a readFileSync -- same results either way", () => {
    const source = `
        fn hyp(a, b):
        return sqrt(a^2 + b^2);
    `;
    const filePath = writeExpr("equivalence.expr", source);
    assert.deepStrictEqual(loadExpr(filePath), loadExprSource(source, `loadExpr(${filePath})`));
});
