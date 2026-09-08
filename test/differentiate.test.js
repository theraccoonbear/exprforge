// exprforge/test/differentiate.test.js
//
// Symbolic differentiation tests. Each rule is verified numerically:
// evaluate the symbolic derivative at sample points, compare against a
// central-difference approximation of the original function's derivative
// at the same points. This is the "prove it by running it" approach
// described in the issue -- much more reliable than hand-checking
// algebraic correctness.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    num, v, add, sub, mul, div, call, letIn, select, cmp,
} = require("../ast.js");
const { differentiate } = require("../differentiate.js");
const { evaluate } = require("../evaluate.js");

// Numerical central-difference approximation of df/dx at point x.
// h = 1e-7 gives good precision for float64 without catastrophic
// cancellation.
function numericalDerivative(fn, varName, point, h = 1e-7) {
    const env = { ...point };
    const envP = { ...env, [varName]: env[varName] + h };
    const envM = { ...env, [varName]: env[varName] - h };
    return (evaluate(fn, Object.values(envP)) - evaluate(fn, Object.values(envM))) / (2 * h);
}

// Wrap an expression body as a {name, params, body} definition for evaluate().
function makeFn(params, body) {
    return { name: "f", params, body };
}

// Assert the symbolic derivative matches the numerical approximation
// across several sample points.
function assertDerivativeMatches(exprBody, varName, params, points, tolerance = 1e-5) {
    const fn = makeFn(params, exprBody);
    const dNode = differentiate(exprBody, varName);
    const dFn = makeFn(params, dNode);

    for (const point of points) {
        const expected = numericalDerivative(fn, varName, point);
        const actual = evaluate(dFn, Object.values(point));
        const relErr = Math.abs(expected) > 1e-10
            ? Math.abs((actual - expected) / expected)
            : Math.abs(actual - expected);
        assert.ok(
            relErr < tolerance,
            `d/d${varName} at ${JSON.stringify(point)}: expected ${expected}, got ${actual} (relErr=${relErr})`,
        );
    }
}

// --- Arithmetic operations ---

test("d/dx (x + c) = 1", () => {
    assertDerivativeMatches(
        add(v("x"), num(5)),
        "x", ["x"],
        [{ x: 0 }, { x: 3 }, { x: -2 }],
    );
});

test("d/dx (c + x) = 1", () => {
    assertDerivativeMatches(
        add(num(5), v("x")),
        "x", ["x"],
        [{ x: 0 }, { x: 3 }],
    );
});

test("d/dx (x - c) = 1", () => {
    assertDerivativeMatches(
        sub(v("x"), num(3)),
        "x", ["x"],
        [{ x: 0 }, { x: 5 }],
    );
});

test("d/dx (c - x) = -1", () => {
    assertDerivativeMatches(
        sub(num(3), v("x")),
        "x", ["x"],
        [{ x: 0 }, { x: 5 }],
    );
});

test("d/dx (x * x) = 2x (product rule)", () => {
    assertDerivativeMatches(
        mul(v("x"), v("x")),
        "x", ["x"],
        [{ x: 1 }, { x: 3 }, { x: -2 }, { x: 0.5 }],
    );
});

test("d/dx (x * c) = c", () => {
    assertDerivativeMatches(
        mul(v("x"), num(7)),
        "x", ["x"],
        [{ x: 0 }, { x: 4 }],
    );
});

test("d/dx (x / c) = 1/c", () => {
    assertDerivativeMatches(
        div(v("x"), num(4)),
        "x", ["x"],
        [{ x: 1 }, { x: -3 }],
    );
});

test("d/dx (c / x) = -c/x² (quotient rule)", () => {
    assertDerivativeMatches(
        div(num(10), v("x")),
        "x", ["x"],
        [{ x: 1 }, { x: 2 }, { x: -1 }],
    );
});

test("d/dx ((x*2 + 1) / (x + 3)) quotient of复合 expressions", () => {
    assertDerivativeMatches(
        div(add(mul(v("x"), num(2)), num(1)), add(v("x"), num(3))),
        "x", ["x"],
        [{ x: 0 }, { x: 1 }, { x: 5 }, { x: -2 }],
    );
});

// --- Built-in functions ---

test("d/dx sqrt(x) = 1/(2*sqrt(x))", () => {
    assertDerivativeMatches(
        call("sqrt", v("x")),
        "x", ["x"],
        [{ x: 0.5 }, { x: 1 }, { x: 4 }, { x: 9 }],
    );
});

test("d/dx sin(x) = cos(x)", () => {
    assertDerivativeMatches(
        call("sin", v("x")),
        "x", ["x"],
        [{ x: 0 }, { x: 1 }, { x: 3 }, { x: -1 }],
    );
});

test("d/dx cos(x) = -sin(x)", () => {
    assertDerivativeMatches(
        call("cos", v("x")),
        "x", ["x"],
        [{ x: 0 }, { x: 1 }, { x: 3 }, { x: -1 }],
    );
});

test("d/dx tan(x) = 1/cos²(x) = sec²(x)", () => {
    assertDerivativeMatches(
        call("tan", v("x")),
        "x", ["x"],
        [{ x: 0 }, { x: 0.5 }, { x: -0.5 }],
    );
});

test("d/dx asin(x) = 1/sqrt(1-x²)", () => {
    assertDerivativeMatches(
        call("asin", v("x")),
        "x", ["x"],
        [{ x: 0 }, { x: 0.5 }, { x: -0.5 }, { x: 0.9 }],
    );
});

test("d/dx acos(x) = -1/sqrt(1-x²)", () => {
    assertDerivativeMatches(
        call("acos", v("x")),
        "x", ["x"],
        [{ x: 0 }, { x: 0.5 }, { x: -0.5 }, { x: 0.9 }],
    );
});

test("d/dx atan(x) = 1/(1+x²)", () => {
    assertDerivativeMatches(
        call("atan", v("x")),
        "x", ["x"],
        [{ x: 0 }, { x: 1 }, { x: -1 }, { x: 3 }],
    );
});

test("d/dx log(x) = 1/x", () => {
    assertDerivativeMatches(
        call("log", v("x")),
        "x", ["x"],
        [{ x: 0.5 }, { x: 1 }, { x: 3 }, { x: 10 }],
    );
});

test("d/dx log2(x) = 1/(x*ln2)", () => {
    assertDerivativeMatches(
        call("log2", v("x")),
        "x", ["x"],
        [{ x: 1 }, { x: 2 }, { x: 8 }],
    );
});

test("d/dx log10(x) = 1/(x*ln10)", () => {
    assertDerivativeMatches(
        call("log10", v("x")),
        "x", ["x"],
        [{ x: 1 }, { x: 10 }, { x: 100 }],
    );
});

test("d/dx exp(x) = exp(x)", () => {
    assertDerivativeMatches(
        call("exp", v("x")),
        "x", ["x"],
        [{ x: 0 }, { x: 1 }, { x: -1 }, { x: 2 }],
    );
});

test("d/dx pow(x, 2) = 2x (power rule, constant exponent)", () => {
    assertDerivativeMatches(
        call("pow", v("x"), num(2)),
        "x", ["x"],
        [{ x: 1 }, { x: 3 }, { x: -2 }, { x: 0 }],
    );
});

test("d/dx pow(x, 3) = 3x² (power rule, constant exponent)", () => {
    assertDerivativeMatches(
        call("pow", v("x"), num(3)),
        "x", ["x"],
        [{ x: 1 }, { x: 2 }, { x: -1 }],
    );
});

test("d/dx pow(2, x) = 2^x * ln2 (exponential rule, constant base)", () => {
    assertDerivativeMatches(
        call("pow", num(2), v("x")),
        "x", ["x"],
        [{ x: 0 }, { x: 1 }, { x: 3 }],
    );
});

test("d/dx pow(x, x) = x^x * (ln(x) + 1) (general case)", () => {
    assertDerivativeMatches(
        call("pow", v("x"), v("x")),
        "x", ["x"],
        [{ x: 1 }, { x: 2 }, { x: 3 }],
    );
});

test("d/dx atan2(x, 1) w.r.t. first arg", () => {
    assertDerivativeMatches(
        call("atan2", v("x"), num(1)),
        "x", ["x"],
        [{ x: 0 }, { x: 1 }, { x: -1 }, { x: 3 }],
    );
});

test("d/dx atan2(1, x) w.r.t. second arg", () => {
    assertDerivativeMatches(
        call("atan2", num(1), v("x")),
        "x", ["x"],
        [{ x: 0 }, { x: 1 }, { x: -1 }, { x: 3 }],
    );
});

test("d/dx min(x, 5) selects correctly", () => {
    // Boundary (x=5) is a cusp where min is non-differentiable --
    // test well away from it on both sides.
    assertDerivativeMatches(
        call("min", v("x"), num(5)),
        "x", ["x"],
        [{ x: 2 }, { x: 4 }, { x: 6 }, { x: 10 }],
    );
});

test("d/dx max(x, 5) selects correctly", () => {
    assertDerivativeMatches(
        call("max", v("x"), num(5)),
        "x", ["x"],
        [{ x: 2 }, { x: 4 }, { x: 6 }, { x: 10 }],
    );
});

test("d/dx hypot(x, 3)", () => {
    assertDerivativeMatches(
        call("hypot", v("x"), num(3)),
        "x", ["x"],
        [{ x: 0 }, { x: 3 }, { x: 4 }, { x: -3 }],
    );
});

// --- Chain rule (nested expressions) ---

test("d/dx sin(x²) = cos(x²) * 2x (chain rule)", () => {
    assertDerivativeMatches(
        call("sin", mul(v("x"), v("x"))),
        "x", ["x"],
        [{ x: 0 }, { x: 1 }, { x: 2 }, { x: -1 }],
    );
});

test("d/dx exp(sin(x)) = exp(sin(x)) * cos(x) (nested chain rule)", () => {
    assertDerivativeMatches(
        call("exp", call("sin", v("x"))),
        "x", ["x"],
        [{ x: 0 }, { x: 1 }, { x: -1 }, { x: 3 }],
    );
});

test("d/dx sqrt(x² + 1) = x / sqrt(x² + 1)", () => {
    assertDerivativeMatches(
        call("sqrt", add(mul(v("x"), v("x")), num(1))),
        "x", ["x"],
        [{ x: 0 }, { x: 1 }, { x: 3 }, { x: -2 }],
    );
});

test("d/dx log(sin(x)) = cos(x)/sin(x) = cot(x)", () => {
    assertDerivativeMatches(
        call("log", call("sin", v("x"))),
        "x", ["x"],
        [{ x: 1 }, { x: 2 }, { x: 3 }],
    );
});

// --- Multiple variables ---

test("d/dx (x + y) treats y as constant", () => {
    assertDerivativeMatches(
        add(v("x"), v("y")),
        "x", ["x", "y"],
        [{ x: 1, y: 10 }, { x: 3, y: -5 }],
    );
});

test("d/dy (x + y) treats x as constant", () => {
    assertDerivativeMatches(
        add(v("x"), v("y")),
        "y", ["x", "y"],
        [{ x: 10, y: 1 }, { x: -5, y: 3 }],
    );
});

test("d/dx (x * y) = y", () => {
    assertDerivativeMatches(
        mul(v("x"), v("y")),
        "x", ["x", "y"],
        [{ x: 1, y: 7 }, { x: 3, y: -2 }],
    );
});

// --- Constant expression ---

test("d/dx of a constant is 0", () => {
    const d = differentiate(num(42), "x");
    assert.deepStrictEqual(d, num(0));
});

test("d/dx of a different variable is 0", () => {
    const d = differentiate(v("y"), "x");
    assert.deepStrictEqual(d, num(0));
});

// --- Non-differentiable functions ---

test("differentiating floor throws", () => {
    assert.throws(
        () => differentiate(call("floor", v("x")), "x"),
        /not differentiable/,
    );
});

test("differentiating ceil throws", () => {
    assert.throws(
        () => differentiate(call("ceil", v("x")), "x"),
        /not differentiable/,
    );
});

test("differentiating round throws", () => {
    assert.throws(
        () => differentiate(call("round", v("x")), "x"),
        /not differentiable/,
    );
});

test("differentiating trunc throws", () => {
    assert.throws(
        () => differentiate(call("trunc", v("x")), "x"),
        /not differentiable/,
    );
});

test("differentiating sign throws", () => {
    assert.throws(
        () => differentiate(call("sign", v("x")), "x"),
        /not differentiable/,
    );
});

// --- Error cases ---

test("differentiating a let node throws (must be resolved first)", () => {
    assert.throws(
        () => differentiate(letIn("t", v("x"), v("t")), "x"),
        /unexpected node type "let"/,
    );
});

// --- Structurally complex expression ---

test("d/dx of (sin(x)*cos(x) + x^3) / sqrt(x)", () => {
    assertDerivativeMatches(
        div(
            add(
                mul(call("sin", v("x")), call("cos", v("x"))),
                call("pow", v("x"), num(3)),
            ),
            call("sqrt", v("x")),
        ),
        "x", ["x"],
        [{ x: 1 }, { x: 2 }, { x: 4 }, { x: 0.5 }],
    );
});

// --- Simplification: differentiate() output is structurally clean ---

test("simplify: d/dy of expression with no y is exactly num(0)", () => {
    const expr = call("sqrt", add(mul(v("x"), v("x")), num(1)));
    const d = differentiate(expr, "y");
    assert.deepStrictEqual(d, num(0));
});

test("simplify: d/dx of x is exactly num(1)", () => {
    const d = differentiate(v("x"), "x");
    assert.deepStrictEqual(d, num(1));
});

test("simplify: d/dx of 5 is exactly num(0)", () => {
    const d = differentiate(num(5), "x");
    assert.deepStrictEqual(d, num(0));
});

test("simplify: d/dx of x + y w.r.t. y is num(1)", () => {
    const d = differentiate(add(v("x"), v("y")), "y");
    assert.deepStrictEqual(d, num(1));
});

test("simplify: d/dx of x * y w.r.t. x simplifies to just y (not y + 0 or 1*y)", () => {
    const d = differentiate(mul(v("x"), v("y")), "x");
    // Should be a direct var reference, not wrapped in * 1 or + 0
    assert.deepStrictEqual(d, v("y"));
});

test("simplify: d/dx of 5*x simplifies to num(5), not 5*1 or (1*5+0)", () => {
    const d = differentiate(mul(num(5), v("x")), "x");
    assert.deepStrictEqual(d, num(5));
});

test("simplify: d/dx of x/3 simplifies to 1/3", () => {
    const d = differentiate(div(v("x"), num(3)), "x");
    assert.deepStrictEqual(d, num(1 / 3));
});

test("simplify: d/dx of sin(x) does not contain * 0 or + 0 nodes", () => {
    const d = differentiate(call("sin", v("x")), "x");
    // Should be cos(x), which is 1*cos(x) simplified to cos(x)
    assert.deepStrictEqual(d, call("cos", v("x")));
});

test("simplify: d/dx of cos(x) does not contain * 1 nodes", () => {
    const d = differentiate(call("cos", v("x")), "x");
    // Should be -sin(x), which is neg(1*sin(x)) simplified to neg(sin(x))
    assert.deepStrictEqual(d, mul(num(-1), call("sin", v("x"))));
});

test("simplify: d/dx of exp(x) is exactly exp(x), not 1*exp(x)", () => {
    const d = differentiate(call("exp", v("x")), "x");
    assert.deepStrictEqual(d, call("exp", v("x")));
});

test("simplify: d/dx of log(x) is exactly 1/x, not 1/x (no extra nodes)", () => {
    const d = differentiate(call("log", v("x")), "x");
    assert.deepStrictEqual(d, div(num(1), v("x")));
});

test("simplify: d/dx of x^2 is 2*x (not 2*x^1*1)", () => {
    const d = differentiate(call("pow", v("x"), num(2)), "x");
    // Power rule: 2 * x^(2-1) * 1 → 2 * x^1 * 1 → 2 * x
    assert.deepStrictEqual(d, mul(num(2), v("x")));
});

test("simplify: d/dx of x^3 is 3*x^2 (not 3*x^2*1)", () => {
    const d = differentiate(call("pow", v("x"), num(3)), "x");
    assert.deepStrictEqual(d, mul(num(3), call("pow", v("x"), num(2))));
});

test("simplify: d/dx of 2^x does not contain * 1 or + 0", () => {
    const d = differentiate(call("pow", num(2), v("x")), "x");
    // Exponential rule: 2^x * ln(2) * 1 → 2^x * ln(2)
    assert.deepStrictEqual(d, mul(call("pow", num(2), v("x")), call("log", num(2))));
});

test("simplify: d/dx of x*x simplifies to x + x, not (1*x + x*1)", () => {
    const d = differentiate(mul(v("x"), v("x")), "x");
    // Product rule: 1*x + x*1 → x + x
    assert.deepStrictEqual(d, add(v("x"), v("x")));
});

test("simplify: d/dx of sin(x)*cos(x) does not contain * 1 nodes", () => {
    const d = differentiate(mul(call("sin", v("x")), call("cos", v("x"))), "x");
    // Should be: cos(x)*cos(x) + sin(x)*(-sin(x))
    // = cos(x)*cos(x) + sin(x)*(-1*sin(x))
    assert.ok(d.type === "bin" && d.op === "+", "should be a sum");
    // Each term should be a simple product, no * 1 wrappers
    const [left, right] = [d.left, d.right];
    assert.ok(left.type === "bin" && left.op === "*", "left term should be product");
    assert.ok(right.type === "bin" && right.op === "*", "right term should be product");
});

test("simplify: constant expression d/dx of 7 is num(0)", () => {
    const d = differentiate(num(7), "x");
    assert.deepStrictEqual(d, num(0));
});

test("simplify: d/dx of atan(x) is 1/(1+x^2), not 1/(1+x^2) with extra nodes", () => {
    const d = differentiate(call("atan", v("x")), "x");
    assert.deepStrictEqual(d, div(num(1), add(num(1), mul(v("x"), v("x")))));
});

test("simplify: d/dx of asin(x) is 1/sqrt(1-x^2)", () => {
    const d = differentiate(call("asin", v("x")), "x");
    assert.deepStrictEqual(d, div(num(1), call("sqrt", sub(num(1), mul(v("x"), v("x"))))));
});

test("simplify: d/dx of acos(x) is -1/sqrt(1-x^2)", () => {
    const d = differentiate(call("acos", v("x")), "x");
    assert.deepStrictEqual(d, div(num(-1), call("sqrt", sub(num(1), mul(v("x"), v("x"))))));
});

test("simplify: d/dx of tan(x) is 1+tan(x)^2, not (1+tan(x)*tan(x)) wrapped in * 1", () => {
    const d = differentiate(call("tan", v("x")), "x");
    assert.deepStrictEqual(d, add(num(1), mul(call("tan", v("x")), call("tan", v("x")))));
});

test("simplify: d/dx of log2(x) is 1/(x*ln2)", () => {
    const d = differentiate(call("log2", v("x")), "x");
    assert.deepStrictEqual(d, div(num(1), mul(v("x"), num(Math.LN2))));
});

test("simplify: d/dx of log10(x) is 1/(x*ln10)", () => {
    const d = differentiate(call("log10", v("x")), "x");
    assert.deepStrictEqual(d, div(num(1), mul(v("x"), num(Math.LN10))));
});

// --- Simplify: chain rule produces clean output ---

test("simplify: d/dx sin(x^2) is (x+x)*cos(x^2), no * 1 or + 0 nodes", () => {
    const d = differentiate(call("sin", mul(v("x"), v("x"))), "x");
    // chain: (x+x) * cos(x*x) — the x+x is from product rule's 1*x + x*1
    assert.deepStrictEqual(d, mul(add(v("x"), v("x")), call("cos", mul(v("x"), v("x")))));
});

test("simplify: d/dx sqrt(x) is 1/(2*sqrt(x))", () => {
    const d = differentiate(call("sqrt", v("x")), "x");
    assert.deepStrictEqual(d, div(num(1), mul(num(2), call("sqrt", v("x")))));
});

test("simplify: d/dx abs(x) is sign(x), not 1*sign(x)", () => {
    const d = differentiate(call("abs", v("x")), "x");
    assert.deepStrictEqual(d, call("sign", v("x")));
});
