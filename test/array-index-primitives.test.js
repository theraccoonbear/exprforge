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
    const fn = { name: "f", params: ["arr"], paramTypes: { arr: "number[]" }, body: idx(v("arr"), num(0)) };
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

// --- ast.js: assertNoBareArrayUse (array-typed param misuse) ------------
//
// There's no array literal or array-typed return anywhere in this
// grammar (see ast.js's own "index" node-shape comment) -- so an
// array-typed parameter appearing ANYWHERE other than the target of its
// own "index" node is necessarily a bug: it "works" (silently, wrongly)
// on evaluate()/js/python, which don't mind a JS array flowing through
// untyped, and then fails to even compile on every statically-typed
// target. This is exactly the gap a real consumer hit (see
// docs/array-index-primitives.md) -- these tests lock in that it's
// caught once, here, with one clear message, on every real consumption
// path (evaluate(), every emitter), not discovered per-language later.

function makeFn(paramTypes, body, params = Object.keys(paramTypes)) {
    return { name: "f", params, paramTypes, body };
}

test("rejects an array-typed param returned directly", () => {
    const fn = makeFn({ arr: "number[]" }, v("arr"));
    assert.throws(() => checkUnboundVars(fn), /uses array-typed parameter "arr" as a plain value/);
});

test("rejects an array-typed param used in arithmetic", () => {
    const { add } = require("../ast.js");
    const fn = makeFn({ arr: "number[]" }, add(v("arr"), num(1)));
    assert.throws(() => checkUnboundVars(fn), /uses array-typed parameter "arr" as a plain value/);
});

test("rejects an array-typed param passed as a call argument", () => {
    const fn = makeFn({ arr: "number[]" }, call("wrapIndex", v("arr"), v("i")), ["arr", "i"]);
    assert.throws(() => checkUnboundVars(fn), /uses array-typed parameter "arr" as a plain value/);
});

test("rejects an array-typed param used as an outputs() field", () => {
    const { outputs } = require("../ast.js");
    const fn = makeFn({ arr: "number[]" }, outputs({ x: v("arr") }));
    assert.throws(() => checkUnboundVars(fn), /uses array-typed parameter "arr" as a plain value/);
});

test("rejects indexing an array by itself: arr[arr]", () => {
    const fn = makeFn({ arr: "number[]" }, idx(v("arr"), v("arr")));
    assert.throws(() => checkUnboundVars(fn), /uses array-typed parameter "arr" as a plain value/);
});

test("rejects indexing one array by a bare reference to another array", () => {
    const fn = makeFn({ arr: "number[]", other: "number[]" }, idx(v("arr"), v("other")));
    assert.throws(() => checkUnboundVars(fn), /uses array-typed parameter "other" as a plain value/);
});

test("allows indexing one array by an element read out of another", () => {
    const fn = makeFn({ arr: "number[]", other: "number[]" }, idx(v("arr"), idx(v("other"), num(0))));
    assert.doesNotThrow(() => checkUnboundVars(fn));
});

test("rejects indexing into a parameter that isn't declared array-typed", () => {
    const fn = { name: "f", params: ["x", "i"], body: idx(v("x"), v("i")) };
    assert.throws(() => checkUnboundVars(fn), /indexes into "x", which isn't declared array-typed/);
});

test("a pure let-rename of an array param is allowed, and stays indexable", () => {
    const fn = makeFn({ arr: "number[]" }, letIn("a", v("arr"), idx(v("a"), v("i"))), ["arr", "i"]);
    assert.doesNotThrow(() => checkUnboundVars(fn));
});

test("a leak hiding behind a let-rename is still caught", () => {
    const fn = makeFn({ arr: "number[]" }, letIn("a", v("arr"), v("a")));
    assert.throws(() => checkUnboundVars(fn), /uses array-typed parameter "a" as a plain value/);
});

test("a let bound to a real element read (scalar) is unrestricted afterward", () => {
    const { add } = require("../ast.js");
    const fn = makeFn({ arr: "number[]" }, letIn("first", idx(v("arr"), num(0)), add(v("first"), num(1))));
    assert.doesNotThrow(() => checkUnboundVars(fn));
});

// --- evaluate.js: "index" case, wrapIndex/clampIndex --------------------

test("evaluate() indexes a real array argument", () => {
    const fn = { name: "f", params: ["arr", "i"], paramTypes: { arr: "number[]" }, body: idx(v("arr"), v("i")) };
    assert.strictEqual(evaluate(fn, [[10, 20, 30], 0]), 10);
    assert.strictEqual(evaluate(fn, [[10, 20, 30], 2]), 30);
});

test("evaluate() throws for a non-array index target", () => {
    // notAnArray IS declared array-typed here (paramTypes says so, so
    // this passes checkUnboundVars' static check) -- what's being tested
    // is the real remaining gap one static layer up can't close: nothing
    // stops a CALLER from passing a plain number where paramTypes
    // promised an array (JS has no way to enforce that at the call
    // boundary). evaluate()'s own Array.isArray() runtime guard is what
    // actually catches that mismatch, and this proves it still does.
    const fn = {
        name: "f", params: ["notAnArray"], paramTypes: { notAnArray: "number[]" },
        body: idx(v("notAnArray"), num(0)),
    };
    assert.throws(() => evaluate(fn, [5]), /"index" target did not resolve to an array/);
});

test("evaluate() throws for an out-of-bounds index", () => {
    const fn = { name: "f", params: ["arr"], paramTypes: { arr: "number[]" }, body: idx(v("arr"), num(5)) };
    assert.throws(() => evaluate(fn, [[1, 2, 3]]), /array index 5 out of bounds \(length 3\)/);
});

test("evaluate() throws for a non-integer index", () => {
    const fn = { name: "f", params: ["arr"], paramTypes: { arr: "number[]" }, body: idx(v("arr"), num(1.5)) };
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
