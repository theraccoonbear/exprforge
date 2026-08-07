// exprforge/test/yaml.test.js
//
// toYAML/fromYAML are a storage/interop layer, not an authoring surface
// (see yaml.js's header comment) -- these tests check round-tripping and
// that malformed YAML fails with a clear, path-qualified error rather than
// deep inside an emitter later.

const test = require("node:test");
const assert = require("node:assert");
const { num, v, bin, call, letIn, cmp, select, toYAML, fromYAML, catmullRomAst, emitters } = require("../index.js");

test("round-trips a real sample (catmullRomAst) through YAML unchanged", () => {
    const text = toYAML(catmullRomAst);
    const back = fromYAML(text);
    assert.deepStrictEqual(back, catmullRomAst);
});

test("round-trips let/cmp/select through YAML, and the result still emits correctly", () => {
    const original = {
        name: "normalizeX",
        params: ["x", "y"],
        body: letIn(
            "len",
            call("sqrt", bin("+", bin("*", v("x"), v("x")), bin("*", v("y"), v("y")))),
            select(cmp(v("len"), ">", num(1e-9)), bin("/", v("x"), v("len")), num(0)),
        ),
    };
    const back = fromYAML(toYAML(original));
    assert.deepStrictEqual(back, original);
    // and it's not just structurally equal -- it still actually emits.
    assert.strictEqual(emitters.js.emitFunction(back), emitters.js.emitFunction(original));
});

test("round-trips an array of function definitions", () => {
    const defs = [
        { name: "f", params: ["x"], body: v("x") },
        { name: "g", params: ["y"], body: num(1) },
    ];
    assert.deepStrictEqual(fromYAML(toYAML(defs)), defs);
});

test("fromYAML rejects an unknown node type with a path-qualified message", () => {
    const text = `
name: bad
params: [x]
body:
  type: nonsense
  value: 1
`;
    assert.throws(() => fromYAML(text), /invalid AST at <root>\.body: unknown node type "nonsense"/);
});

test("fromYAML rejects a bin node with a missing operand", () => {
    const text = `
name: bad
params: [x]
body:
  type: bin
  op: "+"
  left: { type: var, name: x }
`;
    assert.throws(() => fromYAML(text), /invalid AST at <root>\.body\.right: expected a node object/);
});

test("fromYAML rejects a select whose cond isn't a cmp node", () => {
    const text = `
name: bad
params: [x]
body:
  type: select
  cond: { type: num, value: 1 }
  then: { type: num, value: 2 }
  else: { type: num, value: 3 }
`;
    assert.throws(() => fromYAML(text), /select" cond must be a "cmp" node/);
});

test("fromYAML rejects a function definition with no params array", () => {
    const text = `
name: bad
body: { type: num, value: 1 }
`;
    assert.throws(() => fromYAML(text), /"params" must be an array of strings/);
});

test("toYAML produces human-readable block-style YAML, not a flow-style one-liner", () => {
    const text = toYAML({ name: "f", params: ["x"], body: v("x") });
    assert.ok(text.includes("\n"), "expected multi-line block-style output");
    assert.ok(!text.trim().startsWith("{"), "expected block style, not flow/JSON style");
});
