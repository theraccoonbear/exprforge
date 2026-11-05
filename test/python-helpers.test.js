// exprforge/test/python-helpers.test.js
//
// Python's domain guards live in one-line _ef_* helper functions (emitted
// once per file, in the same block as _exprforge_div) instead of inline
// conditionals that repeat their operand. This file checks:
//   - the static shape (no operand repeated, helper block gated on
//     includeHelpers, cheap calls still inline),
//   - that every guarded primitive, run through a real python3 on edge
//     inputs (out-of-domain, +-Infinity, NaN, zero, negative), agrees with
//     the native evaluator -- evaluate() alone cannot show this, because
//     it exercises JS's Math, not Python's raising math module,
//   - that the _ef_ and _exprforge_ identifier prefixes are reserved.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { v, num, call, add, mul, outputs, checkUnboundVars } = require("../ast.js");
const { evaluate } = require("../evaluate.js");
const emitters = require("../emitters/registry.js");

function hasPython() {
    try {
        execFileSync("python3", ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}
const PYTHON = hasPython();

const HELPER_NAMES = [
    "_ef_sqrt", "_ef_asin", "_ef_acos", "_ef_log", "_ef_log2", "_ef_log10",
    "_ef_min", "_ef_max", "_ef_floor", "_ef_ceil", "_ef_trunc", "_ef_round",
    "_ef_sign", "_ef_wrap_index",
];

const UNARY = ["sqrt", "asin", "acos", "log", "log2", "log10", "floor", "ceil", "trunc", "round", "sign"];
const BINARY = ["min", "max", "wrapIndex"];

const HELPER_FOR = {
    wrapIndex: "_ef_wrap_index",
};
const helperOf = (p) => HELPER_FOR[p] || `_ef_${p}`;

test("python helpers: every guarded primitive emits a helper call with its operand once", () => {
    const operand = add(mul(v("x"), v("x")), num(1));
    for (const p of UNARY) {
        const src = emitters.python.emitFunction({ name: "f", params: ["x"], body: call(p, operand) });
        const body = src.split("\n").filter((l) => l.startsWith("    return ")).pop();
        assert.strictEqual(body, `    return ${helperOf(p)}(((x * x) + 1))`, p);
    }
    for (const p of BINARY) {
        const src = emitters.python.emitFunction({ name: "f", params: ["x", "y"], body: call(p, v("x"), v("y")) });
        const body = src.split("\n").filter((l) => l.startsWith("    return ")).pop();
        assert.strictEqual(body, `    return ${helperOf(p)}(x, y)`, p);
    }
});

test("python helpers: nested composite formula no longer repeats operands", () => {
    const inner = call("sqrt", add(mul(v("x"), v("x")), mul(v("y"), v("y"))));
    const body = add(
        call("floor", add(mul(inner, num(100)), num(0.5))),
        call("log", add(inner, num(1))),
    );
    const src = emitters.python.emitFunction({ name: "f", params: ["x", "y"], body });
    const ret = src.split("\n").filter((l) => l.startsWith("    return ")).pop();
    assert.strictEqual(ret.split("(x * x)").length - 1, 2, "inner operand appears once per sqrt call site");
    assert.ok(!ret.includes(" if "), "no inline conditional guards remain");
});

test("python helpers: one block with _exprforge_div, gated on includeHelpers", () => {
    const fn = { name: "f", params: ["x"], body: call("sqrt", v("x")) };
    const withHelpers = emitters.python.emitFunction(fn);
    assert.ok(withHelpers.includes("def _exprforge_div("));
    for (const name of HELPER_NAMES) {
        assert.strictEqual(withHelpers.split(`def ${name}(`).length - 1, 1, `${name} defined once`);
    }
    const without = emitters.python.emitFunction(fn, undefined, { includeHelpers: false });
    assert.ok(!without.includes("def _ef_") && !without.includes("def _exprforge_div"));
    const suite = emitters.python.emitFunction({
        name: "g", params: ["x"], body: outputs({ a: call("sqrt", v("x")) }),
    });
    assert.ok(suite.includes("def _ef_sqrt("));
});

test("python helpers: cheap unguarded calls stay inline", () => {
    const body = add(call("abs", v("x")), add(call("sin", v("x")), call("hypot", v("x"), v("y"))));
    const src = emitters.python.emitFunction({ name: "f", params: ["x", "y"], body });
    const ret = src.split("\n").filter((l) => l.startsWith("    return ")).pop();
    assert.ok(ret.includes("abs(x)") && ret.includes("math.sin(x)") && ret.includes("math.hypot(x, y)"));
    assert.ok(!ret.includes("_ef_"));
});

const EDGE = [-2, -1, -0.5, 0, 0.5, 1, 2, 2.5, 1e300, Infinity, -Infinity, NaN];
const MODULI = [0, 3, -3, 2.5, NaN];

function pyLiteral(n) {
    if (Number.isNaN(n)) return "math.nan";
    if (n === Infinity) return "math.inf";
    if (n === -Infinity) return "(-math.inf)";
    return String(n);
}

function sameNumber(a, b) {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return a === b;
}

test("python helpers: real python3 agrees with the evaluator on edge inputs", { skip: !PYTHON && "python3 not available" }, () => {
    const cases = [];
    for (const p of UNARY) for (const x of EDGE) cases.push({ p, args: [x] });
    for (const p of ["min", "max"]) for (const a of EDGE) for (const b of EDGE) cases.push({ p, args: [a, b] });
    for (const i of EDGE.filter((n) => Number.isFinite(n))) for (const m of MODULI) cases.push({ p: "wrapIndex", args: [i, m] });

    let src = "";
    let first = true;
    for (const p of [...UNARY, ...BINARY]) {
        const params = BINARY.includes(p) ? ["x", "y"] : ["x"];
        const argNodes = params.map((n) => v(n));
        src += emitters.python.emitFunction(
            { name: `f_${p}`, params, body: call(p, ...argNodes) },
            undefined,
            { includeHelpers: first },
        ) + "\n\n";
        first = false;
    }
    src += "import sys\n";
    for (const [idx, c] of cases.entries()) {
        src += `try:\n    print(${idx}, repr(float(f_${c.p}(${c.args.map(pyLiteral).join(", ")}))))\n` +
               `except Exception as e:\n    print(${idx}, 'RAISED', type(e).__name__)\n`;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-pyhelpers-"));
    try {
        const file = path.join(dir, "gen.py");
        fs.writeFileSync(file, src);
        const out = execFileSync("python3", ["-I", file]).toString().trim().split("\n");
        assert.strictEqual(out.length, cases.length);
        for (const line of out) {
            const [idxStr, val] = line.split(" ");
            const c = cases[Number(idxStr)];
            assert.notStrictEqual(val, "RAISED", `${c.p}(${c.args}) raised in Python`);
            const got = Number(val.replace("inf", "Infinity"));
            const params = c.args.length === 2 ? ["x", "y"] : ["x"];
            const expected = evaluate(
                { name: "f", params, body: call(c.p, ...params.map((n) => v(n))) },
                c.args,
            );
            assert.ok(sameNumber(got, expected), `${c.p}(${c.args}): python ${got}, evaluator ${expected}`);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("python helpers: round is exact ties-away, sign preserves -0/NaN, pow IEEE specials", { skip: !PYTHON && "python3 not available" }, () => {
    const src = emitters.python.emitFunction({ name: "r", params: ["x"], body: call("round", v("x")) }) + "\n\n" +
        emitters.python.emitFunction({ name: "s", params: ["x"], body: call("sign", v("x")) }, undefined, { includeHelpers: false }) + "\n\n" +
        ["floor", "ceil", "trunc"].map((p) => emitters.python.emitFunction({ name: p[0], params: ["x"], body: call(p, v("x")) }, undefined, { includeHelpers: false })).join("\n\n") + "\n\n" +
        "import math\n" +
        "print(f(-0.0), f(-0.4), f(0.4), f(-1.5), f(1e300), f(math.inf), f(-math.inf), f(math.nan))\n" +
        "print(c(-0.0), c(-0.4), c(0.4), c(-1.5), c(1e300), c(math.inf), c(-math.inf), c(math.nan))\n" +
        "print(t(-0.0), t(-0.4), t(0.4), t(-1.5), t(1e300), t(math.inf), t(-math.inf), t(math.nan))\n" +
        "print(r(0.49999999999999994), r(4503599627370497.0), r(-0.4), r(-0.0), r(2.5), r(-2.5), r(1.5), r(-1.5), r(math.inf), r(-math.inf), r(math.nan))\n" +
        "print(s(-0.0), s(0.0), s(math.nan), s(-3.0), s(2.0))\n" +
        "print(math.pow(1, math.nan), math.pow(-1, math.inf), math.pow(-1, -math.inf))\n";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-pyround-"));
    try {
        const file = path.join(dir, "gen.py");
        fs.writeFileSync(file, src);
        const out = execFileSync("python3", ["-I", file]).toString().trim().split("\n");
        assert.strictEqual(out[0], "-0.0 -1.0 0.0 -2.0 1e+300 inf -inf nan");
        assert.strictEqual(out[1], "-0.0 -0.0 1.0 -1.0 1e+300 inf -inf nan");
        assert.strictEqual(out[2], "-0.0 -0.0 0.0 -1.0 1e+300 inf -inf nan");
        assert.strictEqual(out[3], "0.0 4503599627370497.0 -0.0 -0.0 3.0 -3.0 2.0 -2.0 inf -inf nan");
        assert.strictEqual(out[4], "-0.0 0.0 nan -1.0 1.0");
        assert.strictEqual(out[5], "1.0 1.0 1.0");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("python helpers: _ef_ and _exprforge_ prefixes are reserved identifiers", () => {
    for (const name of ["_ef_sqrt", "_ef_x", "_exprforge_div", "_exprforge_anything"]) {
        assert.throws(() => v(name), /reserved prefix/, `v(${name})`);
        assert.throws(() => call(name, num(1)), /reserved prefix/, `call(${name})`);
    }
    assert.throws(() => checkUnboundVars({ name: "_ef_f", params: ["x"], body: v("x") }), /reserved prefix/);
    assert.throws(() => checkUnboundVars({ name: "f", params: ["_ef_x"], body: num(1) }), /reserved prefix/);
    assert.doesNotThrow(() => v("_efficiency"));
    assert.doesNotThrow(() => v("_x"));
    assert.doesNotThrow(() => v("ef_x"));
});
