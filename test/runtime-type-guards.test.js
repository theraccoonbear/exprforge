// exprforge/test/runtime-type-guards.test.js
//
// Unit coverage for the opt-in addTypeGuards option (see
// docs/runtime-type-guards.md) -- emit()/emitMany()'s 4th argument, and
// each of the 8 dynamic-language emitters' `typeGuard` config. Static/
// string-level checks here (does the right guard text show up, does it
// stay absent by default, do targets with no typeGuard ignore the
// option silently); real interpreter execution (does a wrong-type call
// actually throw, does a correct one still work) was verified by hand
// against real node/python3/php/lua/perl/julia/guile during development
// -- see docs/runtime-type-guards.md's own "Verification" section for
// exactly what was run. Deliberately not wired into
// test/conformance.test.js's SAMPLES: this option changes emitted TEXT,
// not computed VALUES (a correctly-typed call behaves identically either
// way), so there's nothing for a compiled-output-vs-JS-reference
// comparison to add here that these checks don't already cover.
const test = require("node:test");
const assert = require("node:assert");
const { emit, emitMany, cyclicElemAst } = require("../index.js");
const emitters = require("../emitters/registry.js");

// Every dynamic-language target this option applies to, and the
// substring its guard is expected to contain for cyclicElem's "arr"
// parameter -- see docs/runtime-type-guards.md's own table for why each
// one checks what it checks (Perl's arrayref convention, Scheme's
// vector-ref requirement, etc.).
const DYNAMIC_TARGETS = {
    js: "Array.isArray(arr)",
    ts: "Array.isArray(arr)",
    python: "isinstance(arr, list)",
    php: "is_array($arr)",
    lua: 'type(arr) ~= "table"',
    perl: "ref($arr) eq 'ARRAY'",
    julia: "arr isa AbstractVector",
    scheme: "(vector? arr)",
};

// Every OTHER registered target -- addTypeGuards should be a silent
// no-op for every one of these: the compiled ones already enforce this
// at compile time, cobol doesn't support array params at all, and expr
// (the source-text printer) has no typeGuard configured either way.
const NO_GUARD_TARGETS = ["c", "java", "go", "rust", "csharp", "fortran", "zig", "qb64", "cobol", "expr"];

test("addTypeGuards defaults to false -- output is byte-for-byte unchanged when omitted", () => {
    for (const lang of Object.keys(DYNAMIC_TARGETS)) {
        const withoutOpts = emitters[lang].emitFunction(cyclicElemAst);
        const withEmptyOpts = emitters[lang].emitFunction(cyclicElemAst, undefined, {});
        const withFalse = emitters[lang].emitFunction(cyclicElemAst, undefined, { addTypeGuards: false });
        assert.strictEqual(withoutOpts, withEmptyOpts, `${lang}: emitFunction() with no opts vs {} should match`);
        assert.strictEqual(withoutOpts, withFalse, `${lang}: addTypeGuards: false should match the default`);
    }
});

test("addTypeGuards: true adds the correct per-language guard for every dynamic target", () => {
    for (const [lang, expectedSubstring] of Object.entries(DYNAMIC_TARGETS)) {
        const source = emitters[lang].emitFunction(cyclicElemAst, undefined, { addTypeGuards: true });
        assert.ok(
            source.includes(expectedSubstring),
            `${lang}: addTypeGuards output should include "${expectedSubstring}" -- got:\n${source}`,
        );
    }
});

test("addTypeGuards: true is a silent no-op for every statically-typed target", () => {
    for (const lang of NO_GUARD_TARGETS) {
        if (lang === "cobol") continue; // cobol throws for ANY array param, guards or not -- see docs/array-index-primitives.md
        const withoutOpts = emitters[lang].emitFunction(cyclicElemAst);
        const withOpts = emitters[lang].emitFunction(cyclicElemAst, undefined, { addTypeGuards: true });
        assert.strictEqual(withoutOpts, withOpts, `${lang}: addTypeGuards should have no effect`);
    }
});

test("addTypeGuards has no effect on a function with no array-typed parameter", () => {
    const { fn } = require("../fn.js");
    const scalarOnly = fn(["f(x, y): return x + y;"]);
    for (const lang of Object.keys(DYNAMIC_TARGETS)) {
        const withoutOpts = emitters[lang].emitFunction(scalarOnly);
        const withOpts = emitters[lang].emitFunction(scalarOnly, undefined, { addTypeGuards: true });
        assert.strictEqual(withoutOpts, withOpts, `${lang}: no array param means nothing to guard`);
    }
});

test("emit()'s 4th argument threads addTypeGuards through to the emitter", () => {
    const guarded = emit(cyclicElemAst, "js", undefined, { addTypeGuards: true });
    assert.ok(guarded.source.includes("Array.isArray(arr)"));
    const plain = emit(cyclicElemAst, "js");
    assert.ok(!plain.source.includes("Array.isArray"));
});

test("emitMany()'s 4th argument applies addTypeGuards to every requested target that supports it", () => {
    const result = emitMany(cyclicElemAst, ["js", "python", "c"], undefined, { addTypeGuards: true });
    assert.ok(result.js.source.includes("Array.isArray(arr)"));
    assert.ok(result.python.source.includes("isinstance(arr, list)"));
    // c has no typeGuard configured -- unaffected, not an error.
    assert.ok(!result.c.source.includes("isArray") && !result.c.source.includes("isinstance"));
});

test("a real wrong-type call actually throws, in the actual JS runtime (not just string-checked)", () => {
    const source = emitters.js.emitFunction(cyclicElemAst, undefined, { addTypeGuards: true });
    const mod = { exports: {} };
    // eslint-disable-next-line no-new-func -- deliberate: evaluating real
    // generated source is exactly what this test needs to prove, not a
    // string-content check standing in for it.
    new Function("module", "exports", source)(mod, mod.exports);
    assert.throws(() => mod.exports.cyclicElem(5, 4, 5), /"arr" must be an array/);
    assert.strictEqual(mod.exports.cyclicElem([10, 20, 30, 40], 4, 5), 20);
});
