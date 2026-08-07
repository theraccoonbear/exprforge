// exprforge/test/ast.test.js
//
// Structural unit tests for ast.js itself -- previously only exercised
// indirectly through samples/conformance tests. Focused on outputs()/
// collectLets, the newest and least-covered interaction.

const test = require("node:test");
const assert = require("node:assert");
const { num, v, add, mul, letIn, outputs, collectLets } = require("../ast.js");

test("outputs() builds a plain {type, fields} node", () => {
    const node = outputs({ a: num(1), b: v("x") });
    assert.strictEqual(node.type, "outputs");
    assert.deepStrictEqual(node.fields, { a: num(1), b: v("x") });
});

test("collectLets recurses into an outputs node's fields", () => {
    const tree = letIn(
        "shared",
        num(10),
        outputs({
            a: add(v("shared"), num(1)),
            b: mul(v("shared"), num(2)),
        }),
    );
    const { bindings, body } = collectLets(tree);
    assert.strictEqual(bindings.length, 1);
    assert.strictEqual(bindings[0].name, "shared");
    assert.strictEqual(body.type, "outputs");
    // Field values pass through walk() same as any other node position --
    // in this case unchanged, since neither field contains its own let.
    assert.deepStrictEqual(body.fields.a, add(v("shared"), num(1)));
    assert.deepStrictEqual(body.fields.b, mul(v("shared"), num(2)));
});

test("collectLets hoists a let nested inside one output field's own value", () => {
    const tree = outputs({
        a: letIn("tmp", num(5), add(v("tmp"), num(1))),
        b: num(0),
    });
    const { bindings, body } = collectLets(tree);
    assert.strictEqual(bindings.length, 1);
    assert.strictEqual(bindings[0].name, "tmp");
    // The field's own let is gone, replaced by a reference to the hoisted name.
    assert.deepStrictEqual(body.fields.a, add(v("tmp"), num(1)));
});

test("collectLets still catches a duplicate let name when it's inside two different output fields", () => {
    const tree = outputs({
        a: letIn("x", num(1), v("x")),
        b: letIn("x", num(2), v("x")),
    });
    assert.throws(() => collectLets(tree), /duplicate let binding name "x"/);
});
