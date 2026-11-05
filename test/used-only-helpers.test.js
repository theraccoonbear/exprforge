// exprforge/test/used-only-helpers.test.js
//
// Generated code must define only the support helpers it actually calls
// (see selectHelpers / Emitter.usedHelpers in emitters/base.js). Unused
// definitions are namespace pollution in the consumer's file.
const test = require("node:test");
const assert = require("node:assert");
const { v, num, call, add, sub, mul, div, cmp, select } = require("../ast.js");
const emitters = require("../emitters/registry.js");
const { selectHelpers } = require("../emitters/base.js");

const lerp = {
    name: "lerp",
    params: ["a", "b", "t"],
    body: add(v("a"), mul(sub(v("b"), v("a")), v("t"))),
};

// Reserved helper-name prefixes across emitters (`ef_result` / `ef-result`
// is the generated output variable, not a helper).
const HELPER_TEXT = /_exprforge_|\b_ef_|\bef[_-](?!result\b)/;

function count(haystack, needle) {
    return haystack.split(needle).length - 1;
}

// --- selectHelpers -------------------------------------------------------

test("selectHelpers: returns only referenced helpers, in declaration order", () => {
    const helpers = {
        ef_a: { source: "def ef_a\n", deps: [] },
        ef_b: { source: "def ef_b\n", deps: [] },
        ef_c: { source: "def ef_c\n", deps: [] },
    };
    assert.deepStrictEqual(selectHelpers(helpers, "x = ef_c(1) + ef_a(2)").map((h) => h.name), ["ef_a", "ef_c"]);
    assert.deepStrictEqual(selectHelpers(helpers, "x = 1 + 2"), []);
});

test("selectHelpers: pulls in transitive deps, dependencies first, each once", () => {
    const helpers = {
        ef_top: { source: "top", deps: ["ef_mid", "ef_leaf"] },
        ef_mid: { source: "mid", deps: ["ef_leaf"] },
        ef_leaf: { source: "leaf", deps: [] },
        ef_unused: { source: "unused", deps: [] },
    };
    assert.deepStrictEqual(selectHelpers(helpers, "ef_top(1)").map((h) => h.name), ["ef_leaf", "ef_mid", "ef_top"]);
    assert.deepStrictEqual(selectHelpers(helpers, "ef_mid(1) + ef_leaf(2)").map((h) => h.name), ["ef_leaf", "ef_mid"]);
});

test("selectHelpers: matches whole identifiers only", () => {
    const helpers = { ef_min: { source: "m", deps: [] }, "ef-cmp-gt": { source: "g", deps: [] } };
    assert.deepStrictEqual(selectHelpers(helpers, "ef_minimum(1) + my_ef_min(2)"), []);
    assert.deepStrictEqual(selectHelpers(helpers, "FUNCTION ef-cmp-gt(a)").map((h) => h.name), ["ef-cmp-gt"]);
    assert.deepStrictEqual(selectHelpers(helpers, "FUNCTION ef-cmp-gt-x(a)"), []);
});

test("selectHelpers: skips excluded helpers and rejects unknown deps and cycles", () => {
    const helpers = { ef_a: { source: "a", deps: [] }, ef_b: { source: "b", deps: [] } };
    assert.deepStrictEqual(
        selectHelpers(helpers, "ef_a(ef_b(1))", { exclude: new Set(["ef_a"]) }).map((h) => h.name),
        ["ef_b"],
    );
    assert.throws(() => selectHelpers({ ef_a: { source: "a", deps: ["ef_zz"] } }, "ef_a(1)"), /unknown helper/);
    assert.throws(
        () => selectHelpers({ ef_a: { source: "a", deps: ["ef_b"] }, ef_b: { source: "b", deps: ["ef_a"] } }, "ef_a(1)"),
        /cycle/,
    );
});

// --- Guard over every registered emitter -----------------------------------

for (const [lang, emitter] of Object.entries(emitters)) {
    test(`${lang}: lerp (pure arithmetic) emits no helper definitions`, () => {
        const out = emitter.emitFunction(lerp);
        assert.ok(!HELPER_TEXT.test(out), `${lang} lerp output mentions a helper:\n${out}`);
        for (const name of Object.keys(emitter.helpers)) {
            assert.ok(!out.includes(name), `${lang} lerp output contains helper name ${name}`);
        }
    });
}

// --- Per-emitter: a needed primitive brings in that helper and nothing else --

function helperNamesIn(lang, out) {
    return Object.keys(emitters[lang].helpers).filter((n) => new RegExp(`(?<![\\w-])${n}(?![\\w-])`).test(out));
}

function definitionCount(lang, out, name) {
    return count(out, emitters[lang].helpers[name].source);
}

const divFn = { name: "q", params: ["a", "b"], body: div(v("a"), v("b")) };

for (const lang of ["python", "perl"]) {
    test(`${lang}: division brings in _exprforge_div, defined once, and nothing else`, () => {
        const out = emitters[lang].emitFunction(divFn);
        assert.deepStrictEqual(helperNamesIn(lang, out), ["_exprforge_div"]);
        assert.strictEqual(definitionCount(lang, out, "_exprforge_div"), 1);
        assert.ok(/_exprforge_div\(\$?a, \$?b\)/.test(out));
    });
    test(`${lang}: division by a nonzero literal needs no helper`, () => {
        const out = emitters[lang].emitFunction({ name: "h", params: ["a"], body: div(v("a"), num(2)) });
        assert.ok(!out.includes("_exprforge_"));
    });
}

test("matlab: sqrt brings in ef_sqrt only; select brings in ef_select only", () => {
    const sq = emitters.matlab.emitFunction({ name: "f", params: ["x"], body: call("sqrt", v("x")) });
    assert.deepStrictEqual(helperNamesIn("matlab", sq), ["ef_sqrt"]);
    assert.strictEqual(definitionCount("matlab", sq, "ef_sqrt"), 1);
    const sel = emitters.matlab.emitFunction({
        name: "g", params: ["x"], body: select(cmp(v("x"), "!=", num(0)), v("x"), num(1)),
    });
    assert.deepStrictEqual(helperNamesIn("matlab", sel), ["ef_select"]);
});

test("matlab: clampIndex brings in ef_min and ef_max only", () => {
    const out = emitters.matlab.emitFunction({
        name: "c", params: ["i", "lo", "hi"], body: call("clampIndex", v("i"), v("lo"), v("hi")),
    });
    assert.deepStrictEqual(helperNamesIn("matlab", out), ["ef_min", "ef_max"]);
});

test("qb64: asin brings in ef_safe_sqr only; log2 brings in ef_safe_log only", () => {
    const asin = emitters.qb64.emitFunction({ name: "f", params: ["x"], body: call("asin", v("x")) });
    assert.deepStrictEqual(helperNamesIn("qb64", asin), ["ef_safe_sqr"]);
    assert.strictEqual(definitionCount("qb64", asin, "ef_safe_sqr"), 1);
    const log2 = emitters.qb64.emitFunction({ name: "g", params: ["x"], body: call("log2", v("x")) });
    assert.deepStrictEqual(helperNamesIn("qb64", log2), ["ef_safe_log"]);
});

test("qb64: helper FUNCTIONs precede the function that calls them", () => {
    const out = emitters.qb64.emitFunction({ name: "f", params: ["x"], body: call("pow", v("x"), num(2)) });
    assert.ok(out.indexOf("FUNCTION ef_safe_pow#") < out.indexOf("FUNCTION f#"));
});

test("cobol: select brings in only its own comparator, and only that one is declared", () => {
    const out = emitters.cobol.emitFunction({
        name: "s", params: ["x"], body: select(cmp(v("x"), ">=", num(0)), v("x"), num(0)),
    });
    assert.deepStrictEqual(helperNamesIn("cobol", out), ["ef-cmp-ge"]);
    assert.strictEqual(count(out, "FUNCTION-ID. ef-cmp-ge."), 1);
    assert.ok(out.indexOf("FUNCTION-ID. ef-cmp-ge.") < out.indexOf("PROGRAM-ID. s."));
    assert.ok(out.includes("REPOSITORY."));
});

test("cobol: a program with no cmp()/select() has no helpers and no REPOSITORY", () => {
    const out = emitters.cobol.emitFunction(lerp);
    assert.ok(!out.includes("REPOSITORY"));
    assert.ok(!out.includes("FUNCTION-ID"));
});

test("cobol: includeHelpers false still declares the comparators the program calls", () => {
    const out = emitters.cobol.emitFunction(
        { name: "s", params: ["x"], body: select(cmp(v("x"), "==", num(0)), v("x"), num(0)) },
        undefined,
        { includeHelpers: false },
    );
    assert.ok(!out.includes("FUNCTION-ID"));
    assert.ok(out.includes("FUNCTION ef-cmp-eq."));
});

// --- Multi-function files / suites ------------------------------------------

const MULTI = {
    python: { fns: [divFn, { name: "q2", params: ["a", "b"], body: div(v("b"), v("a")) }], names: ["_exprforge_div"] },
    perl: { fns: [divFn, { name: "q2", params: ["a", "b"], body: div(v("b"), v("a")) }], names: ["_exprforge_div"] },
    matlab: {
        fns: [
            { name: "f1", params: ["x"], body: call("sqrt", v("x")) },
            { name: "f2", params: ["x"], body: add(call("sqrt", v("x")), call("log", v("x"))) },
        ],
        names: ["ef_sqrt", "ef_log"],
    },
    qb64: {
        fns: [
            { name: "f1", params: ["x"], body: call("sqrt", v("x")) },
            { name: "f2", params: ["x"], body: add(call("sqrt", v("x")), call("log", v("x"))) },
        ],
        names: ["ef_safe_sqr", "ef_safe_log"],
    },
    cobol: {
        fns: [
            { name: "f1", params: ["x"], body: select(cmp(v("x"), ">", num(0)), v("x"), num(0)) },
            { name: "f2", params: ["x"], body: select(cmp(v("x"), ">", num(1)), v("x"), num(1)) },
            { name: "f3", params: ["x"], body: select(cmp(v("x"), "<", num(1)), v("x"), num(1)) },
        ],
        names: ["ef-cmp-gt", "ef-cmp-lt"],
    },
};

for (const [lang, { fns, names }] of Object.entries(MULTI)) {
    test(`${lang}: a multi-function file defines the union of used helpers exactly once`, () => {
        const emittedHelpers = new Set();
        const out = fns.map((fn) => emitters[lang].emitFunction(fn, undefined, { emittedHelpers })).join("\n");
        assert.deepStrictEqual(helperNamesIn(lang, out).sort(), [...names].sort());
        for (const name of names) {
            assert.strictEqual(definitionCount(lang, out, name), 1, `${lang}: ${name} defined once`);
        }
        assert.deepStrictEqual([...emittedHelpers].sort(), [...names].sort());
    });
}

test("python: a suite brings in only the helpers its outputs use", () => {
    const { outputs } = require("../ast.js");
    const withDiv = emitters.python.emitFunction({
        name: "s", params: ["a", "b"], body: outputs({ q: div(v("a"), v("b")), p: mul(v("a"), v("b")) }),
    });
    assert.strictEqual(definitionCount("python", withDiv, "_exprforge_div"), 1);
    const without = emitters.python.emitFunction({
        name: "s", params: ["a", "b"], body: outputs({ p: mul(v("a"), v("b")), r: add(v("a"), v("b")) }),
    });
    assert.ok(!without.includes("_exprforge_"));
});
