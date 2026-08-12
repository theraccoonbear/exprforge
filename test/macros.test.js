// exprforge/test/macros.test.js
//
// Structural + integration tests for macros.js -- loadMacro()/
// loadExtern() and expandMacros(), which every one of
// evaluate()/emitter.emitFunction()/loadExpr() already runs internally
// (see that file's own header comment). Every test here registers a
// uniquely-named throwaway macro/extern (loadMacro/loadExtern throw on a
// duplicate/reused name -- there's no reset hook, by design, see
// macros.js) to stay independent of test execution order.

const test = require("node:test");
const assert = require("node:assert");
const {
    num, v, mul, add, sub, div, call, letIn, field,
} = require("../ast.js");
const { fn } = require("../fn.js");
const { evaluate, emitters, loadMacro, loadExtern, expandMacros } = require("../index.js");

let n = 0;
function uniqueName(base) {
    return `${base}${n++}`;
}

// --- registration ------------------------------------------------------

test("loadMacro rejects a name colliding with a built-in primitive", () => {
    assert.throws(() => loadMacro("sqrt", (x) => x), /"sqrt" is already one of the built-in primitives/);
});

test("loadExtern rejects a name colliding with a built-in primitive", () => {
    assert.throws(() => loadExtern("sqrt", { evaluate: (x) => x }), /"sqrt" is already one of the built-in primitives/);
});

test("loadMacro rejects re-registering the same name twice", () => {
    const name = uniqueName("dupe");
    loadMacro(name, (x) => x);
    assert.throws(() => loadMacro(name, (x) => x), new RegExp(`"${name}" is already registered`));
});

test("a name is shared across loadMacro and loadExtern -- registering one blocks the other", () => {
    const name = uniqueName("dupe");
    loadMacro(name, (x) => x);
    assert.throws(() => loadExtern(name, { evaluate: (x) => x }), new RegExp(`"${name}" is already registered`));
});

test("loadMacro rejects a def that's neither a function nor an AST fn-def", () => {
    assert.throws(() => loadMacro(uniqueName("bad"), 42), /"def" for "bad\d+" must be a function/);
    assert.throws(() => loadMacro(uniqueName("bad"), null), /"def" for "bad\d+" must be a function/);
    assert.throws(() => loadMacro(uniqueName("bad"), { js: () => "x" }), /"def" for "bad\d+" must be a function/);
});

test("loadExtern rejects a def that isn't a plain object", () => {
    assert.throws(() => loadExtern(uniqueName("bad"), (x) => x), /"def" for "bad\d+" must be a plain per-target mapping object/);
    assert.throws(() => loadExtern(uniqueName("bad"), 42), /"def" for "bad\d+" must be a plain per-target mapping object/);
});

// --- macro: plain JS function, single value -----------------------------

test("a macro (single value) splices its result directly, no leftover call node", () => {
    const name = uniqueName("double");
    loadMacro(name, (x) => mul(x, num(2)));
    const node = call(name, v("a"));
    const expanded = expandMacros(node);
    assert.deepStrictEqual(expanded, mul(v("a"), num(2)));
});

test("a macro works from fn`...` template text, end to end through evaluate()", () => {
    const name = uniqueName("triple");
    loadMacro(name, (x) => mul(x, num(3)));
    // fn's own `${...}` interpolation only splices AST nodes/numbers
    // (see expr.js's holeToNode), never raw identifier text -- a
    // dynamically-generated call NAME has to go into the source text
    // itself, so this builds it with a plain JS template literal first
    // and calls fn as an ordinary function (fn(strings, ...values), no
    // values here), same as useExprForge.ts's fn([source]) does.
    const def = fn([`
        f(a):
        return ${name}(a) + 1;
    `]);
    assert.strictEqual(evaluate(def, [10]), 31);
});

test("a macro's own internal let-bindings get hoisted normally (collectLets sees them)", () => {
    const name = uniqueName("halfPlusOne");
    loadMacro(name, (x) => letIn("half", div(x, num(2)), add(v("half"), num(1))));
    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    assert.strictEqual(evaluate(def, [10]), 6);
});

test("a plain-JS macro that self-manages hygiene (own gensym) doesn't collide across repeated calls", () => {
    // Unlike an AST fn-def macro (which gets automatic alpha-renaming on
    // every call -- see toMacro in macros.js), a plain JS function is
    // called directly with NO automatic rename: if it introduces its own
    // internal let, IT has to gensym that name itself to stay
    // collision-free across repeated/nested uses -- exactly the pattern
    // math/index.js's real normalize3 already follows (see its own
    // comment there).
    let counter = 0;
    const name = uniqueName("selfHygienicSq");
    loadMacro(name, (x) => {
        const tmpName = `tmp${counter++}`;
        return letIn(tmpName, x, mul(v(tmpName), v(tmpName)));
    });
    const def = { name: "f", params: ["a", "b"], body: add(call(name, v("a")), call(name, v("b"))) };
    assert.strictEqual(evaluate(def, [3, 4]), 25);
});

test("a plain-JS macro that DOESN'T self-manage hygiene collides across repeated calls, same as hand-written code would", () => {
    const name = uniqueName("carelessSq");
    loadMacro(name, (x) => letIn("tmp", x, mul(v("tmp"), v("tmp"))));
    const def = { name: "f", params: ["a", "b"], body: add(call(name, v("a")), call(name, v("b"))) };
    assert.throws(() => evaluate(def, [3, 4]), /duplicate let binding name "tmp"/);
});

test("a plain-JS macro used twice, independently, in one function is fine -- NOT mistaken for a self-cycle", () => {
    // Regression guard for the cycle detector below: sqrt(x) + foo(a) +
    // foo(b) (two unrelated invocations of the same macro) must not trip
    // the "can't call itself" guard just because the same name appears
    // twice.
    const name = uniqueName("independentUses");
    loadMacro(name, (x) => mul(x, num(2)));
    const def = { name: "f", params: ["a", "b"], body: add(call(name, v("a")), call(name, v("b"))) };
    assert.strictEqual(evaluate(def, [3, 4]), 14);
});

test("a plain-JS macro can be nested inside itself -- X(X(a)) is two independent calls, not a cycle", () => {
    const name = uniqueName("nestedUse");
    loadMacro(name, (x) => mul(x, num(2)));
    const def = { name: "f", params: ["a"], body: call(name, call(name, v("a"))) };
    assert.strictEqual(evaluate(def, [3]), 12);
});

test("a plain-JS macro whose OWN result calls itself back throws a clear error, not a stack overflow", () => {
    // Unlike an AST-fn-def macro (whose self-reference is ruled out
    // structurally by registration ordering, see toMacro), a plain-JS
    // macro's result is legitimately re-walked on every use (it has to
    // be -- a fresh call can reference some other real macro) -- so a
    // function that always calls its own registered name needs its own
    // explicit cycle guard. This was a real bug once: it stack-overflowed
    // instead of failing cleanly.
    const name = uniqueName("selfCyclePlain");
    loadMacro(name, (x) => call(name, x));
    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    assert.throws(() => evaluate(def, [1]), new RegExp(`"${name}" can't call itself, directly or through a cycle`));
});

test("two plain-JS macros calling each other back and forth (mutual cycle) throw the same clear error", () => {
    const nameA = uniqueName("mutualPlainA");
    const nameB = uniqueName("mutualPlainB");
    loadMacro(nameA, (x) => call(nameB, x));
    loadMacro(nameB, (x) => call(nameA, x));
    const def = { name: "f", params: ["a"], body: call(nameA, v("a")) };
    assert.throws(() => evaluate(def, [1]), /can't call itself, directly or through a cycle/);
});

// --- macro: plain JS function, multi-output + field access --------------

test("a multi-output macro must be bound via let, then accessed by field", () => {
    const name = uniqueName("splitSum");
    loadMacro(name, (a, b) => ({ sum: add(a, b), doubled: mul(add(a, b), num(2)) }));
    // See the identical fn([...]) note above -- the macro name is
    // dynamic, so it goes into the source text via a JS template
    // literal, not fn's own ${...} interpolation.
    const def = fn([`
        f(a, b):
        let r = ${name}(a, b);
        return r.sum + r.doubled;
    `]);
    // (a+b) + (a+b)*2 == 3*(a+b)
    assert.strictEqual(evaluate(def, [2, 5]), 21);
});

test("using a multi-output macro bare (not let-bound) throws a clear error", () => {
    const name = uniqueName("splitSum");
    loadMacro(name, (a, b) => ({ sum: add(a, b) }));
    const node = mul(call(name, num(1), num(2)), num(3));
    assert.throws(() => expandMacros(node), new RegExp(`"${name}\\(\\.\\.\\.\\)" returns multiple named outputs`));
});

test("accessing an unknown field on a multi-output macro result throws, listing the real fields", () => {
    const name = uniqueName("splitSum");
    loadMacro(name, (a, b) => ({ sum: add(a, b), diff: sub(a, b) }));
    const def = { name: "f", params: ["a", "b"], body: letIn("r", call(name, v("a"), v("b")), field(v("r"), "nope")) };
    assert.throws(() => expandMacros(def), /"r\.nope".*has: sum, diff/s);
});

test("field access on a plain variable (never bound to a macro result) throws", () => {
    const def = { name: "f", params: ["x"], body: field(v("x"), "anything") };
    assert.throws(() => expandMacros(def), /"x\.anything" -- "x" isn't bound to a multi-output macro result/);
});

test("cross3/rodrigues-shaped composition: two macros, one referencing fields of the other's result", () => {
    // Mirrors issue #21's own worked example shape (cross3 then a
    // consumer reading .rx/.ry/.rz), using throwaway registered names
    // instead of exprforge/math's real cross3 to stay independent of
    // that module's own tests.
    const crossName = uniqueName("cross3Like");
    loadMacro(crossName, (ax, ay, az, bx, by, bz) => ({
        rx: sub(mul(ay, bz), mul(az, by)),
        ry: sub(mul(az, bx), mul(ax, bz)),
        rz: sub(mul(ax, by), mul(ay, bx)),
    }));
    const def = fn([`
        f(ax, ay, az, bx, by, bz):
        let b = ${crossName}(ax, ay, az, bx, by, bz);
        return sqrt(b.rx^2 + b.ry^2 + b.rz^2);
    `]);
    // (1,0,0) x (0,1,0) = (0,0,1), length 1.
    assert.strictEqual(evaluate(def, [1, 0, 0, 0, 1, 0]), 1);
});

// --- macro: AST fn-def ---------------------------------------------------

test("loadMacro accepts an AST {name, params, body} def directly, with arity enforced", () => {
    const name = uniqueName("astDouble");
    loadMacro(name, fn([`${name}(x): return x * 2;`]));
    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    assert.strictEqual(evaluate(def, [21]), 42);
    assert.throws(
        () => expandMacros({ name: "g", params: [], body: call(name, num(1), num(2)) }),
        new RegExp(`"${name}" expects 1 argument\\(s\\), got 2`),
    );
});

test("an AST fn-def macro's own internal lets are alpha-renamed on every call, no collisions", () => {
    const name = uniqueName("astSq");
    loadMacro(name, fn([`${name}(x): let tmp = x; return tmp * tmp;`]));
    const def = { name: "f", params: ["a", "b"], body: add(call(name, v("a")), call(name, v("b"))) };
    assert.strictEqual(evaluate(def, [3, 4]), 25);
});

test("an AST fn-def macro returning a multi-output (own let-chain wrapping outputs()) works via field access", () => {
    // Regression test for a real bug: an AST fn-def whose outputs() is
    // wrapped in its own let-chain (like cross3 written in fn-DSL text --
    // "let rx = ...; let ry = ...; let rz = ...; return { rx, ry, rz };")
    // was misdetected as a single value, since only the OUTERMOST node's
    // type was checked ("let", not "outputs"). See toMacro in macros.js.
    const name = uniqueName("crossAst");
    loadMacro(name, fn([`
        ${name}(ax, ay, az, bx, by, bz):
        let rx = ay * bz - az * by;
        let ry = az * bx - ax * bz;
        let rz = ax * by - ay * bx;
        return { rx, ry, rz };
    `]));
    const def = { name: "f", params: ["ax", "ay", "az", "bx", "by", "bz"], body: letIn("c", call(name, v("ax"), v("ay"), v("az"), v("bx"), v("by"), v("bz")), field(v("c"), "rz")) };
    // (1,0,0) x (0,1,0) = (0,0,1) -- .rz == 1.
    assert.strictEqual(evaluate(def, [1, 0, 0, 0, 1, 0]), 1);
});

test("a self-referencing AST fn-def can't be registered as its own macro (no recursion)", () => {
    // Registering "self" while its OWN body already calls "self" leaves
    // that inner call unresolved (macro lookup can't find a name that
    // isn't registered yet) -- it survives expansion as a plain,
    // unmapped "call" node, which evaluate()/every emitter then reject
    // with their ordinary "no mapping" error. No special-cased recursion
    // detection exists (or needs to) -- the ordering alone rules it out,
    // and the leftover unresolved call node is never re-examined against
    // the registry again later, even after "self" DOES become
    // registered (see alreadyExpanded in macros.js) -- otherwise this
    // would recurse without bound instead of failing cleanly.
    const name = uniqueName("selfRef");
    loadMacro(name, fn([`${name}(x): return ${name}(x) + 1;`]));
    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    assert.throws(() => evaluate(def, [1]), new RegExp(`no mapping for Math function "${name}"`));
});

test("mutual (A calls not-yet-defined B) references fail the same clean way -- forward references aren't resolved either", () => {
    const nameA = uniqueName("mutualA");
    const nameB = uniqueName("mutualB");
    loadMacro(nameA, fn([`${nameA}(x): return ${nameB}(x) + 1;`])); // B isn't registered yet
    loadMacro(nameB, fn([`${nameB}(x): return x * 2;`]));
    const def = { name: "f", params: ["a"], body: call(nameA, v("a")) };
    // A's own reference to B was resolved (attempted) BEFORE B existed,
    // so it stays a permanently-unmapped call, even though B is fully
    // registered and callable on its own by the time this runs.
    assert.throws(() => evaluate(def, [1]), new RegExp(`no mapping for Math function "${nameB}"`));
    assert.strictEqual(evaluate({ name: "g", params: ["a"], body: call(nameB, v("a")) }, [5]), 10);
});

// --- extern ---------------------------------------------------------

test("an extern resolves through evaluate() via its \"evaluate\" entry", () => {
    const name = uniqueName("externSq");
    loadExtern(name, { evaluate: (x) => x * x });
    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    assert.strictEqual(evaluate(def, [6]), 36);
});

test("an extern resolves through an emitter only for the language(s) it was given", () => {
    const name = uniqueName("externLib");
    loadExtern(name, { js: ([x]) => `myLib.${name}(${x})` });
    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    assert.match(emitters.js.emitFunction(def), new RegExp(`myLib\\.${name}\\(a\\)`));
    assert.throws(() => emitters.python.emitFunction(def), new RegExp(`no mapping for Math function "${name}"`));
});

test("an extern's call node is left alone by expandMacros -- resolved later, not expanded", () => {
    const name = uniqueName("externPassthrough");
    loadExtern(name, { js: ([x]) => `f(${x})` });
    const node = call(name, v("x"));
    assert.deepStrictEqual(expandMacros({ name: "f", params: ["x"], body: node }).body, node);
});

// --- dual shapes / integration -------------------------------------------

test("expandMacros accepts a bare Node (no signature) and returns a bare Node back", () => {
    const name = uniqueName("bareDouble");
    loadMacro(name, (x) => mul(x, num(2)));
    const node = call(name, v("x"));
    const expanded = expandMacros(node);
    assert.strictEqual(expanded.type, "bin");
    assert.deepStrictEqual(expanded, mul(v("x"), num(2)));
});

test("a tree with no macro/field usage at all passes through expandMacros completely unchanged", () => {
    const def = { name: "f", params: ["x", "y"], body: letIn("s", add(v("x"), v("y")), call("sqrt", v("s"))) };
    assert.deepStrictEqual(expandMacros(def), def);
});

test("expansion runs before checkUnboundVars -- a macro's own flattened let names don't count as unbound", () => {
    const name = uniqueName("halfAgain");
    loadMacro(name, (x) => letIn("half", div(x, num(2)), v("half")));
    const def = { name: "f", params: ["a"], body: call(name, v("a")) };
    // Would throw "unbound variable" if checkUnboundVars ran on the
    // UNEXPANDED tree (which references no "half" at all yet); every
    // real consumer (evaluate/emitFunction) runs expandMacros first.
    assert.strictEqual(evaluate(def, [10]), 5);
    assert.match(emitters.js.emitFunction(def), /half/);
});
