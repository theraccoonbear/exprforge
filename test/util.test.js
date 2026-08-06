// exprforge/test/util.test.js
//
// util.js holds authoring conveniences, not AST primitives (see ast.js) —
// these tests check their own small contract directly, since
// samples/spline-frame.js's conformance tests only exercise forComponents
// indirectly (through its output, not its own behavior).

const test = require("node:test");
const assert = require("node:assert");
const { forComponents } = require("../util.js");

test("forComponents: maps each axis through templateFn, in order", () => {
    const result = forComponents(["X", "Y", "Z"], (axis) => axis.toLowerCase());
    assert.deepStrictEqual(result, ["x", "y", "z"]);
});

test("forComponents: passes index and the full array through, like Array.map", () => {
    const seen = [];
    forComponents(["a", "b"], (axis, i, arr) => seen.push([axis, i, arr.length]));
    assert.deepStrictEqual(seen, [
        ["a", 0, 2],
        ["b", 1, 2],
    ]);
});

test("forComponents: empty axes produces an empty array", () => {
    assert.deepStrictEqual(forComponents([], (axis) => axis), []);
});

test("forComponents: templateFn returning {name, params, body} objects round-trips untouched", () => {
    const defs = forComponents(["X", "Y"], (axis) => ({
        name: `Fn${axis}`,
        params: ["t"],
        body: { type: "var", name: "t" },
    }));
    assert.strictEqual(defs.length, 2);
    assert.strictEqual(defs[0].name, "FnX");
    assert.strictEqual(defs[1].name, "FnY");
    assert.deepStrictEqual(defs[0].params, ["t"]);
    assert.deepStrictEqual(defs[0].body, { type: "var", name: "t" });
});
