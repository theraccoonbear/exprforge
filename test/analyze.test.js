// exprforge/test/analyze.test.js
//
// Interval/range analysis (analyze.js). analyzeRanges() emits nothing, so
// there is no per-target syntax to compile -- the equivalent of conformance
// here is soundness: for sampled inputs inside the declared ranges, the
// value evaluate() produces must lie inside the interval analyzeRanges()
// reported (or be NaN only where `nan` is true). That is checked across every
// primitive, every comparison operator, and every sample AST this project
// ships, not just a representative one.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    num, v, add, mul, sub, div, call, letIn, select, cmp, outputs, idx,
} = require("../ast.js");
const { fn } = require("../fn.js");
const { evaluate } = require("../evaluate.js");
const { analyzeRanges } = require("../analyze.js");
const { loadExtern } = require("../macros.js");
const { PRIMITIVE_ARITY } = require("../primitives.js");
const { safeDiv, normalize3 } = require("../math/index.js");
const { createSession } = require("../index.js");
const samples = require("../index.js").samples;

const warningsOf = (r) => r.findings.filter((x) => x.severity === "warning");
const def = (params, body) => ({ name: "f", params, body });

// Deterministic PRNG so failures reproduce.
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function inRange(value, r) {
    if (Number.isNaN(value)) return r.nan;
    const tol = 1e-9 * Math.max(1, Math.abs(value));
    return value >= r.lo - tol && value <= r.hi + tol;
}

// Evaluates `fnDef` at `count` random points (plus every corner of the box
// when there are few params) and asserts each lands inside the analysis.
function assertSound(fnDef, ranges, count = 400, seed = 1) {
    const result = analyzeRanges(fnDef, ranges);
    const rand = rng(seed);
    const lo = (p) => (ranges[p] ? ranges[p][0] : -5);
    const hi = (p) => (ranges[p] ? ranges[p][1] : 5);
    const points = [];
    for (let i = 0; i < count; i++) {
        points.push(fnDef.params.map((p) => lo(p) + rand() * (hi(p) - lo(p))));
    }
    if (fnDef.params.length <= 4) {
        for (let mask = 0; mask < 1 << fnDef.params.length; mask++) {
            points.push(fnDef.params.map((p, i) => ((mask >> i) & 1 ? hi(p) : lo(p))));
        }
    }
    for (const args of points) {
        const out = evaluate(fnDef, args);
        if (typeof out === "object") {
            for (const [name, value] of Object.entries(out)) {
                assert.ok(inRange(value, result.range[name]), `${fnDef.name}.${name}(${args}) = ${value} outside ${JSON.stringify(result.range[name])}`);
            }
        } else {
            assert.ok(inRange(out, result.range), `${fnDef.name}(${args}) = ${out} outside ${JSON.stringify(result.range)}`);
        }
    }
    return result;
}

test("arithmetic: + - * propagate bounds", () => {
    const r = analyzeRanges(def(["x", "y"], sub(add(v("x"), mul(v("y"), num(2))), num(1))), { x: [0, 10], y: [-5, 5] });
    assert.deepEqual(r.range, { lo: -11, hi: 19, nan: false });
    assert.deepEqual(warningsOf(r), []);
});

test("x*x uses the squared range, not the sign-mixed product", () => {
    const r = analyzeRanges(def(["x"], mul(v("x"), v("x"))), { x: [-2, 3] });
    assert.deepEqual(r.range, { lo: 0, hi: 9, nan: false });
});

test("undeclared parameters are unbounded", () => {
    const r = analyzeRanges(def(["x"], add(v("x"), num(1))), {});
    assert.equal(r.range.lo, -Infinity);
    assert.equal(r.range.hi, Infinity);
});

test("invalid range declarations are rejected", () => {
    const f = def(["x"], v("x"));
    assert.throws(() => analyzeRanges(f, { y: [0, 1] }), /not a parameter/);
    assert.throws(() => analyzeRanges(f, { x: [2, 1] }), /greater than max/);
    assert.throws(() => analyzeRanges(f, { x: [0] }), /\[min, max\]/);
    assert.throws(() => analyzeRanges(f, { x: [NaN, 1] }), /\[min, max\]/);
    assert.throws(() => analyzeRanges(f, [[0, 1]]), /plain object/);
});

test("division: denominator interval containing zero is flagged", () => {
    const r = analyzeRanges(def(["x", "d"], div(v("x"), v("d"))), { x: [1, 2], d: [-1, 1] });
    assert.equal(warningsOf(r).length, 1);
    assert.equal(warningsOf(r)[0].kind, "div-by-zero");
    assert.equal(warningsOf(r)[0].certain, false);
    assert.deepEqual(warningsOf(r)[0].denominator, { lo: -1, hi: 1, nan: false });
    assert.equal(r.range.lo, -Infinity);
    assert.equal(r.range.hi, Infinity);
});

test("division: a denominator exactly zero is reported as certain", () => {
    const r = analyzeRanges(def(["x"], div(v("x"), num(0))), { x: [1, 2] });
    assert.equal(warningsOf(r)[0].certain, true);
});

test("division: denominator proven nonzero gives a finite range and no warning", () => {
    const r = analyzeRanges(def(["x", "d"], div(v("x"), v("d"))), { x: [1, 2], d: [2, 4] });
    assert.deepEqual(warningsOf(r), []);
    assert.deepEqual(r.range, { lo: 0.25, hi: 1, nan: false });
    const neg = analyzeRanges(def(["x", "d"], div(v("x"), v("d"))), { x: [1, 2], d: [-4, -2] });
    assert.deepEqual(neg.range, { lo: -1, hi: -0.25, nan: false });
});

test("division: a denominator computed from other terms is analyzed, not just a variable", () => {
    const body = div(v("x"), add(mul(v("y"), v("y")), num(1)));
    const r = analyzeRanges(def(["x", "y"], body), { x: [-1, 1], y: [-3, 3] });
    assert.deepEqual(warningsOf(r), []);
    const bad = div(v("x"), sub(mul(v("y"), v("y")), num(1)));
    assert.equal(warningsOf(analyzeRanges(def(["x", "y"], bad), { x: [-1, 1], y: [-3, 3] }))[0].kind, "div-by-zero");
});

// Guard patterns: for every comparison operator, a select() whose condition
// excludes zero from the divisor in the taken branch. Each row is
// [op, rangeOfD, thenBranchIsGuarded]; when the then-branch is not the
// guarded one the else-branch holds the division instead.
const GUARDS = [
    [">", [-3, 3], 0.5, true],
    [">=", [-3, 3], 0.5, true],
    ["<", [-3, 3], -0.5, true],
    ["<=", [-3, 3], -0.5, true],
    ["==", [-3, 3], 2, true],
    ["!=", [-3, 3], 0, true],
    // Negated: the else branch is where the operator's complement holds.
    [">", [-3, 3], -0.5, false],
    [">=", [-3, 3], -0.5, false],
    ["<", [-3, 3], 0.5, false],
    ["<=", [-3, 3], 0.5, false],
    ["==", [-3, 3], 0, false],
    ["!=", [-3, 3], 2, false],
];

for (const [op, range, bound, guardedThen] of GUARDS) {
    test(`guard refinement: d ${op} ${bound} (${guardedThen ? "then" : "else"} branch)`, () => {
        const division = div(v("x"), v("d"));
        const c = cmp(v("d"), op, num(bound));
        const body = guardedThen ? select(c, division, num(0)) : select(c, num(0), division);
        const f = def(["x", "d"], body);
        const r = analyzeRanges(f, { x: [1, 2], d: range });
        // A flat-out guarded division is never "div-by-zero"...
        assert.equal(warningsOf(r).filter((w) => w.kind === "div-by-zero").length, 0, JSON.stringify(warningsOf(r)));
        // ...but it does depend on the guard.
        assert.equal(warningsOf(r).filter((w) => w.kind === "div-guarded").length, 1, JSON.stringify(warningsOf(r)));
        assert.equal(r.selects[0].loadBearing, true);
        assert.equal(r.selects[0].outcome, "either");
        assertSound(f, { x: [1, 2], d: range });
    });
}

test("guard refinement: the unguarded branch of a select is still flagged", () => {
    const f = def(["x", "d"], select(cmp(v("d"), ">", num(0.5)), num(0), div(v("x"), v("d"))));
    const r = analyzeRanges(f, { x: [1, 2], d: [-3, 3] });
    assert.deepEqual(warningsOf(r).map((w) => w.kind), ["div-by-zero"]);
});

test("guard refinement: operands may be swapped (constant on the left)", () => {
    const f = def(["x", "d"], select(cmp(num(0.5), "<", v("d")), div(v("x"), v("d")), num(0)));
    const r = analyzeRanges(f, { x: [1, 2], d: [-3, 3] });
    assert.deepEqual(warningsOf(r).map((w) => w.kind), ["div-guarded"]);
});

test("guard refinement: abs(d) > eps excludes the open interval around zero", () => {
    const eps = num(1e-6);
    const f = def(["x", "d"], select(cmp(call("abs", v("d")), ">", eps), div(v("x"), v("d")), num(0)));
    const r = analyzeRanges(f, { x: [1, 2], d: [-1, 1] });
    assert.deepEqual(warningsOf(r).map((w) => w.kind), ["div-guarded"]);
    assert.deepEqual(warningsOf(r)[0].guards, ["body"]);
    assert.equal(r.selects[0].loadBearing, true);
    assert.equal(r.range.lo, -2e6);
    assert.equal(r.range.hi, 2e6);
});

test("guard refinement: abs(d) >= eps behaves the same as abs(d) > eps", () => {
    const f = def(["x", "d"], select(cmp(call("abs", v("d")), ">=", num(1e-6)), div(v("x"), v("d")), num(0)));
    assert.deepEqual(warningsOf(analyzeRanges(f, { x: [1, 2], d: [-1, 1] })).map((w) => w.kind), ["div-guarded"]);
});

test("guard refinement: applies through let-bound names", () => {
    const f = def(["x", "y"], letIn("m", call("sqrt", add(mul(v("x"), v("x")), mul(v("y"), v("y")))),
        select(cmp(v("m"), ">", num(1e-9)), div(v("x"), v("m")), num(0))));
    const r = analyzeRanges(f, { x: [-1, 1], y: [-1, 1] });
    assert.deepEqual(warningsOf(r).map((w) => w.kind), ["div-guarded"]);
    assertSound(f, { x: [-1, 1], y: [-1, 1] });
});

test("the QB64-eager normalizeX shape: guarded but not safe where select evaluates both branches", () => {
    // Same shape as test/conformance.test.js's normalizeXAst, which is
    // excluded from QB64 because that target divides by zero in the
    // not-taken branch.
    const f = def(["x", "y", "z"], letIn("mag",
        call("sqrt", add(mul(v("x"), v("x")), mul(v("y"), v("y")), mul(v("z"), v("z")))),
        select(cmp(v("mag"), ">", num(1e-9)), div(v("x"), v("mag")), num(0))));
    const r = analyzeRanges(f, { x: [-1, 1], y: [-1, 1], z: [-1, 1] });
    assert.equal(warningsOf(r).length, 1);
    assert.equal(warningsOf(r)[0].kind, "div-guarded");
    assert.equal(warningsOf(r)[0].denominator.lo, 0);
    assert.equal(r.selects[0].loadBearing, true);
});

test("safeDiv's clamped denominator is provably safe: no warnings, guard not load-bearing", () => {
    const f = def(["x", "d"], safeDiv(v("x"), v("d"), num(0)));
    const r = analyzeRanges(f, { x: [1, 2], d: [-1, 1] });
    assert.deepEqual(warningsOf(r), []);
    assert.ok(r.selects.every((s) => !s.loadBearing));
    assert.ok(Number.isFinite(r.range.lo) && Number.isFinite(r.range.hi));
    assertSound(f, { x: [1, 2], d: [-1, 1] });
});

test("normalize3 (math/index.js) is warning-free", () => {
    const f = def(["x", "y", "z"], outputs(normalize3(v("x"), v("y"), v("z"), num(1), num(0), num(0))));
    const ranges = { x: [-4, 4], y: [-4, 4], z: [-4, 4] };
    const r = analyzeRanges(f, ranges);
    assert.deepEqual(warningsOf(r), []);
    assertSound(f, ranges, 200);
});

test("select outcomes: conditions decided by the ranges are reported", () => {
    const mk = (x) => def(["x"], select(cmp(v("x"), ">", num(0)), num(1), num(2)));
    assert.equal(analyzeRanges(mk(), { x: [1, 2] }).selects[0].outcome, "always-then");
    assert.equal(analyzeRanges(mk(), { x: [-2, 0] }).selects[0].outcome, "always-else");
    assert.equal(analyzeRanges(mk(), { x: [-2, 2] }).selects[0].outcome, "either");
    const dead = analyzeRanges(mk(), { x: [1, 2] });
    assert.deepEqual(dead.range, { lo: 1, hi: 1, nan: false });
});

// Every comparison operator's decided / undecided outcomes.
const DECIDED = [
    [">", [1, 2], 0, "always-then"], [">", [-2, 0], 0, "always-else"],
    [">=", [0, 2], 0, "always-then"], [">=", [-2, -1], 0, "always-else"],
    ["<", [-2, -1], 0, "always-then"], ["<", [0, 2], 0, "always-else"],
    ["<=", [-2, 0], 0, "always-then"], ["<=", [1, 2], 0, "always-else"],
    ["==", [3, 3], 3, "always-then"], ["==", [1, 2], 3, "always-else"],
    ["!=", [1, 2], 3, "always-then"], ["!=", [3, 3], 3, "always-else"],
];
for (const [op, range, bound, outcome] of DECIDED) {
    test(`select outcome for x ${op} ${bound} over [${range}] is ${outcome}`, () => {
        const f = def(["x"], select(cmp(v("x"), op, num(bound)), num(1), num(2)));
        assert.equal(analyzeRanges(f, { x: range }).selects[0].outcome, outcome);
    });
}

test("dead-branch divisions are informational, not warnings", () => {
    const f = def(["x", "d"], select(cmp(v("x"), ">", num(10)), div(num(1), v("d")), num(0)));
    const r = analyzeRanges(f, { x: [0, 1], d: [-1, 1] });
    assert.equal(r.selects[0].outcome, "always-else");
    assert.deepEqual(warningsOf(r), []);
    const note = r.findings.find((x) => x.kind === "div-unreachable");
    assert.equal(note.severity, "info");
    assert.equal("inDeadBranch" in note, false);
    assert.equal("warnings" in r, false);
    assert.deepEqual(r.range, { lo: 0, hi: 0, nan: false });
});

test("a guard that excludes nothing is not load-bearing", () => {
    const f = def(["x", "d"], select(cmp(v("x"), ">", num(0)), div(num(1), v("d")), num(0)));
    const r = analyzeRanges(f, { x: [-1, 1], d: [1, 2] });
    assert.deepEqual(warningsOf(r), []);
    assert.equal(r.selects[0].loadBearing, false);
});

test("nested selects: only the guard actually excluding zero is load-bearing", () => {
    const inner = select(cmp(call("abs", v("d")), ">", num(0.1)), div(num(1), v("d")), num(0));
    const f = def(["x", "d"], select(cmp(v("x"), ">", num(0)), inner, num(5)));
    const r = analyzeRanges(f, { x: [-1, 1], d: [-1, 1] });
    assert.equal(r.selects.length, 2);
    assert.equal(r.selects[0].loadBearing, false);
    assert.equal(r.selects[1].loadBearing, true);
    assert.equal(warningsOf(r)[0].guards.length, 1);
    assert.equal(warningsOf(r)[0].guards[0], r.selects[1].at);
});

test("outputs() bodies return a range per field", () => {
    const f = def(["x"], outputs({ a: add(v("x"), num(1)), b: mul(v("x"), v("x")) }));
    const r = analyzeRanges(f, { x: [-1, 2] });
    assert.deepEqual(r.range.a, { lo: 0, hi: 3, nan: false });
    assert.deepEqual(r.range.b, { lo: 0, hi: 4, nan: false });
});

test("macros are expanded before analysis", () => {
    const f = fn`
        f(x, d):
        return safeDiv(x, d, 0);
    `;
    const r = analyzeRanges(f, { x: [1, 2], d: [-1, 1] });
    assert.deepEqual(warningsOf(r), []);
});

test("array parameters: the declared range bounds every element", () => {
    const f = { name: "f", params: ["a", "i"], paramTypes: { a: "number[]" }, body: div(num(1), idx(v("a"), v("i"))) };
    assert.deepEqual(warningsOf(analyzeRanges(f, { a: [1, 4] })), []);
    assert.equal(warningsOf(analyzeRanges(f, { a: [-1, 4] }))[0].kind, "div-by-zero");
});

test("externs are opaque: unbounded and possibly NaN", () => {
    loadExtern("analyzeOpaque", { arity: 1, evaluate: (x) => x });
    const r = analyzeRanges(def(["x"], call("analyzeOpaque", v("x"))), { x: [0, 1] });
    assert.equal(r.range.nan, true);
    assert.equal(r.range.lo, -Infinity);
});

test("sessions expose analyzeRanges bound to their own registry", () => {
    const s = createSession();
    s.loadMacro("sessOnlyHalf", (a) => div(a, num(2)));
    const r = s.analyzeRanges(def(["x"], call("sessOnlyHalf", v("x"))), { x: [0, 4] });
    assert.deepEqual(r.range, { lo: 0, hi: 2, nan: false });
});

// NaN tracking.
test("NaN: out-of-domain arguments set the nan flag, in-domain do not", () => {
    for (const [name, ok, bad] of [
        ["sqrt", [0, 4], [-1, 4]], ["log", [1, 4], [-1, 4]], ["log2", [1, 4], [-1, 4]],
        ["log10", [1, 4], [-1, 4]], ["asin", [-1, 1], [-2, 1]], ["acos", [-1, 1], [-1, 2]],
    ]) {
        const f = def(["x"], call(name, v("x")));
        assert.equal(analyzeRanges(f, { x: ok }).range.nan, false, `${name} in-domain`);
        assert.equal(analyzeRanges(f, { x: bad }).range.nan, true, `${name} out-of-domain`);
    }
    assert.equal(analyzeRanges(def(["x"], call("pow", v("x"), num(0.5))), { x: [-1, 1] }).range.nan, true);
    assert.equal(analyzeRanges(def(["x"], call("pow", v("x"), num(2))), { x: [-1, 1] }).range.nan, false);
    assert.equal(analyzeRanges(def(["x"], div(v("x"), v("x"))), { x: [-1, 1] }).range.nan, true);
});

// Soundness across every primitive: each is exercised over a range that
// straddles its interesting points (domain edges, sign change, poles).
const PRIMITIVE_RANGES = {
    sqrt: [[-1, 9]], abs: [[-3, 2]], sin: [[-4, 4], [0.1, 0.5], [1, 2]], cos: [[-4, 4], [0.1, 0.5], [3, 3.5]],
    tan: [[-1, 1], [1, 2]], asin: [[-1, 1]], acos: [[-1, 1]], atan: [[-9, 9]],
    log: [[0, 5], [0.5, 5]], log2: [[0.25, 8]], log10: [[0.01, 100]], exp: [[-3, 3]],
    floor: [[-2.5, 2.5]], ceil: [[-2.5, 2.5]], round: [[-2.5, 2.5]], trunc: [[-2.5, 2.5]], sign: [[-2, 2]],
};
for (const [name, rangesList] of Object.entries(PRIMITIVE_RANGES)) {
    test(`soundness: ${name}`, () => {
        for (const range of rangesList) assertSound(def(["x"], call(name, v("x"))), { x: range });
    });
}

const BINARY_RANGES = {
    pow: [[[0.5, 3], [-2, 3]], [[-2, 3], [2, 2]], [[-2, 3], [3, 3]], [[-2, 3], [-2, -2]], [[0, 2], [0, 2]], [[-2, 2], [0.5, 2]]],
    atan2: [[[-2, 2], [-2, 2]]],
    min: [[[-2, 2], [-1, 5]]],
    max: [[[-2, 2], [-1, 5]]],
    hypot: [[[-2, 3], [1, 4]], [[-2, 3], [-4, -1]]],
    wrapIndex: [[[-7, 7], [1, 5]]],
};
for (const [name, cases] of Object.entries(BINARY_RANGES)) {
    test(`soundness: ${name}`, () => {
        for (const [a, b] of cases) assertSound(def(["a", "b"], call(name, v("a"), v("b"))), { a, b });
    });
}

test("soundness: clampIndex", () => {
    assertSound(def(["i", "lo", "hi"], call("clampIndex", v("i"), v("lo"), v("hi"))), { i: [-10, 10], lo: [0, 2], hi: [3, 6] });
});

test("every built-in primitive has an interval rule and a soundness case", () => {
    const covered = new Set([
        ...Object.keys(PRIMITIVE_RANGES), ...Object.keys(BINARY_RANGES), "clampIndex",
    ]);
    for (const name of Object.keys(PRIMITIVE_ARITY)) {
        assert.ok(covered.has(name), `${name} has no soundness case in test/analyze.test.js`);
        const args = Array.from({ length: PRIMITIVE_ARITY[name] }, () => num(1));
        analyzeRanges(def([], call(name, ...args)), {});
    }
});

test("soundness: random expression trees over + - * / and select", () => {
    const rand = rng(7);
    const leaf = () => (rand() < 0.5 ? v(rand() < 0.5 ? "x" : "y") : num(Math.round((rand() * 6 - 3) * 4) / 4));
    const gen = (depth) => {
        if (depth === 0) return leaf();
        const k = rand();
        if (k < 0.2) return add(gen(depth - 1), gen(depth - 1));
        if (k < 0.4) return sub(gen(depth - 1), gen(depth - 1));
        if (k < 0.6) return mul(gen(depth - 1), gen(depth - 1));
        if (k < 0.75) return div(gen(depth - 1), add(call("abs", gen(depth - 1)), num(0.5)));
        const ops = [">", "<", ">=", "<=", "==", "!="];
        return select(cmp(gen(depth - 1), ops[Math.floor(rand() * 6)], gen(depth - 1)), gen(depth - 1), gen(depth - 1));
    };
    for (let i = 0; i < 60; i++) {
        assertSound({ name: `rand${i}`, params: ["x", "y"], body: gen(4) }, { x: [-2, 3], y: [-1, 1] }, 60, i + 1);
    }
});

test("soundness: every shipped sample with scalar parameters", () => {
    const all = [];
    for (const [name, ast] of Object.entries(samples)) {
        for (const a of Array.isArray(ast) ? ast : [ast]) all.push([name, a]);
    }
    let checked = 0;
    for (const [name, ast] of all) {
        if (ast.paramTypes) continue;
        const ranges = {};
        for (const p of ast.params) ranges[p] = [-2, 2];
        try {
            evaluate(ast, ast.params.map(() => 0.5));
        } catch {
            continue;
        }
        assertSound({ ...ast, name }, ranges, 60);
        checked++;
    }
    assert.ok(checked >= 10, `only ${checked} samples were checked`);
});

test("spline-frame's hand-written EPS guards all clamp their own denominators: no warnings, none load-bearing", () => {
    let selectCount = 0;
    for (const ast of samples.splineFrame) {
        const ranges = {};
        for (const p of ast.params) ranges[p] = [-10, 10];
        const r = analyzeRanges(ast, ranges);
        assert.deepEqual(warningsOf(r), [], ast.name);
        assert.ok(r.selects.every((s) => !s.loadBearing), ast.name);
        selectCount += r.selects.length;
    }
    assert.ok(selectCount > 0);
});

// ---- branch narrowing, severity and plain-language messages ---------------

const X_GT_10_RECIP = (x = v("x")) => select(cmp(x, ">", num(10)), div(num(1), v("x")), num(0));
const hazards = (r) => r.findings.filter((x) => x.kind === "div-by-zero");

test("narrowing: x in [-20, 20], x > 10 ? 1/x : 0 has no div-by-zero", () => {
    const r = analyzeRanges(def(["x"], X_GT_10_RECIP()), { x: [-20, 20] });
    assert.deepEqual(hazards(r), []);
    assert.ok(r.range.lo >= 0 && r.range.hi <= 0.1 + 1e-12);
});

test("narrowing: x in [-1, 1] gives only informational notes and the range [0, 0]", () => {
    const r = analyzeRanges(def(["x"], X_GT_10_RECIP()), { x: [-1, 1] });
    assert.deepEqual(r.range, { lo: 0, hi: 0, nan: false });
    assert.deepEqual(warningsOf(r), []);
    assert.ok(r.findings.length > 0);
    assert.ok(r.findings.every((x) => x.severity === "info"));
});

// Each case: 1/x in the then-branch is safe iff narrowing excluded zero.
const NARROW = [
    // [op, constant, safe in then-branch, safe in else-branch]
    [">", 0, true, false],
    [">=", 1, true, false],
    ["<", 0, true, false],
    ["<=", -1, true, false],
    ["==", 3, true, false],
    ["!=", 0, true, false],
];
const SWAP = { ">": "<", "<": ">", ">=": "<=", "<=": ">=", "==": "==", "!=": "!=" };
for (const [op, c, thenSafe, elseSafe] of NARROW) {
    for (const flipped of [false, true]) {
        const cond = flipped ? cmp(num(c), SWAP[op], v("x")) : cmp(v("x"), op, num(c));
        const label = flipped ? `${c} ${SWAP[op]} x` : `x ${op} ${c}`;
        test(`narrowing: ${label} over [-5, 5]`, () => {
            const inThen = analyzeRanges(def(["x"], select(cond, div(num(1), v("x")), num(0))), { x: [-5, 5] });
            const inElse = analyzeRanges(def(["x"], select(cond, num(0), div(num(1), v("x")))), { x: [-5, 5] });
            assert.equal(hazards(inThen).length === 0, thenSafe, `then ${label}`);
            assert.equal(hazards(inElse).length === 0, elseSafe, `else ${label}`);
            assertSound(def(["x"], select(cond, div(num(1), v("x")), num(0))), { x: [-5, 5] });
        });
    }
}

test("narrowing: strict bounds are approximated closed, never losing a value", () => {
    // x > 2 narrows to [2, 5]; 2 itself is included (superset), so 1/x spans [0.2, 0.5].
    const r = analyzeRanges(def(["x"], select(cmp(v("x"), ">", num(2)), div(num(1), v("x")), num(0))), { x: [-5, 5] });
    assert.ok(r.range.lo <= 0 && r.range.hi >= 0.5 - 1e-12);
    // x > 0 keeps 0 in the closed hull but records nonzero, so 1/x is still safe.
    const z = analyzeRanges(def(["x"], select(cmp(v("x"), ">", num(0)), div(num(1), v("x")), num(0))), { x: [-5, 5] });
    assert.deepEqual(hazards(z), []);
    // x >= 0 does not exclude zero: the division stays a hazard.
    const g = analyzeRanges(def(["x"], select(cmp(v("x"), ">=", num(0)), div(num(1), v("x")), num(0))), { x: [-5, 5] });
    assert.equal(hazards(g).length, 1);
});

test("narrowing: the else side of x != 0 is x == 0, a certain hazard", () => {
    const f = def(["x"], select(cmp(v("x"), "!=", num(0)), num(0), div(num(1), v("x"))));
    const r = analyzeRanges(f, { x: [-5, 5] });
    assert.equal(hazards(r)[0].certain, true);
});

test("unreachable: contradictory conditions mark the branch unreachable", () => {
    const f = def(["x"], select(cmp(v("x"), ">", num(0)), num(1), select(cmp(v("x"), ">", num(1)), div(num(1), num(0)), num(2))));
    const r = analyzeRanges(f, { x: [0, 5] });
    assert.deepEqual(warningsOf(r), []);
    assert.ok(r.findings.some((x) => x.kind === "div-unreachable"));
});

test("nested selects: the inner condition is decided using the outer narrowing", () => {
    const inner = select(cmp(v("x"), "<", num(5)), div(num(1), v("x")), num(7));
    const f = def(["x"], select(cmp(v("x"), ">", num(10)), inner, num(0)));
    const r = analyzeRanges(f, { x: [-20, 20] });
    assert.equal(r.selects.length, 2);
    assert.equal(r.selects[1].outcome, "always-else");
    assert.deepEqual(hazards(r), []);
    assert.deepEqual(r.range, { lo: 0, hi: 7, nan: false });
    assert.equal(r.findings.filter((x) => x.kind === "condition-decided").length, 1);
});

test("findings: every finding carries a severity and a message", () => {
    const f = def(["x", "d"], add(div(v("x"), v("d")), X_GT_10_RECIP()));
    const r = analyzeRanges(f, { x: [-1, 1], d: [-1, 1] });
    for (const x of r.findings) {
        assert.ok(["warning", "info"].includes(x.severity));
        assert.equal(typeof x.message, "string");
        assert.equal(typeof x.at, "string");
    }
    assert.ok(r.selects.every((s) => s.severity === "info" && typeof s.message === "string"));
});

test("messages: div-by-zero", () => {
    const r = analyzeRanges(def(["x"], div(num(1), v("x"))), { x: [-20, 20] });
    assert.equal(r.findings[0].message, "`1 / x` can divide by zero: `x` can be 0 (range \u221220\u202620).");
    const c = analyzeRanges(def(["x"], div(num(1), sub(v("x"), v("x")))), { x: [3, 3] });
    assert.equal(c.findings[0].message, "`1 / (x - x)` always divides by zero: `x - x` is always 0.");
});

test("messages: decided condition and unreachable division", () => {
    const r = analyzeRanges(def(["x"], X_GT_10_RECIP()), { x: [-1, 1] });
    assert.equal(r.findings[0].message, "Condition `x > 10` is never true for these inputs, so this always returns `0`.");
    assert.equal(r.selects[0].message, r.findings[0].message);
    assert.equal(
        r.findings[1].message,
        "`1 / x` never runs for these inputs (`x > 10` is never true here), so its zero denominator is not a hazard.",
    );
    const t = analyzeRanges(def(["x"], select(cmp(v("x"), ">", num(0)), num(1), num(2))), { x: [1, 2] });
    assert.equal(t.findings[0].message, "Condition `x > 0` is always true for these inputs, so this always returns `1`.");
});

test("messages: guarded division names the guard and the eager targets", () => {
    const r = analyzeRanges(def(["x"], X_GT_10_RECIP()), { x: [-20, 20] });
    assert.equal(r.findings[0].kind, "div-guarded");
    assert.deepEqual(r.findings[0].guardConditions, ["x > 10"]);
    assert.match(r.findings[0].message, /^`1 \/ x` is protected from a zero denominator only by the condition `x > 10`/);
    const eager = require("../emitters/meta.js").eagerSelectTargets();
    assert.match(eager, /QB64/);
    assert.ok(r.findings[0].message.includes(`(${eager})`), r.findings[0].message);
});
