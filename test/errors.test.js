// exprforge/test/errors.test.js
//
// Failure modes the code and README both claim exist ("requesting an
// unmapped function throws at build time, not silently") but that nothing
// previously verified. These check the throw actually happens, not just
// that it's documented.

const test = require("node:test");
const assert = require("node:assert");
const { num, v, add, call, cmp, letIn, outputs, emitters } = require("../index.js");
const Emitter = require("../emitters/base.js");

test("requesting an unmapped Math function throws, for every emitter", () => {
    const fn = { name: "f", params: ["x"], body: call("definitely_not_a_real_math_fn", v("x")) };
    for (const [lang, emitter] of Object.entries(emitters)) {
        assert.throws(
            () => emitter.emitFunction(fn),
            /no mapping for Math function/,
            `expected ${lang} to throw for an unmapped function`,
        );
    }
});

test("two let bindings sharing a name throw, even nested inside each other's value", () => {
    const fn = {
        name: "f",
        params: ["x"],
        body: letIn("a", num(1), letIn("a", num(2), v("a"))),
    };
    assert.throws(() => emitters.js.emitFunction(fn), /duplicate let binding name "a"/);
});

test("two let bindings sharing a name throw across sibling subtrees, not just direct nesting", () => {
    const fn = {
        name: "f",
        params: ["x"],
        body: add(letIn("a", num(1), v("a")), letIn("a", num(2), v("a"))),
    };
    assert.throws(() => emitters.js.emitFunction(fn), /duplicate let binding name "a"/);
});

test("emitting a suite through an emitter with no formatSuite configured throws clearly", () => {
    const bareEmitter = new Emitter({
        ext: "bare",
        formatNumber: (n) => String(n),
        calls: {},
        formatFunction: (fn, body) => body,
        // no formatSuite
    });
    const fn = { name: "f", params: ["x"], body: outputs({ a: v("x"), b: num(1) }) };
    assert.throws(() => bareEmitter.emitFunction(fn), /no formatSuite configured/);
});

test("a cmp node used outside select() throws, for every emitter", () => {
    // cmp is only meant to be select()'s cond; using it as a plain operand
    // (here, one argument to add) isn't supported.
    const fn = { name: "f", params: ["x"], body: add(cmp(v("x"), ">", num(0)), num(1)) };
    for (const [lang, emitter] of Object.entries(emitters)) {
        assert.throws(
            () => emitter.emitFunction(fn),
            /"cmp" is only valid inside a select/,
            `expected ${lang} to throw for a bare cmp node`,
        );
    }
});
