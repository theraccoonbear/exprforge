// exprforge/test/duplicates.test.js
//
// findDuplicateSubexpressions() -- see duplicates.js. Advisory detection
// only, so every claim here is checked by running the proposed macro:
// evaluating it on an occurrence's arguments must equal evaluating the
// occurrence itself. No emitter is touched, so there is no per-target
// behavior to cover; the proposed macro is also round-tripped through the
// "expr" printer and loadExprSource() to confirm it is real, loadable syntax.

const test = require("node:test");
const assert = require("node:assert");
const {
    fn, v, num, add, mul, letIn, evaluate, emit, loadExprSource, findDuplicateSubexpressions,
} = require("../index.js");

function wrap(params, body) {
    return { name: "w", params, body };
}

// Evaluates a node by wrapping it as a function over `names`, with `values`.
function evalNode(node, names, values) {
    return evaluate(wrap(names, node), values);
}

const SOURCE = `
    fn crossX(ay, az, by, bz):
    return ay * bz - az * by;

    fn otherX(qy, qz, ry, rz):
    return (qy * rz - qz * ry) * 2;

    fn unrelated(a, b):
    return a + b;
`;

test("detects the same shape under different variable names", () => {
    const defs = loadExprSource(SOURCE, "test");
    const found = findDuplicateSubexpressions(defs);
    assert.strictEqual(found.length, 1);
    const c = found[0];
    assert.strictEqual(c.size, 7);
    assert.match(c.name, /^shared_[0-9a-f]{8}$/);
    assert.deepStrictEqual(c.occurrences.map((o) => o.definition).sort(), ["crossX", "otherX"]);
    const byDef = Object.fromEntries(c.occurrences.map((o) => [o.definition, o.args]));
    assert.deepStrictEqual(byDef.crossX, ["ay", "bz", "az", "by"]);
    assert.deepStrictEqual(byDef.otherX, ["qy", "rz", "qz", "ry"]);
    assert.deepStrictEqual(c.macro.params, ["p0", "p1", "p2", "p3"]);
});

test("the proposed macro computes exactly what each occurrence computes", () => {
    const defs = loadExprSource(SOURCE, "test");
    const [c] = findDuplicateSubexpressions(defs);
    const sample = { ay: 1.5, az: -2, by: 0.25, bz: 7, qy: 3, qz: 4, ry: -1, rz: 0.5 };
    for (const o of c.occurrences) {
        const values = o.args.map((n) => sample[n]);
        assert.strictEqual(
            evalNode(c.macro.body, c.macro.params, values),
            evalNode(o.node, o.args, values),
        );
    }
});

test("the proposed macro prints as expr syntax and loads back", () => {
    const [c] = findDuplicateSubexpressions(loadExprSource(SOURCE, "test"));
    const printed = emit(c.macro, "expr").source;
    const reloaded = loadExprSource(printed, "printed");
    assert.deepStrictEqual(Object.keys(reloaded), [c.name]);
    assert.strictEqual(evaluate(reloaded[c.name], [1, 2, 3, 4]), evaluate(c.macro, [1, 2, 3, 4]));
});

test("variable repetition pattern matters: x*x+... does not match x*y+...", () => {
    const sq = { name: "sq", params: ["x", "y"], body: add(add(mul(v("x"), v("x")), v("y")), num(1)) };
    const mixed = { name: "mixed", params: ["x", "y"], body: add(add(mul(v("x"), v("y")), v("y")), num(1)) };
    assert.deepStrictEqual(findDuplicateSubexpressions([sq, mixed], { minSize: 3 }).map((c) => c.size), []);
});

test("operators, literals and call names must match", () => {
    const a = fn`a(x, y): return sqrt(x * y + 1);`;
    const b = fn`b(x, y): return sqrt(x * y + 2);`;
    const c = fn`c(x, y): return sin(x * y + 1);`;
    const d = fn`d(p, q): return sqrt(p * q + 1);`;
    const pair = (l, r) => findDuplicateSubexpressions([l, r], { minSize: 6 });
    assert.strictEqual(pair(a, b).length, 0);
    assert.strictEqual(pair(a, c).length, 0);
    assert.strictEqual(pair(a, d).length, 1);
});

test("let-bound names are renamed away; only free variables become parameters", () => {
    const a = { name: "a", params: ["x"], body: letIn("t", add(v("x"), num(1)), mul(v("t"), add(v("t"), v("x")))) };
    const b = { name: "b", params: ["z"], body: letIn("u", add(v("z"), num(1)), mul(v("u"), add(v("u"), v("z")))) };
    const [c] = findDuplicateSubexpressions([a, b]);
    assert.ok(c);
    assert.deepStrictEqual(c.macro.params, ["p0"]);
    for (const x of [0, 2, -3.5]) {
        assert.strictEqual(evaluate(c.macro, [x]), evaluate(a, [x]));
    }
});

test("only the maximal match is reported, not each sub-piece of it", () => {
    const defs = loadExprSource(SOURCE, "test");
    const found = findDuplicateSubexpressions(defs, { minSize: 3 });
    assert.deepStrictEqual(found.map((c) => c.size), [7]);
});

test("a repeat inside a single definition is not reported", () => {
    const one = fn`one(a, b): return (a * b - a / b) + (a * b - a / b);`;
    assert.deepStrictEqual(findDuplicateSubexpressions([one]), []);
});

test("minSize filters small matches and defaults to 5", () => {
    const a = fn`a(x, y): return x * y + 1;`;
    const b = fn`b(p, q): return p * q + 1;`;
    assert.strictEqual(findDuplicateSubexpressions([a, b]).length, 1);
    assert.strictEqual(findDuplicateSubexpressions([a, b], { minSize: 5 }).length, 1);
    assert.strictEqual(findDuplicateSubexpressions([a, b], { minSize: 6 }).length, 0);
    const small = (x) => fn`s(x, y): return x + y;`;
    assert.strictEqual(findDuplicateSubexpressions([small(), { ...small(), name: "t" }]).length, 0);
});

test("select and cmp subtrees are compared structurally, including the operator", () => {
    const a = fn`a(x, y): return x > y ? x - y : y - x;`;
    const b = fn`b(p, q): return p > q ? p - q : q - p;`;
    const c = fn`c(p, q): return p < q ? p - q : q - p;`;
    assert.strictEqual(findDuplicateSubexpressions([a, b], { minSize: 7 }).length, 1);
    assert.strictEqual(findDuplicateSubexpressions([a, c], { minSize: 7 }).length, 0);
});

test("accepts an array or a loadExprSource-style object, and does not mutate input", () => {
    const defs = loadExprSource(SOURCE, "test");
    const before = JSON.stringify(defs);
    const fromObj = findDuplicateSubexpressions(defs);
    const fromArr = findDuplicateSubexpressions(Object.values(defs));
    assert.strictEqual(JSON.stringify(defs), before);
    assert.strictEqual(fromObj[0].name, fromArr[0].name);
});

test("rejects bad input clearly", () => {
    assert.throws(() => findDuplicateSubexpressions(null), /defs must be/);
    assert.throws(() => findDuplicateSubexpressions([{ name: "x" }]), /\{ name, params, body \}/);
    const d = fn`d(x): return x;`;
    assert.throws(() => findDuplicateSubexpressions([d, d]), /duplicate definition name "d"/);
    assert.throws(() => findDuplicateSubexpressions([d], { minSize: 0 }), /minSize/);
});
