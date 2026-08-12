// exprforge/test/emit.test.js
//
// index.js's own emit()/emitMany()/emitAll() -- see issue #21 asks 1/2.
// emitAll() unconditionally ran every registered emitter and threw (killing
// the whole batch) the moment any single one did; emit()/emitMany() are the
// explicit replacements ("just the target(s) I asked for"), and emitAll is
// now a thin deprecated alias for emitMany(fnDef) -- same isolated
// { source: null, error } shape on a per-language failure, not a throw.

const test = require("node:test");
const assert = require("node:assert");
const {
    num, v, call, letIn, emit, emitMany, emitAll, emitters,
} = require("../index.js");

test("emit(fnDef, lang) returns { ext, source } for one target", () => {
    const fnDef = { name: "double", params: ["x"], body: call("sqrt", v("x")) };
    const out = emit(fnDef, "js");
    assert.strictEqual(out.ext, emitters.js.ext);
    assert.match(out.source, /Math\.sqrt/);
});

test("emit() with an unregistered language name throws, listing the known ones", () => {
    const fnDef = { name: "f", params: ["x"], body: v("x") };
    assert.throws(() => emit(fnDef, "cobol-plus-plus"), /no emitter registered for language "cobol-plus-plus"/);
    assert.throws(() => emit(fnDef, "cobol-plus-plus"), /js/); // the known-languages list is in the message
});

test("emit() propagates a single target's own emitter error -- there's nothing else in the batch to isolate it from", () => {
    const fnDef = { name: "f", params: ["x"], body: letIn("LEN", num(1), v("LEN")) };
    assert.throws(() => emit(fnDef, "qb64"), /"LEN" is a reserved QB64 builtin/);
});

test("emitMany() defaults to every registered language, same coverage emitAll used to require", () => {
    const fnDef = { name: "f", params: ["x"], body: v("x") };
    const out = emitMany(fnDef);
    assert.deepStrictEqual(Object.keys(out).sort(), Object.keys(emitters).sort());
});

test("emitMany() accepts an explicit subset, and runs nothing else", () => {
    const fnDef = { name: "f", params: ["x"], body: v("x") };
    const out = emitMany(fnDef, ["js", "python"]);
    assert.deepStrictEqual(Object.keys(out).sort(), ["js", "python"]);
});

test("emitMany() isolates one language's failure -- everyone else still gets their real result", () => {
    // "LEN" collides with both QB64's and Fortran's own reserved builtins
    // -- everyone else should still emit fine.
    const fnDef = { name: "f", params: ["x"], body: letIn("LEN", num(1), v("LEN")) };
    const out = emitMany(fnDef);
    assert.strictEqual(out.qb64.source, null);
    assert.match(out.qb64.error, /"LEN" is a reserved QB64 builtin/);
    assert.strictEqual(out.fortran.source, null);
    assert.match(out.fortran.error, /"LEN" is a reserved Fortran keyword\/intrinsic/);
    for (const [lang, result] of Object.entries(out)) {
        if (lang === "qb64" || lang === "fortran") continue;
        assert.strictEqual(result.error, null, `expected ${lang} to succeed`);
        assert.strictEqual(typeof result.source, "string", `expected ${lang} to have real source`);
    }
});

test("emitMany() reports an unregistered language in the isolated shape too, not a throw", () => {
    const fnDef = { name: "f", params: ["x"], body: v("x") };
    const out = emitMany(fnDef, ["js", "not-a-real-language"]);
    assert.strictEqual(out.js.error, null);
    assert.strictEqual(out["not-a-real-language"].source, null);
    assert.match(out["not-a-real-language"].error, /no emitter registered for language "not-a-real-language"/);
});

test("emitAll() (deprecated) never throws anymore -- a single emitter's failure no longer takes the whole batch down", () => {
    const fnDef = { name: "f", params: ["x"], body: letIn("LEN", num(1), v("LEN")) };
    const out = emitAll(fnDef);
    assert.strictEqual(out.qb64.source, null);
    assert.match(out.qb64.error, /"LEN" is a reserved QB64 builtin/);
    assert.strictEqual(out.js.error, null);
    assert.match(out.js.source, /function f/);
});

test("emitAll() still covers every registered language, same as before", () => {
    const fnDef = { name: "f", params: ["x"], body: v("x") };
    const out = emitAll(fnDef);
    assert.deepStrictEqual(Object.keys(out).sort(), Object.keys(emitters).sort());
});
