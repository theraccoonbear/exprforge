const test = require("node:test");
const assert = require("node:assert");
const { v, num, call, add } = require("../ast.js");
const emitters = require("../emitters/registry.js");

const UNARY = ["sqrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan", "log", "log2", "log10", "exp", "floor", "ceil", "trunc", "sign", "round"];
const BINARY = ["hypot", "pow", "atan2", "min", "max"];

function emitted(body, params = ["x", "y"]) {
    return emitters.csharp.emitFunction({ type: "function", name: "f", params, body });
}

test("C# output references Math only as global::System.Math and needs no using", () => {
    const terms = [
        ...UNARY.map((p) => call(p, v("x"))),
        ...BINARY.map((p) => call(p, v("x"), v("y"))),
    ];
    const src = emitted(terms.reduce((a, b) => add(a, b)));
    assert.ok(!/^\s*using\s/m.test(src));
    const code = src.replace(/\/\/.*$/gm, "");
    assert.ok(!/(^|[^.\w])Math\./.test(code), "unqualified Math. found");
    assert.ok(code.includes("global::System.Math.Log2("));
    assert.ok(!code.includes("Math.Clamp"));
});

test("C# clampIndex uses Max/Min, matching evaluate()", () => {
    const src = emitted(call("clampIndex", v("i"), num(0), num(9)), ["i"]);
    assert.ok(src.includes("global::System.Math.Max(0d, global::System.Math.Min(9d, i))"));
});
