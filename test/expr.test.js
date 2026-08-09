// exprforge/test/expr.test.js
//
// Structural unit tests for expr.js -- mirrors test/ast.test.js's/
// test/math.test.js's style (checking node shapes directly via
// assert.deepStrictEqual against hand-built trees). `expr` is pure syntax
// sugar over ast.js's own builders (see expr.js's header comment), so
// most of what's worth testing here is "does this template literal parse
// to the exact tree the equivalent hand-built call would" -- there's no
// separate emitter-compatibility risk to cover, since expr.js never
// constructs a raw {type: ...} object itself. Real cross-language
// verification of an expr()-built formula lives in
// test/conformance.test.js, same split as math.test.js/math-demo.js.

const test = require("node:test");
const assert = require("node:assert");
const {
    num, v, add, sub, mul, div, neg, call, cmp, select, letIn, collectLets,
} = require("../ast.js");
const { expr } = require("../expr.js");

test("basic precedence: multiplication before addition", () => {
    assert.deepStrictEqual(expr`a + b * c`, add(v("a"), mul(v("b"), v("c"))));
});

test("basic precedence: division before subtraction, left-associative", () => {
    assert.deepStrictEqual(expr`a - b / c`, sub(v("a"), div(v("b"), v("c"))));
    assert.deepStrictEqual(expr`a - b - c`, sub(sub(v("a"), v("b")), v("c")));
});

test("^ lowers to call(\"pow\", ...), never a bin node", () => {
    const node = expr`a ^ b`;
    assert.strictEqual(node.type, "call");
    assert.strictEqual(node.name, "pow");
    assert.deepStrictEqual(node, call("pow", v("a"), v("b")));
});

test("^ is right-associative: 2^3^2 = 2^(3^2)", () => {
    assert.deepStrictEqual(expr`2^3^2`, call("pow", num(2), call("pow", num(3), num(2))));
});

test("unary minus binds looser than ^: -2^2 = -(2^2)", () => {
    assert.deepStrictEqual(expr`-2^2`, neg(call("pow", num(2), num(2))));
});

test("^'s right operand can carry its own leading unary minus: 2^-1", () => {
    assert.deepStrictEqual(expr`2^-1`, call("pow", num(2), neg(num(1))));
});

test("unary plus is a no-op", () => {
    assert.deepStrictEqual(expr`+a + b`, add(v("a"), v("b")));
});

test("function calls: 1-arg, 2-arg, and 3-arg", () => {
    assert.deepStrictEqual(expr`sqrt(x)`, call("sqrt", v("x")));
    assert.deepStrictEqual(expr`atan2(y, x)`, call("atan2", v("y"), v("x")));
    assert.deepStrictEqual(expr`clamp(t, 0, 1)`, call("clamp", v("t"), num(0), num(1)));
});

test("nested function calls", () => {
    assert.deepStrictEqual(expr`sqrt(sqr(x) + sqr(y))`, call("sqrt", add(call("sqr", v("x")), call("sqr", v("y")))));
});

test("parens override default precedence", () => {
    assert.deepStrictEqual(expr`(a + b) * c`, mul(add(v("a"), v("b")), v("c")));
});

test("numeric literal forms: integer, decimal, leading-dot, exponent", () => {
    assert.deepStrictEqual(expr`5`, num(5));
    assert.deepStrictEqual(expr`0.5`, num(0.5));
    assert.deepStrictEqual(expr`.5`, num(0.5));
    assert.deepStrictEqual(expr`1e-9`, num(1e-9));
    assert.deepStrictEqual(expr`1.5E+2`, num(150));
});

test("identifiers with underscores parse as vars, matching real param names", () => {
    assert.deepStrictEqual(expr`wy_wire + 1`, add(v("wy_wire"), num(1)));
});

test("ternary lowers to select(cmp(...), then, else) -- the only place cmp is valid", () => {
    assert.deepStrictEqual(expr`a > b ? x : y`, select(cmp(v("a"), ">", v("b")), v("x"), v("y")));
});

test("all six comparison operators", () => {
    assert.deepStrictEqual(expr`a > 0 ? 1 : 0`, select(cmp(v("a"), ">", num(0)), num(1), num(0)));
    assert.deepStrictEqual(expr`a < 0 ? 1 : 0`, select(cmp(v("a"), "<", num(0)), num(1), num(0)));
    assert.deepStrictEqual(expr`a >= 0 ? 1 : 0`, select(cmp(v("a"), ">=", num(0)), num(1), num(0)));
    assert.deepStrictEqual(expr`a <= 0 ? 1 : 0`, select(cmp(v("a"), "<=", num(0)), num(1), num(0)));
    assert.deepStrictEqual(expr`a == 0 ? 1 : 0`, select(cmp(v("a"), "==", num(0)), num(1), num(0)));
    assert.deepStrictEqual(expr`a != 0 ? 1 : 0`, select(cmp(v("a"), "!=", num(0)), num(1), num(0)));
});

test("chained ternary nests through the else branch, right-associative", () => {
    assert.deepStrictEqual(
        expr`a > 0 ? 1 : b > 0 ? 2 : 3`,
        select(cmp(v("a"), ">", num(0)), num(1), select(cmp(v("b"), ">", num(0)), num(2), num(3))),
    );
});

test("a bare comparison with no '?' throws a clear parse error", () => {
    assert.throws(() => expr`a > b`, /comparison \(">"\) must be used as a ternary condition/);
});

test("a bare '?' with no comparison throws a clear parse error", () => {
    assert.throws(() => expr`a ? x : y`, /needs an explicit comparison as its condition/);
});

test("interpolation splices an existing AST node in as-is", () => {
    const dot = add(mul(v("ax"), v("bx")), mul(v("ay"), v("by")));
    assert.deepStrictEqual(expr`${dot} + 1`, add(dot, num(1)));
});

test("interpolation auto-wraps a plain JS number via num()", () => {
    assert.deepStrictEqual(expr`${5} + a`, add(num(5), v("a")));
});

test("interpolation rejects a plain string -- ambiguous with a bare identifier", () => {
    assert.throws(() => expr`${"a"} + b`, /interpolated value must be an AST node or a plain number/);
});

test("interpolation rejects undefined/objects with no .type", () => {
    assert.throws(() => expr`${undefined} + b`, /interpolated value must be an AST node or a plain number/);
    assert.throws(() => expr`${{}} + b`, /interpolated value must be an AST node or a plain number/);
});

test("expr output round-trips through collectLets exactly like a hand-built tree", () => {
    const tree = letIn("mag", expr`sqrt(x^2 + y^2)`, expr`x > 0 ? x / mag : ${num(-1)}`);
    const { bindings, body } = collectLets(tree);
    assert.strictEqual(bindings.length, 1);
    assert.strictEqual(bindings[0].name, "mag");
    assert.deepStrictEqual(
        bindings[0].node,
        call("sqrt", add(call("pow", v("x"), num(2)), call("pow", v("y"), num(2)))),
    );
    assert.strictEqual(body.type, "select");
});
