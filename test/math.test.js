// exprforge/test/math.test.js
//
// Structural unit tests for math/index.js -- mirrors test/ast.test.js's
// style (checking node shapes directly), since these helpers are pure
// compositions of ast.js's builders with no emitter-specific behavior of
// their own. Full numeric, cross-language verification lives in
// test/conformance.test.js via samples/math-demo.js.

const test = require("node:test");
const assert = require("node:assert");
const { num, v, add, mul, sub, div, call, letIn, cmp, select, outputs, collectLets } = require("../ast.js");
const { EPS, safeDiv, dot3, len3, cross3, normalize3, clamp } = require("../math/index.js");

test("EPS is num(0.000001)", () => {
    assert.deepStrictEqual(EPS, num(0.000001));
});

test("dot3 builds ax*bx + ay*by + az*bz", () => {
    const node = dot3(v("ax"), v("ay"), v("az"), v("bx"), v("by"), v("bz"));
    assert.deepStrictEqual(node, add(mul(v("ax"), v("bx")), mul(v("ay"), v("by")), mul(v("az"), v("bz"))));
});

test("len3 wraps dot3(x,y,z,x,y,z) in a sqrt call", () => {
    const node = len3(v("x"), v("y"), v("z"));
    assert.strictEqual(node.type, "call");
    assert.strictEqual(node.name, "sqrt");
    assert.strictEqual(node.args.length, 1);
    assert.deepStrictEqual(node.args[0], dot3(v("x"), v("y"), v("z"), v("x"), v("y"), v("z")));
});

test("cross3 returns a plain {x,y,z} object of AST nodes, not an AST node itself", () => {
    const result = cross3(v("ax"), v("ay"), v("az"), v("bx"), v("by"), v("bz"));
    assert.strictEqual(result.type, undefined, "cross3's return value itself must not look like a Node");
    assert.deepStrictEqual(result.x, sub(mul(v("ay"), v("bz")), mul(v("az"), v("by"))));
    assert.deepStrictEqual(result.y, sub(mul(v("az"), v("bx")), mul(v("ax"), v("bz"))));
    assert.deepStrictEqual(result.z, sub(mul(v("ax"), v("by")), mul(v("ay"), v("bx"))));
});

test("clamp expands to nested select/cmp, no intrinsic call", () => {
    const node = clamp(v("t"), num(0), num(1));
    assert.deepStrictEqual(
        node,
        select(cmp(v("t"), "<", num(0)), num(0), select(cmp(v("t"), ">", num(1)), num(1), v("t"))),
    );
});

test("safeDiv clamps the denominator before dividing, never guards the division directly", () => {
    const node = safeDiv(v("n"), v("d"), num(-1));
    const isSafe = cmp(call("abs", v("d")), ">", EPS);
    assert.deepStrictEqual(node, select(isSafe, div(v("n"), select(isSafe, v("d"), num(1))), num(-1)));
});

test("normalize3 returns {x,y,z}; x carries a let-bound shared length, y/z reference it bare", () => {
    const { x, y, z } = normalize3(v("dx"), v("dy"), v("dz"));

    assert.strictEqual(x.type, "let", "x should carry the let-bound shared length (see math/index.js)");
    const lenName = x.name;
    assert.deepStrictEqual(x.value, len3(v("dx"), v("dy"), v("dz")));
    assert.deepStrictEqual(x.body, safeDiv(v("dx"), v(lenName), num(0)));

    // y and z don't repeat the letIn -- they just reference the same
    // hoisted name, relying on collectLets to have already declared it
    // (confirmed structurally here, and end-to-end via collectLets below).
    assert.deepStrictEqual(y, safeDiv(v("dy"), v(lenName), num(1)));
    assert.deepStrictEqual(z, safeDiv(v("dz"), v(lenName), num(0)));
});

test("normalize3 honors a custom fallback tuple", () => {
    const { x, y, z } = normalize3(v("dx"), v("dy"), v("dz"), num(1), num(0), num(0));
    assert.deepStrictEqual(x.body, safeDiv(v("dx"), v(x.name), num(1)));
    assert.deepStrictEqual(y, safeDiv(v("dy"), v(x.name), num(0)));
    assert.deepStrictEqual(z, safeDiv(v("dz"), v(x.name), num(0)));
});

test("two normalize3() calls in the same function don't collide on their internal let name", () => {
    const a = normalize3(v("ax"), v("ay"), v("az"));
    const b = normalize3(v("bx"), v("by"), v("bz"));
    assert.notStrictEqual(a.x.name, b.x.name, "each normalize3() call must pick a distinct binding name");

    // End-to-end: combining both into one outputs() suite and running it
    // through the real collectLets must not throw "duplicate let binding
    // name" -- this is the actual failure mode a fixed (non-gensym'd)
    // binding name would hit, and is exactly what samples/math-demo.js
    // does for real cross-language coverage.
    const suite = outputs({
        aX: a.x, aY: a.y, aZ: a.z,
        bX: b.x, bY: b.y, bZ: b.z,
    });
    assert.doesNotThrow(() => collectLets(suite));
    const { bindings } = collectLets(suite);
    const names = bindings.map((binding) => binding.name);
    assert.strictEqual(new Set(names).size, names.length, "no duplicate binding names");
});
