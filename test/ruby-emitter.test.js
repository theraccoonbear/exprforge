// exprforge/test/ruby-emitter.test.js
//
// Ruby-specific behavior that the shared conformance samples cannot reach:
// Ruby's Integer type (Integer / 0 raises, Integer / Integer truncates),
// constant-vs-local naming, and nil from an out-of-range Array#[].
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const { v, num, div, add, call, letIn } = require("../ast.js");
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
