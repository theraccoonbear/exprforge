// exprforge/test/evaluate.test.js
//
// Direct unit tests for evaluate.js against a handful of hand-computed
// ASTs -- plain expression, let-chain, ternary, multi-output. Full
// cross-target proof (the interpreter agrees with every compiled
// target, not just hand-checked arithmetic) lives in
// test/conformance.test.js, where evaluate() is wired in as one more
// target row.

const test = require("node:test");
const assert = require("node:assert");
const {
    num, v, add, sub, mul, div, call, letIn, letChain, cmp, select, outputs,
} = require("../ast.js");
const { evaluate } = require("../evaluate.js");

test("a plain expression with no let bindings", () => {
    const fn = { name: "f", params: ["a", "b"], body: add(v("a"), mul(v("b"), num(2))) };
    assert.strictEqual(evaluate(fn, [3, 4]), 11);
});

test("a single let binding", () => {
    const fn = { name: "f", params: ["x"], body: letIn("sq", mul(v("x"), v("x")), add(v("sq"), num(1))) };
    assert.strictEqual(evaluate(fn, [3]), 10);
});

test("a let-chain where a later binding references an earlier one", () => {
    const fn = {
        name: "f",
        params: ["x"],
        body: letChain([["a", mul(v("x"), num(2))], ["b", add(v("a"), num(1))]], mul(v("b"), num(3))),
    };
    // a = 6, b = 7, result = 21
    assert.strictEqual(evaluate(fn, [3]), 21);
});

test("a ternary (select/cmp) picks the correct branch", () => {
    const fn = { name: "f", params: ["a", "b"], body: select(cmp(v("a"), ">", v("b")), v("a"), v("b")) };
    assert.strictEqual(evaluate(fn, [5, 2]), 5);
    assert.strictEqual(evaluate(fn, [2, 5]), 5);
});

test("all six comparison operators evaluate correctly", () => {
    const make = (op) => ({ name: "f", params: ["a", "b"], body: select(cmp(v("a"), op, v("b")), num(1), num(0)) });
    assert.strictEqual(evaluate(make(">"), [2, 1]), 1);
    assert.strictEqual(evaluate(make("<"), [2, 1]), 0);
    assert.strictEqual(evaluate(make(">="), [1, 1]), 1);
    assert.strictEqual(evaluate(make("<="), [1, 1]), 1);
    assert.strictEqual(evaluate(make("=="), [1, 1]), 1);
    assert.strictEqual(evaluate(make("!="), [1, 1]), 0);
});

test("every intrinsic in emitters/js.js's calls table is mapped and callable", () => {
    const unary = ["sqrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan", "log", "log2", "log10", "exp", "floor", "ceil", "round", "trunc", "sign"];
    for (const name of unary) {
        const fn = { name: "f", params: ["x"], body: call(name, v("x")) };
        assert.strictEqual(evaluate(fn, [0.5]), Math[name](0.5), `expected evaluate() to match Math.${name}`);
    }
    const binary = { pow: Math.pow, atan2: Math.atan2, min: Math.min, max: Math.max, hypot: Math.hypot };
    for (const [name, impl] of Object.entries(binary)) {
        const fn = { name: "f", params: ["x", "y"], body: call(name, v("x"), v("y")) };
        assert.strictEqual(evaluate(fn, [3, 4]), impl(3, 4), `expected evaluate() to match Math.${name}`);
    }
});

test("multi-output suites evaluate to a {name: value} object", () => {
    const fn = {
        name: "f",
        params: ["x", "y"],
        body: letIn(
            "mag",
            call("sqrt", add(mul(v("x"), v("x")), mul(v("y"), v("y")))),
            outputs({ nx: div(v("x"), v("mag")), ny: div(v("y"), v("mag")) }),
        ),
    };
    assert.deepStrictEqual(evaluate(fn, [3, 4]), { nx: 0.6, ny: 0.8 });
});

test("wrong argument count throws", () => {
    const fn = { name: "f", params: ["a", "b"], body: add(v("a"), v("b")) };
    assert.throws(() => evaluate(fn, [1]), /expects 2 argument\(s\), got 1/);
});

test("an unbound variable reference throws", () => {
    // Now caught by checkUnboundVars (ast.js), called at the top of
    // evaluate() itself -- statically, before any node is ever walked --
    // rather than by evalNode's own runtime "unbound variable" throw
    // (still present as a defensive backstop, but no longer what a
    // caller actually sees first; see evaluate.js's own comment).
    const fn = { name: "f", params: ["a"], body: add(v("a"), v("typo")) };
    assert.throws(() => evaluate(fn, [1]), /"typo" is referenced in "f" but never declared/);
});

test("an unmapped call name throws, matching every real codegen emitter's own behavior", () => {
    const fn = { name: "f", params: ["x"], body: call("definitely_not_a_real_math_fn", v("x")) };
    assert.throws(() => evaluate(fn, [1]), /no mapping for Math function/);
});
