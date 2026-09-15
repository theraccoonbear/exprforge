// exprforge/test/array-index-primitives.test.js
//
// Unit coverage for the "index" node type and wrapIndex/clampIndex
// primitives (see docs/array-index-primitives.md) at the AST/evaluate/
// macros layer -- ast.js's idx()/collectLets/collectVarRefs/
// checkUnboundVars, evaluate.js's "index" case and the two new CALLS
// entries, differentiate.js's explicit throw, and expandMacros passing
// an "index" node through unchanged.
//
// Deliberately does NOT attempt per-target compiled conformance here --
// that would mean extending test/conformance.test.js's runSuite* helpers
// (all built around scalar-only positional arguments) to also construct
// and pass an array argument per language's own calling convention, a
// real, separate undertaking of its own, not a quick extension. Instead:
// every one of the 17 emitters that implements array indexing was
// manually verified against its real toolchain during development
// (js/ts/python/c/rust/perl/go/java/php/lua/julia/scheme/zig/fortran
// actually executed and confirmed correct; qb64 confirmed to compile,
// execution blocked by an unrelated sandbox display limitation; csharp
// blocked by this sandbox's pre-existing broken dotnet build). Formalizing
// that into permanent conformance.test.js coverage is real follow-up
// work, not done here.
const test = require("node:test");
const assert = require("node:assert");
const {
    num, v, idx, letIn, call, checkUnboundVars, collectLets,
} = require("../ast.js");
const { evaluate } = require("../evaluate.js");
const { differentiate } = require("../differentiate.js");
const { expandMacros } = require("../macros.js");
const emitters = require("../emitters/registry.js");

// --- ast.js: idx() builder, collectLets, collectVarRefs -----------------

test("idx() builds a plain {type, target, at} node", () => {
    const node = idx(v("arr"), num(2));
    assert.strictEqual(node.type, "index");
    assert.deepStrictEqual(node.target, v("arr"));
    assert.deepStrictEqual(node.at, num(2));
});

test("collectLets recurses into an index node's target and at", () => {
    const tree = letIn("i", num(1), idx(v("arr"), letIn("j", num(1), v("j"))));
    const { bindings, body } = collectLets(tree);
    // Both the outer "i" and the inner "j" (nested inside `at`) get
    // hoisted into the same flat bindings list.
    assert.strictEqual(bindings.length, 2);
    assert.strictEqual(bindings.map((b) => b.name).sort().join(","), "i,j");
    assert.strictEqual(body.type, "index");
    assert.deepStrictEqual(body.target, v("arr"));
});

test("checkUnboundVars sees a var referenced only inside index's target/at", () => {
    const fn = { name: "f", params: ["arr"], body: idx(v("arr"), num(0)) };
    assert.doesNotThrow(() => checkUnboundVars(fn));

    const badTarget = { name: "f", params: [], body: idx(v("missing"), num(0)) };
    assert.throws(() => checkUnboundVars(badTarget), /"missing" is referenced in "f" but never declared/);

    const badAt = { name: "f", params: ["arr"], body: idx(v("arr"), v("missing")) };
    assert.throws(() => checkUnboundVars(badAt), /"missing" is referenced in "f" but never declared/);
});

// --- ast.js: paramTypes validation ---------------------------------------

test("checkUnboundVars accepts a valid paramTypes entry", () => {
    const fn = {
        name: "f", params: ["arr", "n"], paramTypes: { arr: "number[]" },
        body: idx(v("arr"), num(0)),
    };
    assert.doesNotThrow(() => checkUnboundVars(fn));
});

test("checkUnboundVars rejects a paramTypes entry naming a non-existent param", () => {
    const fn = {
        name: "f", params: ["arr"], paramTypes: { notAParam: "number[]" },
        body: idx(v("arr"), num(0)),
    };
    assert.throws(() => checkUnboundVars(fn), /paramTypes has an entry for "notAParam".*isn't one of this function's params/);
});

test("checkUnboundVars rejects an unsupported paramTypes value", () => {
    const fn = {
        name: "f", params: ["arr"], paramTypes: { arr: "string[]" },
        body: idx(v("arr"), num(0)),
    };
    assert.throws(() => checkUnboundVars(fn), /only "number\[\]" is supported/);
});

// --- evaluate.js: "index" case, wrapIndex/clampIndex --------------------

test("evaluate() indexes a real array argument", () => {
    const fn = { name: "f", params: ["arr", "i"], body: idx(v("arr"), v("i")) };
    assert.strictEqual(evaluate(fn, [[10, 20, 30], 0]), 10);
    assert.strictEqual(evaluate(fn, [[10, 20, 30], 2]), 30);
});

test("evaluate() throws for a non-array index target", () => {
    const fn = { name: "f", params: ["notAnArray"], body: idx(v("notAnArray"), num(0)) };
    assert.throws(() => evaluate(fn, [5]), /"index" target did not resolve to an array/);
});

test("evaluate() throws for an out-of-bounds index", () => {
    const fn = { name: "f", params: ["arr"], body: idx(v("arr"), num(5)) };
    assert.throws(() => evaluate(fn, [[1, 2, 3]]), /array index 5 out of bounds \(length 3\)/);
});

test("evaluate() throws for a non-integer index", () => {
    const fn = { name: "f", params: ["arr"], body: idx(v("arr"), num(1.5)) };
    assert.throws(() => evaluate(fn, [[1, 2, 3]]), /array index 1\.5 out of bounds/);
});

test("wrapIndex wraps a negative index into [0, m)", () => {
    const fn = { name: "f", params: ["i", "m"], body: call("wrapIndex", v("i"), v("m")) };
    assert.strictEqual(evaluate(fn, [-1, 3]), 2);
    assert.strictEqual(evaluate(fn, [3, 3]), 0);
    assert.strictEqual(evaluate(fn, [1, 3]), 1);
});

test("clampIndex clamps to [lo, hi]", () => {
    const fn = { name: "f", params: ["i", "lo", "hi"], body: call("clampIndex", v("i"), v("lo"), v("hi")) };
    assert.strictEqual(evaluate(fn, [-1, 0, 4]), 0);
    assert.strictEqual(evaluate(fn, [10, 0, 4]), 4);
    assert.strictEqual(evaluate(fn, [2, 0, 4]), 2);
});

test("the motivating pattern: arr[wrapIndex(i, m)] evaluates end to end", () => {
    const fn = {
        name: "cyclicElem", params: ["arr", "m", "i"], paramTypes: { arr: "number[]" },
        body: idx(v("arr"), call("wrapIndex", v("i"), v("m"))),
    };
    assert.strictEqual(evaluate(fn, [[10, 20, 30], 3, -1]), 30);
});

// --- differentiate.js: explicit, documented throw ------------------------

test("differentiate() throws a clear error for an index node, not a generic one", () => {
    assert.throws(
        () => differentiate(idx(v("arr"), num(0)), "x"),
        /"index" \(array element access\) is not differentiable/,
    );
});

// --- macros.js: expandMacros passes "index" through unchanged -----------

test("expandMacros recurses into an index node without altering its shape", () => {
    const fn = { name: "f", params: ["arr", "i"], body: idx(v("arr"), v("i")) };
    const expanded = expandMacros(fn);
    assert.strictEqual(expanded.body.type, "index");
    assert.deepStrictEqual(expanded.body, idx(v("arr"), v("i")));
});

// --- emitters: every non-cobol target either emits or throws clearly ----

test("every registered emitter except cobol implements array indexing", () => {
    const fn = {
        name: "cyclicElem", params: ["arr", "m", "i"], paramTypes: { arr: "number[]" },
        body: idx(v("arr"), call("wrapIndex", v("i"), v("m"))),
    };
    for (const [lang, emitter] of Object.entries(emitters)) {
        if (lang === "cobol") continue;
        assert.doesNotThrow(() => emitter.emitFunction(fn), `${lang} should support array indexing`);
    }
});

test("cobol throws a clear, explicit 'not supported' error for array indexing", () => {
    const fn = { name: "f", params: ["arr"], paramTypes: { arr: "number[]" }, body: idx(v("arr"), num(0)) };
    assert.throws(
        () => emitters.cobol.emitFunction(fn),
        /array indexing not supported for this target yet/,
    );
});

// --- emitters: a standalone Emitter with no emitIndex config throws -----

test("an Emitter with no emitIndex config throws the generic 'not supported' error", () => {
    const Emitter = require("../emitters/base.js");
    const bare = new Emitter({
        ext: "xyz",
        formatNumber: String,
        formatFunction: (fn, body) => body,
    });
    assert.throws(
        () => bare.emitExpr(idx(v("arr"), num(0))),
        /array indexing not supported for this target yet/,
    );
});
