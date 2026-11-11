// Subpath exports (core, emitters/<lang>, parse, eval, analyze, macros) and
// the standalone-emitter contract: an emitter module required directly knows
// its own `lang`, and the subpath entry points load only what they need.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

// Runs `script` in a fresh node process whose cwd is the package root, so
// require("exprforge/...") resolves through the package's own "exports" map
// (self-reference). Returns the parsed JSON the script prints last.
function child(script) {
    const wrapped = `${script}
const root = ${JSON.stringify(ROOT + path.sep)};
const loaded = Object.keys(require.cache).map((f) => f.replace(root, "").split(require("node:path").sep).join("/"));
console.log(JSON.stringify({ result: typeof result === "undefined" ? null : result, loaded }));`;
    const out = execFileSync(process.execPath, ["-e", wrapped], { cwd: ROOT, encoding: "utf8" });
    return JSON.parse(out.trim().split("\n").pop());
}

const FORBIDDEN_LIGHT = ["emitters/registry.js", "load-expr.js", "index.js", "math/index.js"];
function assertNoneLoaded(loaded, names) {
    for (const n of names) assert.ok(!loaded.includes(n), `${n} was loaded: ${loaded.join(", ")}`);
}

test("standalone emitter module resolves a per-target extern (own lang, no registry)", () => {
    const emitter = require("../emitters/c.js");
    assert.strictEqual(emitter.lang, "c");
    const { loadExtern } = require("../macros.js");
    const { v, num, call, add } = require("../ast.js");
    loadExtern("standaloneLangExtern", { evaluate: (x) => x, c: ([x]) => `my_c_fn(${x})` });
    const src = emitter.emitFunction({ name: "f", params: ["x"], body: add(call("standaloneLangExtern", v("x")), num(1)) });
    assert.ok(src.includes("my_c_fn(x)"), src);
});

test("every emitter module sets lang to its registry key", () => {
    const registry = require("../emitters/registry.js");
    for (const [key, emitter] of Object.entries(registry)) {
        assert.strictEqual(emitter.lang, key);
    }
});

test("exprforge/core loads only ast.js and primitives.js, no emitter", () => {
    const { loaded, result } = child(`const core = require("exprforge/core"); const result = Object.keys(core).includes("num") && Object.keys(core).includes("PRIMITIVE_ARITY");`);
    assert.strictEqual(result, true);
    assert.deepStrictEqual(loaded.filter((f) => f.startsWith("emitters/")), []);
    assertNoneLoaded(loaded, FORBIDDEN_LIGHT.concat(["expr.js", "evaluate.js", "macros.js"]));
});

test("exprforge/core + exprforge/emitters/c emits a function without the registry", () => {
    const { loaded, result } = child(`
        const { v, num, add } = require("exprforge/core");
        const c = require("exprforge/emitters/c");
        const result = { lang: c.lang, source: c.emitFunction({ name: "f", params: ["x"], body: add(v("x"), num(1)) }) };`);
    assert.strictEqual(result.lang, "c");
    assert.ok(result.source.includes("f(double x)") || result.source.includes("f("), result.source);
    assertNoneLoaded(loaded, FORBIDDEN_LIGHT);
    assert.ok(loaded.includes("emitters/c.js"));
    assert.deepStrictEqual(loaded.filter((f) => f.startsWith("emitters/") && !["emitters/c.js", "emitters/base.js"].includes(f)), []);
});

test("exprforge/macros externs resolve for a standalone emitter in a fresh process", () => {
    const { result, loaded } = child(`
        const { v, call } = require("exprforge/core");
        const { loadExtern } = require("exprforge/macros");
        const py = require("exprforge/emitters/python");
        loadExtern("pkgExtern", { evaluate: (x) => x, python: ([x]) => "pkg_py(" + x + ")" });
        const result = py.emitFunction({ name: "f", params: ["x"], body: call("pkgExtern", v("x")) });`);
    assert.ok(result.includes("pkg_py(x)"), result);
    assertNoneLoaded(loaded, FORBIDDEN_LIGHT);
});

test("exprforge/parse, exprforge/eval load no emitter and no registry", () => {
    const { result, loaded } = child(`
        const { expr } = require("exprforge/parse");
        const { evaluate } = require("exprforge/eval");
        const result = evaluate({ name: "f", params: ["x"], body: expr\`x * 2\` }, [4]);`);
    assert.strictEqual(result, 8);
    assert.deepStrictEqual(loaded.filter((f) => f.startsWith("emitters/")), []);
    assertNoneLoaded(loaded, FORBIDDEN_LIGHT);
});

test("exprforge/analyze does not load the registry", () => {
    const { result, loaded } = child(`
        const a = require("exprforge/analyze");
        const result = ["analyzeRanges", "findDuplicateSubexpressions", "differentiate"].every((k) => typeof a[k] === "function");`);
    assert.strictEqual(result, true);
    assertNoneLoaded(loaded, FORBIDDEN_LIGHT);
});

test("unlisted deep paths stay blocked, listed ones resolve", () => {
    const { result } = child(`
        const result = {};
        for (const p of ["exprforge/ast.js", "exprforge/entry/core", "exprforge/emitters/nope"]) {
            try { require(p); result[p] = "loaded"; } catch (e) { result[p] = e.code; }
        }
        for (const p of ["exprforge", "exprforge/math", "exprforge/emitters/latex"]) { require(p); result[p] = "ok"; }`);
    assert.strictEqual(result["exprforge/ast.js"], "ERR_PACKAGE_PATH_NOT_EXPORTED");
    assert.strictEqual(result["exprforge/entry/core"], "ERR_PACKAGE_PATH_NOT_EXPORTED");
    assert.strictEqual(result["exprforge/emitters/nope"], "MODULE_NOT_FOUND");
    assert.strictEqual(result["exprforge"], "ok");
    assert.strictEqual(result["exprforge/emitters/latex"], "ok");
});

test("package.json sideEffects lists every module that registers macros at import", () => {
    const pkg = require("../package.json");
    assert.ok(Array.isArray(pkg.sideEffects));
    for (const f of ["./math/index.js", "./samples/macro-demo.js", "./samples/array-macro-demo.js"]) {
        assert.ok(pkg.sideEffects.includes(f), f);
    }
});
