// exprforge/test/fn.test.js
//
// Structural unit tests for fn.js -- same style as test/expr.test.js
// (assert.deepStrictEqual against hand-built trees via ast.js). Since
// fn's own grammar is a thin statement layer that hands every expression
// off to expr.js's own parseExpression() (see fn.js's header comment),
// this deliberately does NOT re-cover precedence/^/ternary/interpolation
// -- that's expr.test.js's job, and duplicating it here would only prove
// the same thing twice. What's specific to fn: let-statements, return
// (single and multi-output), and the errors fn's own statement grammar
// can produce that expr's never could.

const test = require("node:test");
const assert = require("node:assert");
const {
    num, v, add, sub, mul, div, call, letIn, letChain, outputs, cmp, select, collectLets,
} = require("../ast.js");
const { fn } = require("../fn.js");
const { expr } = require("../expr.js");

test("no let statements: a bare return is just the expression, no let wrapper", () => {
    assert.deepStrictEqual(fn`return a + b;`, add(v("a"), v("b")));
});

test("a single let statement wraps the return in letIn", () => {
    assert.deepStrictEqual(
        fn`let m = a + b; return m * 2;`,
        letIn("m", add(v("a"), v("b")), mul(v("m"), num(2))),
    );
});

test("multiple let statements chain in order, matching hand-built letChain", () => {
    assert.deepStrictEqual(
        fn`
            let m = a + b;
            let n = m * 2;
            return n - 1;
        `,
        letChain([["m", add(v("a"), v("b"))], ["n", mul(v("m"), num(2))]], sub(v("n"), num(1))),
    );
});

test("a later let statement can reference an earlier one's name", () => {
    const node = fn`let m = a * a; let n = m + 1; return n;`;
    assert.strictEqual(node.type, "let");
    assert.strictEqual(node.name, "m");
    assert.strictEqual(node.body.type, "let");
    assert.strictEqual(node.body.name, "n");
    assert.deepStrictEqual(node.body.value, add(v("m"), num(1)));
});

test("single-expression return, matching expr's own parseExpression exactly", () => {
    assert.deepStrictEqual(
        fn`let d = a - b; return d > 0 ? d : ${expr`0 - d`};`,
        letIn("d", sub(v("a"), v("b")), select(cmp(v("d"), ">", num(0)), v("d"), sub(num(0), v("d")))),
    );
});

test("multi-output return lowers to outputs(), wrapped in the same let-chain", () => {
    assert.deepStrictEqual(
        fn`
            let mag = sqrt(x^2 + y^2);
            return { nx: x / mag, ny: y / mag };
        `,
        letIn(
            "mag",
            call("sqrt", add(call("pow", v("x"), num(2)), call("pow", v("y"), num(2)))),
            outputs({ nx: div(v("x"), v("mag")), ny: div(v("y"), v("mag")) }),
        ),
    );
});

test("multi-output return with no let statements at all", () => {
    assert.deepStrictEqual(fn`return { a: x, b: y };`, outputs({ a: v("x"), b: v("y") }));
});

test("a single-field multi-output return still parses (not confused with a plain expression)", () => {
    assert.deepStrictEqual(fn`return { only: x + 1 };`, outputs({ only: add(v("x"), num(1)) }));
});

// --- shorthand "return { rx, ry, rz };" -----------------------------------

test("a field with no \":\" is shorthand for \"name: name\"", () => {
    assert.deepStrictEqual(fn`return { rx, ry, rz };`, outputs({ rx: v("rx"), ry: v("ry"), rz: v("rz") }));
});

test("shorthand and explicit fields freely mix, in either order", () => {
    assert.deepStrictEqual(
        fn`return { rx, ry: ry * 2, rz };`,
        outputs({ rx: v("rx"), ry: mul(v("ry"), num(2)), rz: v("rz") }),
    );
});

test("a single shorthand field still parses (not confused with a plain expression)", () => {
    assert.deepStrictEqual(fn`return { only };`, outputs({ only: v("only") }));
});

test("shorthand fields work with let-bound names too", () => {
    assert.deepStrictEqual(
        fn`let rx = a + b; return { rx };`,
        letIn("rx", add(v("a"), v("b")), outputs({ rx: v("rx") })),
    );
});

test("interpolation still works inside let/return, same mechanism as expr", () => {
    const dot = add(mul(v("ax"), v("bx")), mul(v("ay"), v("by")));
    assert.deepStrictEqual(
        fn`let d = ${dot}; return d + ${5};`,
        letIn("d", dot, add(v("d"), num(5))),
    );
});

test("missing \"return\" throws a clear parse error", () => {
    assert.throws(() => fn`let x = 1;`, /expected "return"/);
});

test("a let statement missing its terminating \";\" throws", () => {
    assert.throws(() => fn`let x = 1 return x;`, /expected ";"/);
});

test("a return statement missing its terminating \";\" throws", () => {
    assert.throws(() => fn`return 1`, /expected ";"/);
});

test("\"let\" with no identifier throws", () => {
    assert.throws(() => fn`let = 1; return x;`, /expected an identifier after "let"/);
});

test("a malformed multi-output return (missing closing brace) throws", () => {
    assert.throws(() => fn`return { a: 1, b: 2 return x;`, /expected "}"/);
});

test("\"let\"/\"return\" are still ordinary identifiers in plain expr(), unaffected by fn.js existing", () => {
    assert.deepStrictEqual(expr`let * 2`, mul(v("let"), num(2)));
});

test("duplicate let-binding names still parse fine -- the error is deferred to collectLets, not the parser", () => {
    const node = fn`let m = 1; let m = 2; return m;`;
    assert.throws(() => collectLets(node), /duplicate let binding name "m"/);
});

test("fn output round-trips through collectLets, same guarantee expr.test.js proves for expr", () => {
    const node = fn`
        let mag = sqrt(x^2 + y^2);
        return x > 0 ? x / mag : ${num(-1)};
    `;
    const { bindings, body } = collectLets(node);
    assert.strictEqual(bindings.length, 1);
    assert.strictEqual(bindings[0].name, "mag");
    assert.deepStrictEqual(
        bindings[0].node,
        call("sqrt", add(call("pow", v("x"), num(2)), call("pow", v("y"), num(2)))),
    );
    assert.strictEqual(body.type, "select");
});

// --- optional "name(params):" signature line -----------------------------

test("no signature: fn still returns a bare Node, exactly as before this feature existed", () => {
    const result = fn`let m = a + b; return m * 2;`;
    assert.strictEqual(result.type, "let");
    assert.deepStrictEqual(result, letIn("m", add(v("a"), v("b")), mul(v("m"), num(2))));
});

test("a signature with params produces {name, params, body} directly", () => {
    const result = fn`
        normalize(x, y):
        let mag = sqrt(x^2 + y^2);
        return x / mag;
    `;
    assert.strictEqual(result.name, "normalize");
    assert.deepStrictEqual(result.params, ["x", "y"]);
    assert.deepStrictEqual(
        result.body,
        letIn("mag", call("sqrt", add(call("pow", v("x"), num(2)), call("pow", v("y"), num(2)))), div(v("x"), v("mag"))),
    );
});

test("a signature with zero params: empty parens still parse", () => {
    const result = fn`
        always1():
        return 1;
    `;
    assert.strictEqual(result.name, "always1");
    assert.deepStrictEqual(result.params, []);
    assert.deepStrictEqual(result.body, num(1));
});

test("a signature with no let statements at all", () => {
    const result = fn`
        area(w, h):
        return w * h;
    `;
    assert.strictEqual(result.name, "area");
    assert.deepStrictEqual(result.params, ["w", "h"]);
    assert.deepStrictEqual(result.body, mul(v("w"), v("h")));
});

test("a signature wrapping a multi-output return", () => {
    const result = fn`
        normalize2(x, y):
        let mag = sqrt(x^2 + y^2);
        return { nx: x / mag, ny: y / mag };
    `;
    assert.strictEqual(result.name, "normalize2");
    assert.deepStrictEqual(result.params, ["x", "y"]);
    assert.deepStrictEqual(
        result.body,
        letIn(
            "mag",
            call("sqrt", add(call("pow", v("x"), num(2)), call("pow", v("y"), num(2)))),
            outputs({ nx: div(v("x"), v("mag")), ny: div(v("y"), v("mag")) }),
        ),
    );
});

test("the produced {name, params, body} plugs directly into emitAll() and evaluate() with no wrapping", () => {
    const { emitAll, evaluate } = require("../index.js");
    const def = fn`
        hyp(a, b):
        return sqrt(a^2 + b^2);
    `;
    assert.strictEqual(evaluate(def, [3, 4]), 5);
    const out = emitAll(def);
    assert.match(out.python.source, /def hyp\(a, b\)/);
    assert.match(out.rust.source, /fn hyp\(a: f64, b: f64\)/);
});

test("a param list missing a comma throws", () => {
    assert.throws(() => fn`bad(x y): return x;`, /expected "\)"/);
});

test("a trailing comma in the param list throws", () => {
    assert.throws(() => fn`bad(x,): return x;`, /expected an identifier as a parameter name/);
});

test("a signature missing its terminating \":\" throws", () => {
    assert.throws(() => fn`bad(x, y) return x;`, /expected ":"/);
});

test("naming a function \"let\" or \"return\" is not treated as a signature -- those always start a statement instead", () => {
    // Documented, deliberate limitation (see fn.js's looksLikeSignature
    // comment): the 2-token lookahead can't tell "a signature named let"
    // apart from "a let statement" without ambiguity, so it doesn't try.
    assert.throws(() => fn`let(x): return x;`, /expected an identifier after "let"/);
});
