// exprforge/test/ast.test.js
//
// Structural unit tests for ast.js itself -- previously only exercised
// indirectly through samples/conformance tests. Focused on outputs()/
// collectLets, the newest and least-covered interaction.

const test = require("node:test");
const assert = require("node:assert");
const { num, v, add, mul, sub, letIn, letChain, outputs, collectLets } = require("../ast.js");

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

test("letChain([[a,..],[b,..]], body) builds the same tree as hand-nested letIn", () => {
    const chained = letChain(
        [
            ["a", num(1)],
            ["b", add(v("a"), num(1))],
        ],
        v("b"),
    );
    const handNested = letIn("a", num(1), letIn("b", add(v("a"), num(1)), v("b")));
    assert.deepStrictEqual(chained, handNested);
});

test("letChain: first pair is outermost, last pair is innermost (closest to body)", () => {
    const chained = letChain(
        [
            ["a", num(1)],
            ["b", num(2)],
            ["c", num(3)],
        ],
        v("c"),
    );
    assert.strictEqual(chained.name, "a");
    assert.strictEqual(chained.body.name, "b");
    assert.strictEqual(chained.body.body.name, "c");
    assert.deepStrictEqual(chained.body.body.body, v("c"));
});

test("letChain with an empty bindings array returns body unchanged", () => {
    const body = add(num(1), num(2));
    assert.deepStrictEqual(letChain([], body), body);
});

test("letChain output round-trips through collectLets exactly like hand-nested letIn", () => {
    const chained = letChain(
        [
            ["s", add(v("x"), v("y"))],
            ["d", sub(v("x"), v("y"))],
        ],
        outputs({ sum: v("s"), diff: v("d") }),
    );
    const { bindings, body } = collectLets(chained);
    assert.deepStrictEqual(
        bindings.map((b) => b.name),
        ["s", "d"],
    );
    assert.strictEqual(body.type, "outputs");
});
