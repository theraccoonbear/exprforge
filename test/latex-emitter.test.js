// exprforge/test/latex-emitter.test.js
//
// The LaTeX target has no compiler to run its output through and can't
// round-trip back into an AST (unlike emitters/exprsyntax.js), so it's
// covered two ways:
//
//   1. Exact-string checks for every node type, every built-in primitive,
//      every cmp() operator, and every mulSymbol value (plus each case
//      where "implicit" must fall back to \cdot). Static, always run.
//   2. A real KaTeX parse (strict mode) of every sample's output, using a
//      `katex` CLI found on PATH -- a system tool exactly like tsc is for
//      TypeScript (see test/conformance.test.js's TOOLS), never a project
//      dependency. Skipped when katex isn't installed; CI's test-latex.yml
//      installs it and runs this with EXPRFORGE_TEST_TARGETS=LaTeX.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { v, num, call, cmp, select, letIn, outputs, idx, add, sub, mul, div, neg } = require("../ast.js");
const { PRIMITIVE_ARITY } = require("../primitives.js");
const emitters = require("../emitters/registry.js");

const latex = emitters.latex;

function tex(body, params = ["x", "y"], opts = undefined) {
    const out = latex.emitFunction({ name: "f", params, body }, undefined, opts);
    const marker = "\\right) = ";
    const at = out.indexOf(marker);
    assert.ok(out.startsWith("f\\left(") && at > 0 && !out.includes("aligned"), `expected single-line function output, got:\n${out}`);
    return out.slice(at + marker.length).replace(/\n$/, "");
}

const x = v("x");
const y = v("y");

// --- primitives ------------------------------------------------------------

const PRIMITIVE_CASES = {
    sqrt: [[x], "\\sqrt{x}"],
    abs: [[x], "\\left\\lvert x \\right\\rvert"],
    sin: [[x], "\\sin\\left(x\\right)"],
    cos: [[x], "\\cos\\left(x\\right)"],
    tan: [[x], "\\tan\\left(x\\right)"],
    asin: [[x], "\\arcsin\\left(x\\right)"],
    acos: [[x], "\\arccos\\left(x\\right)"],
    atan: [[x], "\\arctan\\left(x\\right)"],
    log: [[x], "\\ln\\left(x\\right)"],
    log2: [[x], "\\log_{2}\\left(x\\right)"],
    log10: [[x], "\\log_{10}\\left(x\\right)"],
    exp: [[x], "e^{x}"],
    floor: [[x], "\\left\\lfloor x \\right\\rfloor"],
    ceil: [[x], "\\left\\lceil x \\right\\rceil"],
    round: [[x], "\\operatorname{round}\\left(x\\right)"],
    trunc: [[x], "\\operatorname{trunc}\\left(x\\right)"],
    sign: [[x], "\\operatorname{sgn}\\left(x\\right)"],
    pow: [[x, y], "x^{y}"],
    atan2: [[y, x], "\\operatorname{atan2}\\left(y, x\\right)"],
    min: [[x, y], "\\min\\left(x, y\\right)"],
    max: [[x, y], "\\max\\left(x, y\\right)"],
    hypot: [[x, y], "\\sqrt{x^{2} + y^{2}}"],
    wrapIndex: [[x, y], "x \\bmod y"],
    clampIndex: [[x, y, num(9)], "\\operatorname{clamp}\\left(x, y, 9\\right)"],
};

test("every built-in primitive has a LaTeX rendering (this table covers PRIMITIVE_ARITY exactly)", () => {
    assert.deepStrictEqual(Object.keys(PRIMITIVE_CASES).sort(), Object.keys(PRIMITIVE_ARITY).sort());
});

for (const [name, [args, expected]] of Object.entries(PRIMITIVE_CASES)) {
    test(`primitive ${name} renders as ${expected}`, () => {
        assert.strictEqual(tex(call(name, ...args)), expected);
    });
}

test("an unknown call still throws base.js's own error", () => {
    assert.throws(() => tex(call("notAThing", x)), /no mapping for Math function "notAThing"/);
});

// --- precedence / parentheses ----------------------------------------------

test("parentheses only where notation needs them", () => {
    const cases = [
        [add(x, mul(num(2), y)), "x + 2 y"],
        [mul(add(x, y), sub(x, y)), "\\left(x + y\\right) \\left(x - y\\right)"],
        [sub(x, add(x, y)), "x - \\left(x + y\\right)"],
        [sub(add(x, y), x), "x + y - x"],
        [add(x, num(-5)), "x + \\left(-5\\right)"],
        [mul(num(-5), x), "-5 x"],
        [neg(x), "-x"],
        [neg(add(x, y)), "-\\left(x + y\\right)"],
        [mul(x, neg(y)), "x \\left(-y\\right)"],
        [div(add(x, y), sub(x, y)), "\\frac{x + y}{x - y}"],
        [call("pow", add(x, num(1)), num(2)), "\\left(x + 1\\right)^{2}"],
        [call("pow", call("pow", x, num(2)), num(3)), "\\left(x^{2}\\right)^{3}"],
        [call("pow", div(x, y), num(2)), "\\left(\\frac{x}{y}\\right)^{2}"],
        [call("pow", x, add(x, y)), "x^{x + y}"],
        [call("pow", num(-2), x), "\\left(-2\\right)^{x}"],
        [add(call("wrapIndex", x, num(4)), num(1)), "\\left(x \\bmod 4\\right) + 1"],
        [call("wrapIndex", add(x, num(1)), num(4)), "\\left(x + 1\\right) \\bmod 4"],
        [call("sqrt", add(x, y)), "\\sqrt{x + y}"],
    ];
    for (const [body, expected] of cases) assert.strictEqual(tex(body), expected);
});

// --- multiplication: mulSymbol ---------------------------------------------

test('mulSymbol "implicit" (default) juxtaposes where safe', () => {
    assert.strictEqual(tex(mul(num(2), x)), "2 x");
    assert.strictEqual(tex(mul(x, y)), "x y");
    assert.strictEqual(tex(mul(num(2), call("sin", x))), "2 \\sin\\left(x\\right)");
    assert.strictEqual(tex(mul(num(2), x), undefined, { mulSymbol: "implicit" }), "2 x");
});

test('mulSymbol "implicit" falls back to \\cdot wherever juxtaposition would misread', () => {
    // two numbers: never "23"
    assert.strictEqual(tex(mul(num(2), num(3))), "2 \\cdot 3");
    // number after a variable
    assert.strictEqual(tex(mul(x, num(2))), "x \\cdot 2");
    // numeric coefficient before a fraction: never a mixed number
    assert.strictEqual(tex(mul(num(2), div(num(1), num(3)))), "2 \\cdot \\frac{1}{3}");
    // multi-letter identifiers on either side
    assert.strictEqual(tex(mul(v("rate"), v("time")), ["rate", "time"]), "\\mathit{rate} \\cdot \\mathit{time}");
    assert.strictEqual(tex(mul(x, v("rate")), ["x", "rate"]), "x \\cdot \\mathit{rate}");
    // a cases block on either side
    const sel = select(cmp(x, ">", num(0)), x, num(0));
    assert.match(tex(mul(sel, y)), /\\end\{cases\} \\cdot y$/);
    assert.match(tex(mul(y, sel)), /^y \\cdot \\begin\{cases\}/);
    // a scientific-notation factor (starts with a digit)
    assert.strictEqual(tex(mul(x, num(1.5e-9))), "x \\cdot 1.5 \\times 10^{-9}");
});

test('mulSymbol "cdot" and "times" use that symbol everywhere', () => {
    assert.strictEqual(tex(mul(num(2), x), undefined, { mulSymbol: "cdot" }), "2 \\cdot x");
    assert.strictEqual(tex(mul(x, y), undefined, { mulSymbol: "cdot" }), "x \\cdot y");
    assert.strictEqual(tex(mul(num(2), x), undefined, { mulSymbol: "times" }), "2 \\times x");
    assert.strictEqual(tex(mul(x, y), undefined, { mulSymbol: "times" }), "x \\times y");
});

test("scientific notation always uses \\times, whatever mulSymbol is", () => {
    for (const mulSymbol of ["implicit", "cdot", "times"]) {
        assert.strictEqual(tex(num(1.5e-9), undefined, { mulSymbol }), "1.5 \\times 10^{-9}");
    }
});

test("an unknown mulSymbol throws a clear error", () => {
    assert.throws(() => tex(mul(x, y), undefined, { mulSymbol: "star" }), /unknown mulSymbol "star"/);
});

test("mulSymbol does not leak between calls", () => {
    tex(mul(x, y), undefined, { mulSymbol: "times" });
    assert.strictEqual(tex(mul(x, y)), "x y");
});

// --- numbers ---------------------------------------------------------------

test("number literals", () => {
    const cases = [
        [0, "0"],
        [42, "42"],
        [0.5, "0.5"],
        [-3, "-3"],
        [1e-9, "10^{-9}"],
        [1.5e-9, "1.5 \\times 10^{-9}"],
        [1e21, "10^{21}"],
        [-2.5e30, "-2.5 \\times 10^{30}"],
    ];
    for (const [value, expected] of cases) assert.strictEqual(tex(num(value)), expected, `num(${value})`);
});

// --- identifiers -----------------------------------------------------------

test("identifiers", () => {
    const cases = [
        ["x", "x"],
        ["alpha", "\\alpha"],
        ["Gamma", "\\Gamma"],
        // No \Alpha in standard LaTeX -- falls through to \mathit.
        ["Alpha", "\\mathit{Alpha}"],
        ["x1", "x_{1}"],
        ["x_1", "x_{1}"],
        ["x_i", "x_{i}"],
        ["v_max", "v_{\\mathrm{max}}"],
        ["theta_0", "\\theta_{0}"],
        ["rate", "\\mathit{rate}"],
        ["rLen", "\\mathit{rLen}"],
        ["a_b_c", "a_{\\mathrm{b\\_c}}"],
    ];
    for (const [name, expected] of cases) assert.strictEqual(tex(v(name), [name]), expected, name);
});

test("greekLetters: false renders Greek names as ordinary identifiers", () => {
    assert.strictEqual(tex(v("theta"), ["theta"], { greekLetters: false }), "\\mathit{theta}");
    assert.strictEqual(tex(v("pi_0"), ["pi_0"], { greekLetters: false }), "\\mathit{pi}_{0}");
    assert.strictEqual(tex(v("theta"), ["theta"], { greekLetters: true }), "\\theta");
    assert.strictEqual(tex(v("theta"), ["theta"]), "\\theta");
});

test("greekLetters must be a boolean", () => {
    assert.throws(() => tex(v("x"), ["x"], { greekLetters: "no" }), /greekLetters must be true or false/);
});

test("names that would render identically fall back to their literal spelling", () => {
    // x1 and x_1 would both be x_{1}: both spelled out instead, everywhere
    // they appear (signature and body), so they stay distinguishable.
    assert.strictEqual(
        latex.emitFunction({ name: "f", params: ["x1", "x_1"], body: add(v("x1"), v("x_1")) }),
        "f\\left(\\mathit{x1}, \\mathit{x\\_1}\\right) = \\mathit{x1} + \\mathit{x\\_1}\n",
    );
    // Non-colliding names in the same function keep their usual rendering.
    assert.strictEqual(
        tex(add(add(v("x1"), v("x_1")), v("y2")), ["x1", "x_1", "y2"]),
        "\\mathit{x1} + \\mathit{x\\_1} + y_{2}",
    );
    // A let name colliding with a param is caught too.
    assert.strictEqual(
        latex.emitFunction({ name: "f", params: ["theta1"], body: letIn("theta_1", mul(num(2), v("theta1")), v("theta_1")) }),
        "\\begin{aligned}\n  \\mathit{theta\\_1} &= 2 \\cdot \\mathit{theta1} \\\\\n  f\\left(\\mathit{theta1}\\right) &= \\mathit{theta\\_1}\n\\end{aligned}\n",
    );
    // No collision, no change.
    assert.strictEqual(tex(v("x1"), ["x1"]), "x_{1}");
});

test("function names: single letter plain, otherwise \\operatorname", () => {
    assert.strictEqual(latex.emitFunction({ name: "g", params: ["x"], body: x }), "g\\left(x\\right) = x\n");
    assert.strictEqual(
        latex.emitFunction({ name: "dot_3", params: [], body: num(1) }),
        "\\operatorname{dot\\_3}\\left(\\right) = 1\n",
    );
});

// --- select / cmp ----------------------------------------------------------

const CMP_CASES = { ">": ">", "<": "<", ">=": "\\geq", "<=": "\\leq", "==": "=", "!=": "\\neq" };

for (const [op, spelled] of Object.entries(CMP_CASES)) {
    test(`cmp "${op}" renders as ${spelled} inside a cases block`, () => {
        assert.strictEqual(
            tex(select(cmp(x, op, num(5)), num(1), num(0))),
            `\\begin{cases} 1 & \\text{if } x ${spelled} 5 \\\\ 0 & \\text{otherwise} \\end{cases}`,
        );
    });
}

test("an else-chain of selects flattens into one cases block", () => {
    const body = select(cmp(x, ">", num(0)), num(1), select(cmp(x, "<", num(0)), num(-1), num(0)));
    assert.strictEqual(
        tex(body),
        "\\begin{cases} 1 & \\text{if } x > 0 \\\\ -1 & \\text{if } x < 0 \\\\ 0 & \\text{otherwise} \\end{cases}",
    );
});

test("a cmp outside a select still throws base.js's own error", () => {
    assert.throws(() => tex(add(cmp(x, ">", y), num(1))), /"cmp" is only valid inside a select/);
});

// --- index / let / outputs -------------------------------------------------

test("index renders as a subscript", () => {
    const fnDef = { name: "f", params: ["t", "i"], paramTypes: { t: "number[]" }, body: idx(v("t"), v("i")) };
    assert.strictEqual(latex.emitFunction(fnDef), "f\\left(t, i\\right) = t_{i}\n");
    const wrapped = { ...fnDef, body: idx(v("t"), call("wrapIndex", v("i"), num(4))) };
    assert.strictEqual(latex.emitFunction(wrapped), "f\\left(t, i\\right) = t_{i \\bmod 4}\n");
    const subscripted = { name: "f", params: ["t_1", "i"], paramTypes: { t_1: "number[]" }, body: idx(v("t_1"), v("i")) };
    assert.strictEqual(latex.emitFunction(subscripted), "f\\left(t_{1}, i\\right) = {t_{1}}_{i}\n");
});

test("let bindings become an aligned block of definitions", () => {
    const fnDef = { name: "f", params: ["x", "y"], body: letIn("d", sub(x, y), mul(v("d"), v("d"))) };
    assert.strictEqual(
        latex.emitFunction(fnDef),
        "\\begin{aligned}\n  d &= x - y \\\\\n  f\\left(x, y\\right) &= d d\n\\end{aligned}\n",
    );
});

test("outputs render each field as its own function of the parameters", () => {
    const fnDef = { name: "frame", params: ["t"], body: letIn("s", mul(num(2), v("t")), outputs({ a: v("s"), bVal: add(v("s"), num(1)) })) };
    assert.strictEqual(
        latex.emitFunction(fnDef),
        "\\begin{aligned}\n  s &= 2 t \\\\\n  a\\left(t\\right) &= s \\\\\n  \\mathit{bVal}\\left(t\\right) &= s + 1\n\\end{aligned}\n",
    );
});

// --- real KaTeX parse of every sample ---------------------------------------

function hasTool(cmd, args) {
    try {
        execFileSync(cmd, args, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

const TARGET_FILTER = process.env.EXPRFORGE_TEST_TARGETS
    ? new Set(process.env.EXPRFORGE_TEST_TARGETS.split(",").map((s) => s.trim()))
    : null;
const KATEX = hasTool("katex", ["--version"]);
const katexSkip = TARGET_FILTER && !TARGET_FILTER.has("LaTeX")
    ? "EXPRFORGE_TEST_TARGETS excludes LaTeX"
    : !KATEX && "katex CLI not available";

function isFnDef(x) {
    return x && typeof x === "object" && typeof x.name === "string" && Array.isArray(x.params) && x.body;
}

function sampleFnDefs() {
    const dir = path.join(__dirname, "..", "samples");
    const defs = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort()) {
        for (const exported of Object.values(require(path.join(dir, file)))) {
            for (const def of Array.isArray(exported) ? exported : [exported]) {
                if (isFnDef(def)) defs.push([`${file}:${def.name}`, def]);
            }
        }
    }
    return defs;
}

function katexParse(source) {
    execFileSync("katex", ["--display-mode", "--strict"], { input: source, stdio: ["pipe", "ignore", "pipe"] });
}

test("every sample's LaTeX output parses in KaTeX (strict), for every mulSymbol", { skip: katexSkip }, () => {
    const defs = sampleFnDefs();
    assert.ok(defs.length >= 15, `expected to find the samples, found ${defs.length}`);
    for (const [label, def] of defs) {
        for (const mulSymbol of ["implicit", "cdot", "times"]) {
            const source = latex.emitFunction(def, undefined, { mulSymbol });
            assert.doesNotThrow(() => katexParse(source), `${label} (mulSymbol=${mulSymbol}) failed to parse:\n${source}`);
        }
    }
});
