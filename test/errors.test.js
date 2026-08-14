// exprforge/test/errors.test.js
//
// Failure modes the code and README both claim exist ("requesting an
// unmapped function throws at build time, not silently") but that nothing
// previously verified. These check the throw actually happens, not just
// that it's documented.

const test = require("node:test");
const assert = require("node:assert");
const { num, v, add, sub, mul, call, cmp, select, letIn, outputs, emitters, evaluate } = require("../index.js");
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
    assert.strictEqual(emitters.expr.emitFunction(fn), "fn f(x):\n  return definitely_not_a_real_math_fn(x);\n");
});

test("referencing an undeclared identifier throws, for every emitter -- including \"expr\" (the printer), which has no exemption here unlike the unmapped-call-name case above", () => {
    // Unlike an unmapped Math function name (which "expr" deliberately
    // passes through, since it has no fixed math library to validate
    // against), an unbound VARIABLE reference means the AST itself is
    // malformed -- there's nothing meaningful to print either way.
    // checkUnboundVars (ast.js) runs unconditionally at the top of
    // Emitter.emitFunction (base.js), so every config-based emitter gets
    // this for free, and CobolEmitter (the one class that overrides
    // emitFunction entirely) has its own explicit call to the same check.
    const fn = { name: "f", params: ["x"], body: add(v("x"), v("definitelyNotDeclaredAnywhere")) };
    for (const [lang, emitter] of Object.entries(emitters)) {
        assert.throws(
            () => emitter.emitFunction(fn),
            /"definitelyNotDeclaredAnywhere" is referenced in "f" but never declared/,
            `expected ${lang} to throw for an unbound variable reference`,
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

// --- COBOL: renameConflictingParams (see emitters/cobol.js, issue #18) ---
//
// A bare "c" param used to throw at emission time -- it's now silently
// renamed to "EFLF_c" internally, since every one of this project's
// targets calls positionally (a parameter's declared name is never
// consumer-visible), making the rename invisible from the outside. See
// https://github.com/theraccoonbear/exprforge/issues/18 for the full
// design rationale, and this file's own header comment above
// renameConflictingParams for why "EFLF_" was verified safe against a
// real compiler rather than assumed (this project has a separate,
// confirmed finding that COBOL breaks on underscored FUNCTION *calls*,
// which turned out NOT to extend to plain variable declarations/
// references -- worth re-confirming if that ever changes).

test("COBOL: a bare 'c' parameter no longer throws -- it's silently renamed internally", () => {
    const fn = { name: "f", params: ["a", "c"], body: select(cmp(v("a"), ">", num(0)), v("c"), mul(v("c"), num(2))) };
    const source = emitters.cobol.emitFunction(fn);
    assert.match(source, /EFLF_c/, "expected the emitted COBOL to use the renamed parameter");
    assert.doesNotMatch(
        source.split("PROCEDURE DIVISION USING")[1].split("\n")[0],
        /(?<![A-Za-z0-9_-])c(?![A-Za-z0-9_-])/,
        "expected no bare, un-renamed 'c' in the USING clause itself",
    );
});

test("COBOL: the rename is scoped to COBOL alone -- every other target still emits the bare param name", () => {
    const fn = { name: "f", params: ["a", "c"], body: add(v("a"), v("c")) };
    for (const [lang, emitter] of Object.entries(emitters)) {
        if (lang === "cobol") continue;
        const source = emitter.emitFunction(fn);
        assert.doesNotMatch(source, /EFLF_c/, `expected ${lang}'s output to be untouched by COBOL's own rename`);
    }
});

test("COBOL: a renamed parameter still evaluates correctly -- the rename doesn't change behavior", () => {
    // evaluate() runs against the ORIGINAL, unrenamed AST -- the rename
    // only ever happens inside emitters/cobol.js's own emitFunction, so
    // this is really just confirming the fixture's own arithmetic, but
    // matters as a sanity check the AST itself was never mutated.
    const fn = { name: "f", params: ["a", "c"], body: select(cmp(v("a"), ">", num(0)), v("c"), mul(v("c"), num(2))) };
    assert.strictEqual(evaluate(fn, [1, 10]), 10);
    assert.strictEqual(evaluate(fn, [-1, 10]), 20);
});

test("COBOL: fn.name 'c' still throws -- only parameters get renamed, never the callable's own name", () => {
    const fn = { name: "c", params: ["x"], body: v("x") };
    assert.throws(() => emitters.cobol.emitFunction(fn), /"c" can't be a function\/parameter\/output name/);
});

test("COBOL: a suite output field named 'c' still throws -- output fields are consumer-visible, not renamed", () => {
    const fn = { name: "f", params: ["x"], body: outputs({ c: v("x"), d: mul(v("x"), num(2)) }) };
    assert.throws(() => emitters.cobol.emitFunction(fn), /"c" can't be a function\/parameter\/output name/);
});

test("COBOL: a 'c' parameter in a multi-output suite is renamed the same way as a scalar function's", () => {
    const fn = { name: "f", params: ["a", "c"], body: outputs({ sum: add(v("a"), v("c")), diff: sub(v("a"), v("c")) }) };
    const source = emitters.cobol.emitFunction(fn);
    assert.match(source, /EFLF_c/);
});

test("COBOL: renaming 'c' into a name that collides with another real parameter throws clearly", () => {
    // Defensive guard, not expected to fire in ordinary use -- but if a
    // function ever had both "c" and a literal "EFLF_c" as real
    // parameters, the rename would otherwise silently produce a
    // duplicate 01-level declaration and a confusing compiler error far
    // from this code.
    const fn = { name: "f", params: ["c", "EFLF_c"], body: add(v("c"), v("EFLF_c")) };
    assert.throws(() => emitters.cobol.emitFunction(fn), /produced a duplicate name \("EFLF_c"\)/);
});
