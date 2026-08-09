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

test("requesting an unmapped Math function throws, for every real compile/run emitter", () => {
    // "expr" (emitters/exprsyntax.js) is deliberately excluded -- it's a
    // pretty-printer over the AST, not a real target with a fixed math
    // library, and passes every call name through uniformly by design
    // (see that file's header comment). That's the same "don't validate
    // names here, defer to whatever actually needs to resolve them"
    // choice expr.js's own parser already makes at parse time -- covered
    // separately below.
    const fn = { name: "f", params: ["x"], body: call("definitely_not_a_real_math_fn", v("x")) };
    for (const [lang, emitter] of Object.entries(emitters)) {
        if (lang === "expr") continue;
        assert.throws(
            () => emitter.emitFunction(fn),
            /no mapping for Math function/,
            `expected ${lang} to throw for an unmapped function`,
        );
    }
});

test("the expr emitter prints an unmapped call name through unchanged, instead of throwing", () => {
    const fn = { name: "f", params: ["x"], body: call("definitely_not_a_real_math_fn", v("x")) };
    assert.strictEqual(emitters.expr.emitFunction(fn), "return definitely_not_a_real_math_fn(x);\n");
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

test("QB64: a let binding named after a reserved builtin throws", () => {
    // "len" collides with QB64's LEN() -- confirmed against a real
    // compiler: `Dim len AS DOUBLE` fails to build there. Case-insensitive
    // since QB64 identifiers are.
    const fn = { name: "f", params: ["x"], body: letIn("LEN", num(1), v("LEN")) };
    assert.throws(() => emitters.qb64.emitFunction(fn), /"LEN" is a reserved QB64 builtin/);
});

test("QB64: a suite output field named after a reserved builtin throws", () => {
    const fn = { name: "f", params: ["x"], body: outputs({ a: v("x"), val: num(1) }) };
    assert.throws(() => emitters.qb64.emitFunction(fn), /"val" is a reserved QB64 builtin/);
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
