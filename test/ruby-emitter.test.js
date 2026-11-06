// exprforge/test/ruby-emitter.test.js
//
// Ruby-specific behavior that the shared conformance samples cannot reach:
// Ruby's Integer type (Integer / 0 raises, Integer / Integer truncates),
// constant-vs-local naming, and nil from an out-of-range Array#[].
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const { v, num, div, add, sub, mul, call, letIn } = require("../ast.js");
const { fn: parseFn } = require("../fn.js");
const emitters = require("../emitters/registry.js");

function hasRuby() {
    try {
        execFileSync("ruby", ["-v"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

const skip = !hasRuby() && "ruby not available";

function runRuby(ast, callExpr) {
    const source = emitters.ruby.emitFunction(ast);
    return execFileSync("ruby", ["-e", `${source}\nputs format("%.17g", ${callExpr})`]).toString().trim();
}

test("ruby: every numeric literal is emitted as a Float", () => {
    const src = emitters.ruby.emitFunction({ name: "f", params: ["x"], body: add(v("x"), num(5)) });
    assert.ok(src.includes("(x + 5.0)"), src);
});

test("ruby: scalar params are coerced with Float() but array params are not", () => {
    const fn = parseFn([`g(arr: number[], i):\n  return arr[i];`]);
    const src = emitters.ruby.emitFunction(fn);
    assert.ok(src.includes("i = Float(i)"), src);
    assert.ok(!src.includes("arr = Float(arr)"), src);
});

test("ruby: Integer arguments divide by zero as IEEE, not ZeroDivisionError", { skip }, () => {
    const fn = { name: "q", params: ["a", "b"], body: div(v("a"), v("b")) };
    assert.strictEqual(runRuby(fn, "q(1, 0)"), "Inf");
    assert.strictEqual(runRuby(fn, "q(-1, 0)"), "-Inf");
    assert.strictEqual(runRuby(fn, "q(0, 0)"), "NaN");
    assert.strictEqual(runRuby(fn, "q(7, 2)"), "3.5");
});

test("ruby: Integer elements of an array argument divide by zero as IEEE", { skip }, () => {
    const fn = parseFn([`e(arr: number[], i):\n  return 1 / arr[i];`]);
    assert.strictEqual(runRuby(fn, "e([0, 4], 0)"), "Inf");
    assert.strictEqual(runRuby(fn, "e([0, 4], 1)"), "0.25");
});

test("ruby: an out-of-range array index raises instead of silently reading nil as 0", { skip }, () => {
    const fn = parseFn([`e(arr: number[], i):\n  return arr[i];`]);
    assert.throws(() => runRuby(fn, "e([1.0, 2.0], 5)"), /TypeError|Command failed/);
});

test("ruby: uppercase and reserved-word names are emitted as valid local variables", { skip }, () => {
    const fn = {
        name: "n",
        params: ["P0", "end"],
        body: letIn("Tmp", add(v("P0"), v("end")), add(v("Tmp"), num(1))),
    };
    assert.strictEqual(runRuby(fn, "n(2, 3)"), "6");
});

test("ruby: domain errors return NaN or -Infinity instead of raising Math::DomainError", { skip }, () => {
    const cases = [
        ["sqrt", "-1", "NaN"], ["asin", "2", "NaN"], ["acos", "-2", "NaN"],
        ["log", "-1", "NaN"], ["log", "0", "-Inf"], ["log2", "-1", "NaN"],
        ["log2", "0", "-Inf"], ["log10", "-1", "NaN"], ["log10", "0", "-Inf"],
        ["floor", "Float::INFINITY", "Inf"], ["round", "Float::NAN", "NaN"],
        ["trunc", "-Float::INFINITY", "-Inf"], ["ceil", "Float::NAN", "NaN"],
    ];
    for (const [name, arg, expected] of cases) {
        const fn = { name: "d", params: ["x"], body: call(name, v("x")) };
        assert.strictEqual(runRuby(fn, `d(${arg})`), expected, `${name}(${arg})`);
    }
});

test("ruby: pow with a negative base and non-integer exponent is NaN, not Complex", { skip }, () => {
    const fn = { name: "p", params: ["b", "e"], body: call("pow", v("b"), v("e")) };
    assert.strictEqual(runRuby(fn, "p(-8, 0.5)"), "NaN");
    assert.strictEqual(runRuby(fn, "p(-8, 3)"), "-512");
    assert.strictEqual(runRuby(fn, "p(2, 10)"), "1024");
});

test("ruby: wrapIndex floors a negative index and returns NaN for a zero modulus", { skip }, () => {
    const fn = { name: "w", params: ["i", "m"], body: call("wrapIndex", v("i"), v("m")) };
    assert.strictEqual(runRuby(fn, "w(-1, 3)"), "2");
    assert.strictEqual(runRuby(fn, "w(5, 0)"), "NaN");
});

test("ruby: round ties away from zero and min/max propagate NaN in either position", { skip }, () => {
    const r = { name: "r", params: ["x"], body: call("round", v("x")) };
    assert.strictEqual(runRuby(r, "r(2.5)"), "3");
    assert.strictEqual(runRuby(r, "r(-2.5)"), "-3");
    assert.strictEqual(runRuby(r, "r(-0.5)"), "-1");
    for (const name of ["min", "max"]) {
        const m = { name: "m", params: ["a", "b"], body: call(name, v("a"), v("b")) };
        assert.strictEqual(runRuby(m, "m(Float::NAN, 5)"), "NaN");
        assert.strictEqual(runRuby(m, "m(5, Float::NAN)"), "NaN");
    }
});

test("ruby: addTypeGuards and arrayLengths guards actually raise in a real ruby", { skip }, () => {
    const fn = parseFn([`cyclicElem(arr: number[], m, i):\n  return arr[wrapIndex(i, m)];`]);
    const source = emitters.ruby.emitFunction({ ...fn, arrayLengths: { arr: "m" } }, undefined, { addTypeGuards: true });
    const run = (code) => execFileSync("ruby", ["-e", `${source}\n${code}`], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
    assert.strictEqual(run("puts cyclicElem([10, 20, 30, 40], 4, 5)"), "20.0");
    assert.throws(() => run("cyclicElem(5, 4, 5)"), /Command failed/);
    assert.throws(() => run("cyclicElem([1, 2, 3], 4, 5)"), /Command failed/);
});

const ALL_HELPERS = ["sqrt", "asin", "acos", "log", "log2", "log10", "pow", "min", "max",
    "floor", "ceil", "trunc", "round", "sign", "wrap", "clamp"];
const defsIn = (src) => [...src.matchAll(/^def (_ef_\w+)\(/gm)].map((m) => m[1]);

test("ruby: a pure-arithmetic function emits no _ef_ helper definitions", () => {
    const lerp = { name: "lerp", params: ["a", "b", "t"], body: add(v("a"), mul(sub(v("b"), v("a")), v("t"))) };
    const src = emitters.ruby.emitFunction(lerp);
    assert.deepStrictEqual(defsIn(src), []);
    assert.ok(!src.includes("_ef_"), src);
});

test("ruby: each helper-triggering primitive emits exactly its own helper", () => {
    const arity = { pow: 2, min: 2, max: 2, wrapIndex: 2, clampIndex: 3 };
    const cases = { wrapIndex: "wrap", clampIndex: "clamp" };
    for (const name of ALL_HELPERS) {
        const prim = Object.keys(cases).find((k) => cases[k] === name) || name;
        const args = ["x", "y", "z"].slice(0, arity[prim] || 1).map(v);
        const src = emitters.ruby.emitFunction({ name: "f", params: ["x", "y", "z"], body: call(prim, ...args) });
        assert.deepStrictEqual(defsIn(src), [`_ef_${name}`], prim);
    }
});

test("ruby: helpers come out in a fixed order, only those used, in suites too", () => {
    const fn = { name: "f", params: ["x"], body: call("max", call("sqrt", v("x")), call("floor", v("x"))) };
    assert.deepStrictEqual(defsIn(emitters.ruby.emitFunction(fn)), ["_ef_sqrt", "_ef_max", "_ef_floor"]);
    const suite = { name: "s", params: ["x"], body: { type: "outputs", fields: { a: call("log", v("x")), b: num(1) } } };
    assert.deepStrictEqual(defsIn(emitters.ruby.emitFunction(suite)), ["_ef_log"]);
});

test("ruby: includeHelpers: false emits none; a shared emittedHelpers Set defines each once", () => {
    const f1 = { name: "f1", params: ["x"], body: call("sqrt", v("x")) };
    const f2 = { name: "f2", params: ["x"], body: add(call("sqrt", v("x")), call("log", v("x"))) };
    const without = emitters.ruby.emitFunction(f1, undefined, { includeHelpers: false });
    assert.deepStrictEqual(defsIn(without), []);
    assert.ok(without.includes("_ef_sqrt(x)"), without);
    const emittedHelpers = new Set();
    const out = emitters.ruby.emitFunction(f1, undefined, { emittedHelpers }) +
        emitters.ruby.emitFunction(f2, undefined, { emittedHelpers });
    assert.deepStrictEqual(defsIn(out), ["_ef_sqrt", "_ef_log"]);
});

test("ruby: asin/acos helpers use comparisons, not between?", () => {
    const src = emitters.ruby.emitFunction({ name: "f", params: ["x"], body: call("asin", v("x")) });
    assert.ok(!src.includes("between?"), src);
});

test("ruby: pow(-8, NaN) is NaN, not Complex", { skip }, () => {
    const fn = { name: "p", params: ["b", "e"], body: call("pow", v("b"), v("e")) };
    assert.strictEqual(runRuby(fn, "p(-8, Float::NAN)"), "NaN");
    assert.strictEqual(runRuby(fn, "p(-8, 1.5)"), "NaN");
    assert.strictEqual(runRuby(fn, "p(-8, 3)"), "-512");
    assert.strictEqual(runRuby(fn, "p(2, 10)"), "1024");
});

test("ruby: the _ef_ prefix is reserved, so a user name cannot shadow a helper", { skip }, () => {
    const fn = { name: "g", params: ["_ef_sqrt", "_ef_pow"], body: call("sqrt", add(v("_ef_sqrt"), v("_ef_pow"))) };
    const src = emitters.ruby.emitFunction(fn);
    assert.ok(src.includes("def g(__ef_sqrt, __ef_pow)"), src);
    assert.strictEqual(runRuby(fn, "g(7, 9)"), "4");
});

test("ruby: floor/ceil/trunc/round pass NaN and Infinity through instead of raising", { skip }, () => {
    for (const op of ["floor", "ceil", "trunc", "round"]) {
        const fn = { name: "h", params: ["x"], body: call(op, v("x")) };
        assert.strictEqual(runRuby(fn, "h(Float::NAN)"), "NaN", op);
        assert.strictEqual(runRuby(fn, "h(Float::INFINITY)"), "Inf", op);
        assert.strictEqual(runRuby(fn, "h(-Float::INFINITY)"), "-Inf", op);
    }
});

test("ruby: sign returns its own argument for zero and NaN (preserves -0, propagates NaN)", { skip }, () => {
    const fn = { name: "s", params: ["x"], body: call("sign", v("x")) };
    assert.strictEqual(runRuby(fn, "s(-0.0)"), "-0");
    assert.strictEqual(runRuby(fn, "s(0.0)"), "0");
    assert.strictEqual(runRuby(fn, "s(Float::NAN)"), "NaN");
    assert.strictEqual(runRuby(fn, "s(-3)"), "-1");
    assert.strictEqual(runRuby(fn, "s(3)"), "1");
});

test("ruby: floor/ceil/trunc/round keep the sign of a zero result", { skip }, () => {
    const cases = {
        floor: { "-0.4": "-1", "-0.0": "-0", "0.4": "0", "-0.5": "-1" },
        ceil: { "-0.4": "-0", "-0.0": "-0", "0.4": "1", "-0.5": "-0" },
        trunc: { "-0.4": "-0", "-0.0": "-0", "0.4": "0", "-0.5": "-0" },
        round: { "-0.4": "-0", "-0.0": "-0", "0.4": "0", "-0.5": "-1" },
    };
    for (const [op, table] of Object.entries(cases)) {
        const fn = { name: "h", params: ["x"], body: call(op, v("x")) };
        for (const [arg, want] of Object.entries(table)) {
            assert.strictEqual(runRuby(fn, `h(${arg})`), want, `${op}(${arg})`);
        }
    }
});

test("ruby: pow follows IEEE for 1**NaN and (-1)**+-Infinity (all 1)", { skip }, () => {
    const fn = { name: "p", params: ["b", "e"], body: call("pow", v("b"), v("e")) };
    assert.strictEqual(runRuby(fn, "p(1, Float::NAN)"), "1");
    assert.strictEqual(runRuby(fn, "p(-1, Float::INFINITY)"), "1");
    assert.strictEqual(runRuby(fn, "p(-1, -Float::INFINITY)"), "1");
    assert.strictEqual(runRuby(fn, "p(1, Float::INFINITY)"), "1");
});
