// exprforge/test/session.test.js
//
// createSession() -- see index.js's own doc comment and macros.js's
// createRegistry(). A session bundles a private, independently-
// namespaced {macros, externs} registry with loadMacro/loadExtern/
// evaluate/emit/emitMany/loadExpr/loadExprSource bound to use it instead
// of the process-wide default registry every bare loadMacro()/etc. call
// (see test/macros.test.js) uses. The whole point under test here:
// isolation in BOTH directions -- a session's own registrations are
// invisible to the default registry and to every OTHER session, and
// nothing registered globally (or in another session) leaks INTO a
// session either, except deliberately (a session can still call every
// built-in primitive, same as anything else).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { v, num, call } = require("../ast.js");
const { fn } = require("../fn.js");
const { createSession, loadMacro, evaluate: globalEvaluate, emit: globalEmit } = require("../index.js");

let n = 0;
function uniqueName(base) {
    return `${base}${n++}`;
}

// --- a session's own registrations aren't visible globally --------------

test("a macro registered in a session isn't visible to the bare (global) evaluate()/emit()", () => {
    const session = createSession();
    const name = uniqueName("sessionOnly");
    session.loadMacro(name, (x) => x);

    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    // Bare evaluate()/emit() resolve against the process-wide default
    // registry -- this session's own Map was never touched, so the name
    // is simply unmapped there, same as any other unregistered call.
    assert.throws(() => globalEvaluate(def, [1]), /no mapping for Math function "sessionOnly\d+"/);
    assert.throws(() => globalEmit(def, "js"), /no mapping for Math function "sessionOnly\d+"/);
});

test("a macro registered in a session IS visible to that same session's own evaluate()/emit()", () => {
    const session = createSession();
    const name = uniqueName("sessionVisible");
    session.loadMacro(name, (x) => x);

    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    assert.strictEqual(session.evaluate(def, [7]), 7);
    const { source } = session.emit(def, "js");
    assert.match(source, /return a;/);
});

// --- two sessions don't leak into each other -----------------------------

test("two independent sessions don't see each other's macros, even when both use the SAME name", () => {
    const sessionA = createSession();
    const sessionB = createSession();
    const name = uniqueName("shared");

    // Same name, deliberately different bodies -- if these leaked into
    // one shared namespace, one registration would either collide (throw
    // "already registered") or silently shadow the other. Neither
    // happens: each session's Map is its own.
    sessionA.loadMacro(name, (x) => call("sqrt", x));
    sessionB.loadMacro(name, (x) => call("abs", x));

    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    assert.strictEqual(sessionA.evaluate(def, [9]), 3);
    assert.strictEqual(sessionB.evaluate(def, [-9]), 9);
});

test("registering the same name in two different sessions doesn't throw -- unlike reusing a name within one registry", () => {
    const sessionA = createSession();
    const sessionB = createSession();
    const name = uniqueName("noCollision");
    assert.doesNotThrow(() => sessionA.loadMacro(name, (x) => x));
    assert.doesNotThrow(() => sessionB.loadMacro(name, (x) => x));
});

// --- global registrations are still visible from inside a session -------
//
// Deliberately one-directional, not full mutual isolation: a session
// only gets its OWN registry for macros/externs it registers itself --
// built-in primitives (never registry-backed at all, see
// PRIMITIVE_NAMES in macros.js) work identically everywhere, session or
// not, since they're not namespaced by any registry to begin with.

test("a session can still call every built-in primitive normally", () => {
    const session = createSession();
    const def = { name: "f", params: ["a"], body: call("sqrt", v("a")) };
    assert.strictEqual(session.evaluate(def, [16]), 4);
});

// --- evaluate/emit/emitMany all resolve against the session's registry --

test("session.emitMany resolves a session-local macro for every target it's asked for", () => {
    const session = createSession();
    const name = uniqueName("multiTarget");
    session.loadMacro(name, (x) => call("abs", x));

    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    const results = session.emitMany(def, ["js", "python"]);
    assert.strictEqual(results.js.error, null);
    assert.strictEqual(results.python.error, null);
});

test("session.loadExtern registers into the session's own registry, resolved by session.evaluate/session.emit", () => {
    const session = createSession();
    const name = uniqueName("sessionExtern");
    session.loadExtern(name, { evaluate: (x) => x * 2, js: ([x]) => `(${x} * 2)` });

    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    assert.strictEqual(session.evaluate(def, [5]), 10);
    const { source } = session.emit(def, "js");
    assert.match(source, /\(a \* 2\)/);

    // Not visible globally, same as a session-registered macro.
    assert.throws(() => globalEvaluate(def, [5]), /no mapping for Math function "sessionExtern\d+"/);
});

// --- an AST-fn-def macro (fn`...`) registered in a session works too ----

test("session.loadMacro accepts an AST fn-def (fn`...`), same as the global loadMacro", () => {
    const session = createSession();
    const name = uniqueName("sessionFnDef");
    session.loadMacro(name, fn([`${name}(a, b): return a + b;`]));

    const def = { name: "f", params: ["x", "y"], body: call(name, v("x"), v("y")) };
    assert.strictEqual(session.evaluate(def, [3, 4]), 7);
});

// --- session.loadExpr/loadExprSource resolve against the session too ----

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exprforge-session-"));
function writeExpr(name, contents) {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, contents);
    return filePath;
}

test("session.loadExprSource resolves a session-local macro alongside definitions in the same source", () => {
    const session = createSession();
    const name = uniqueName("sessionExprSrc");
    session.loadMacro(name, (x) => call("abs", x));

    const defs = session.loadExprSource(`
        f(a):
        return ${name}(a);
    `);
    assert.strictEqual(session.evaluate(defs.f, [-5]), 5);
});

test("session.loadExpr (real file) resolves a session-local macro too", () => {
    const session = createSession();
    const name = uniqueName("sessionExprFile");
    session.loadMacro(name, (x) => call("abs", x));

    const filePath = writeExpr("session.expr", `
        f(a):
        return ${name}(a);
    `);
    const defs = session.loadExpr(filePath);
    assert.strictEqual(session.evaluate(defs.f, [-8]), 8);
});

// --- session.expandMacros exposes the expanded tree, same as the global one

test("session.expandMacros resolves session-local macros, leaving global-only ones unresolved", () => {
    const session = createSession();
    const sessionName = uniqueName("sessionExpand");
    const globalName = uniqueName("globalExpand");
    session.loadMacro(sessionName, (x) => x);
    loadMacro(globalName, (x) => x);

    const def = { name: "f", params: ["a"], body: call(sessionName, v("a")) };
    const expanded = session.expandMacros(def);
    // The session-local macro's call node is gone -- inlined to a bare
    // var() reference, same shape expandMacros() always produces for a
    // single-value macro whose body is just `x`.
    assert.deepStrictEqual(expanded.body, v("a"));

    // A macro registered in the GLOBAL registry is invisible to this
    // session's own expandMacros() -- left as an unresolved "call" node,
    // same as any other unmapped name would be.
    const defGlobal = { name: "g", params: ["a"], body: call(globalName, v("a")) };
    const expandedGlobal = session.expandMacros(defGlobal);
    assert.strictEqual(expandedGlobal.body.type, "call");
    assert.strictEqual(expandedGlobal.body.name, globalName);
});

// --- sessions are garbage-collected normally, no removal API needed -----

test("createSession() returns a fresh, independent registry every call -- nothing shared between two sessions' own state", () => {
    const sessionA = createSession();
    const sessionB = createSession();
    const name = uniqueName("freshEachTime");
    sessionA.loadMacro(name, (x) => x);
    // sessionB never registered `name` -- confirms createSession() isn't
    // accidentally returning/reusing one shared registry object across
    // calls (e.g. a module-level singleton mistakenly wired in instead
    // of a fresh createRegistry() per call).
    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    assert.throws(() => sessionB.evaluate(def, [1]), new RegExp(`no mapping for Math function "${name}"`));
});
