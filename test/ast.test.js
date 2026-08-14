// exprforge/test/ast.test.js
//
// Structural unit tests for ast.js itself -- previously only exercised
// indirectly through samples/conformance tests. Focused on outputs()/
// collectLets, the newest and least-covered interaction.

const test = require("node:test");
const assert = require("node:assert");
const {
    num, v, bin, add, mul, sub, div, call, cmp, select, letIn, letChain, outputs, field, collectLets, checkUnboundVars, MACRO_GENSYM_PREFIX,
} = require("../ast.js");

test("outputs() builds a plain {type, fields} node", () => {
    const node = outputs({ a: num(1), b: v("x") });
    assert.strictEqual(node.type, "outputs");
    assert.deepStrictEqual(node.fields, { a: num(1), b: v("x") });
});

test("collectLets recurses into an outputs node's fields", () => {
    const tree = letIn(
        "shared",
        num(10),
        outputs({
            a: add(v("shared"), num(1)),
            b: mul(v("shared"), num(2)),
        }),
    );
    const { bindings, body } = collectLets(tree);
    assert.strictEqual(bindings.length, 1);
    assert.strictEqual(bindings[0].name, "shared");
    assert.strictEqual(body.type, "outputs");
    // Field values pass through walk() same as any other node position --
    // in this case unchanged, since neither field contains its own let.
    assert.deepStrictEqual(body.fields.a, add(v("shared"), num(1)));
    assert.deepStrictEqual(body.fields.b, mul(v("shared"), num(2)));
});

test("collectLets hoists a let nested inside one output field's own value", () => {
    const tree = outputs({
        a: letIn("tmp", num(5), add(v("tmp"), num(1))),
        b: num(0),
    });
    const { bindings, body } = collectLets(tree);
    assert.strictEqual(bindings.length, 1);
    assert.strictEqual(bindings[0].name, "tmp");
    // The field's own let is gone, replaced by a reference to the hoisted name.
    assert.deepStrictEqual(body.fields.a, add(v("tmp"), num(1)));
});

test("collectLets still catches a duplicate let name when it's inside two different output fields", () => {
    const tree = outputs({
        a: letIn("x", num(1), v("x")),
        b: letIn("x", num(2), v("x")),
    });
    assert.throws(() => collectLets(tree), /duplicate let binding name "x"/);
});

// --- duplicate-name collision with a macro's own gensym'd let ----------
//
// macros.js's own gensym'd internal let-names all start with
// MACRO_GENSYM_PREFIX ("efMacro_") -- see substituteAndRename's "let"
// case there. A caller's own let/param colliding with a LIVE gensym'd
// name is astronomically unlikely (it would require literally guessing
// an exact, monotonically-increasing, process-wide counter value), so
// these tests construct the collision directly via collectLets rather
// than relying on the real macro system's own live counter -- the point
// isn't "can you actually trigger this by accident" (you basically
// can't), it's "if it somehow DOES happen, does the error actually
// explain itself instead of just naming the collision."

test("a duplicate name matching the macro gensym prefix gets an explanatory hint, not just the bare collision", () => {
    const tree = letIn(
        `${MACRO_GENSYM_PREFIX}tmp_0`,
        num(1),
        letIn(`${MACRO_GENSYM_PREFIX}tmp_0`, num(2), v(`${MACRO_GENSYM_PREFIX}tmp_0`)),
    );
    assert.throws(
        () => collectLets(tree),
        new RegExp(
            `duplicate let binding name "${MACRO_GENSYM_PREFIX}tmp_0" in one function -- this looks like an ` +
            `internal name macro expansion generates automatically.*rename YOURS to something that doesn't ` +
            `start with "${MACRO_GENSYM_PREFIX}"`,
        ),
    );
});

test("an ORDINARY duplicate name (no gensym-prefix collision) still gets the plain message, no irrelevant hint", () => {
    const tree = letIn("total", num(1), letIn("total", num(2), v("total")));
    assert.throws(
        () => collectLets(tree),
        (err) => err.message === 'collectLets: duplicate let binding name "total" in one function',
    );
});

test("letChain([[a,..],[b,..]], body) builds the same tree as hand-nested letIn", () => {
    const chained = letChain(
        [
            ["a", num(1)],
            ["b", add(v("a"), num(1))],
        ],
        v("b"),
    );
    const handNested = letIn("a", num(1), letIn("b", add(v("a"), num(1)), v("b")));
    assert.deepStrictEqual(chained, handNested);
});

test("letChain: first pair is outermost, last pair is innermost (closest to body)", () => {
    const chained = letChain(
        [
            ["a", num(1)],
            ["b", num(2)],
            ["c", num(3)],
        ],
        v("c"),
    );
    assert.strictEqual(chained.name, "a");
    assert.strictEqual(chained.body.name, "b");
    assert.strictEqual(chained.body.body.name, "c");
    assert.deepStrictEqual(chained.body.body.body, v("c"));
});

test("letChain with an empty bindings array returns body unchanged", () => {
    const body = add(num(1), num(2));
    assert.deepStrictEqual(letChain([], body), body);
});

test("letChain output round-trips through collectLets exactly like hand-nested letIn", () => {
    const chained = letChain(
        [
            ["s", add(v("x"), v("y"))],
            ["d", sub(v("x"), v("y"))],
        ],
        outputs({ sum: v("s"), diff: v("d") }),
    );
    const { bindings, body } = collectLets(chained);
    assert.deepStrictEqual(
        bindings.map((b) => b.name),
        ["s", "d"],
    );
    assert.strictEqual(body.type, "outputs");
});

// --- checkUnboundVars ------------------------------------------------
//
// Nothing previously checked that a v(name) reference in a tree
// actually corresponds to a parameter or a let binding -- confirmed the
// gap first, not assumed: before this existed, emitAll() silently
// succeeded across all 18 targets for a body referencing a completely
// undeclared name, and evaluate() would only ever notice if it happened
// to walk that exact node for the args it was given.

test("a well-formed function (every reference is a param or a let) doesn't throw", () => {
    const fn = { name: "f", params: ["a", "b"], body: letIn("s", add(v("a"), v("b")), mul(v("s"), num(2))) };
    assert.doesNotThrow(() => checkUnboundVars(fn));
});

test("a reference to a name that's neither a param nor a let binding throws", () => {
    const fn = { name: "broken", params: ["a"], body: add(v("a"), v("b")) };
    assert.throws(
        () => checkUnboundVars(fn),
        /"b" is referenced in "broken" but never declared -- not a parameter \(a\) and no "let b = \.\.\." binding exists/,
    );
});

test("an unbound reference inside a let's OWN value throws, not just inside the final body", () => {
    const fn = { name: "f", params: ["a"], body: letIn("s", add(v("a"), v("typo")), v("s")) };
    assert.throws(() => checkUnboundVars(fn), /"typo" is referenced/);
});

test("an unbound reference inside a select()'s branch throws even if that branch is never actually taken at runtime -- this is a STATIC check, not a runtime-reachability one", () => {
    // The whole point: evaluate()'s own runtime "unbound variable" throw
    // only ever fires if execution actually walks that node -- a select()
    // branch some particular call's arguments don't take would never
    // surface that way. checkUnboundVars sees every branch unconditionally.
    const fn = { name: "f", params: ["a"], body: select(cmp(v("a"), ">", num(0)), v("a"), v("neverDeclared")) };
    assert.throws(() => checkUnboundVars(fn), /"neverDeclared" is referenced/);
});

test("an unbound reference inside a call()'s argument throws", () => {
    const fn = { name: "f", params: ["a"], body: call("sqrt", add(v("a"), v("typo"))) };
    assert.throws(() => checkUnboundVars(fn), /"typo" is referenced/);
});

test("an unbound reference inside an outputs() field throws", () => {
    const fn = { name: "f", params: ["a"], body: outputs({ x: v("a"), y: v("typo") }) };
    assert.throws(() => checkUnboundVars(fn), /"typo" is referenced/);
});

test("a later let-binding referencing an earlier one's name is fine -- there's no order-sensitivity to the check", () => {
    const fn = { name: "f", params: [], body: letChain([["a", num(1)], ["b", add(v("a"), num(1))]], v("b")) };
    assert.doesNotThrow(() => checkUnboundVars(fn));
});

test("an EARLIER let-binding referencing a LATER one's name is also fine -- checkUnboundVars is deliberately not order-sensitive (collectLets's own let-binding shape has no real lexical scoping either, see its doc comment)", () => {
    const fn = { name: "f", params: [], body: letChain([["a", add(v("b"), num(1))], ["b", num(1)]], v("a")) };
    assert.doesNotThrow(() => checkUnboundVars(fn));
});

test("div's operands are checked too, same as every other bin op", () => {
    const fn = { name: "f", params: ["a"], body: div(v("a"), v("typo")) };
    assert.throws(() => checkUnboundVars(fn), /"typo" is referenced/);
});

// --- raw builder input validation (identifier/op/number injection) ------
//
// See ast.js's own "SECURITY" comment at the top of the file: these
// builders are the raw-AST layer -- the one place a malicious/malformed
// name, operator, or number could reach emitted output completely
// unchecked, verbatim, in every target at once, since fn`...`/expr`...`'s
// own tokenizer never produces anything but a safe identifier to begin
// with. Confirmed the actual injection first, not just reasoned about:
// v("x); require('child_process').execSync('touch /tmp/pwned'); //")
// used to build a Node whose `.name` landed in generated source
// completely unescaped.

test("v() rejects a name that isn't a safe identifier", () => {
    assert.throws(() => v("x); process.exit(1); //"), /isn't a safe identifier/);
    assert.throws(() => v("2x"), /isn't a safe identifier/); // can't start with a digit
    assert.throws(() => v(""), /isn't a safe identifier/);
    assert.throws(() => v(123), /isn't a safe identifier/); // not even a string
});

test("v() accepts every identifier shape the real tokenizer would produce", () => {
    assert.doesNotThrow(() => v("x"));
    assert.doesNotThrow(() => v("_private"));
    assert.doesNotThrow(() => v("camelCase123"));
});

test("call() rejects an unsafe function name the same way v() does", () => {
    assert.throws(() => call("sqrt(x); alert(1); //", num(1)), /isn't a safe identifier/);
});

test("letIn() rejects an unsafe binding name", () => {
    assert.throws(() => letIn("total = 1; DROP TABLE x; --", num(1), num(2)), /isn't a safe identifier/);
});

test("outputs() rejects an unsafe field name, checked for EVERY key, not just the first", () => {
    assert.throws(() => outputs({ ok: num(1), "bad name": num(2) }), /isn't a safe identifier/);
});

test("field() rejects an unsafe field name", () => {
    assert.throws(() => field(v("b"), "rx; evil()"), /isn't a safe identifier/);
});

test("bin() rejects an operator outside the fixed +/-/*// set", () => {
    assert.throws(() => bin("**", num(1), num(2)), /isn't one of the allowed operators/);
    assert.throws(() => bin("; process.exit(1); //", num(1), num(2)), /isn't one of the allowed operators/);
});

test("bin() accepts every real operator", () => {
    for (const op of ["+", "-", "*", "/"]) {
        assert.doesNotThrow(() => bin(op, num(1), num(2)));
    }
});

test("cmp() rejects an operator outside the fixed comparator set", () => {
    assert.throws(() => cmp(num(1), "===", num(2)), /isn't one of the allowed operators/);
});

test("cmp() accepts every real comparator", () => {
    for (const op of [">", "<", ">=", "<=", "==", "!="]) {
        assert.doesNotThrow(() => cmp(num(1), op, num(2)));
    }
});

test("num() rejects NaN, Infinity, and non-numeric values -- none of those are a valid literal in every target", () => {
    assert.throws(() => num(NaN), /isn't a finite number/);
    assert.throws(() => num(Infinity), /isn't a finite number/);
    assert.throws(() => num(-Infinity), /isn't a finite number/);
    assert.throws(() => num("1"), /isn't a finite number/);
    assert.throws(() => num(undefined), /isn't a finite number/);
});

test("num() accepts ordinary finite numbers, including zero and negatives", () => {
    assert.doesNotThrow(() => num(0));
    assert.doesNotThrow(() => num(-3.5));
    assert.doesNotThrow(() => num(1e-9));
});

test("checkUnboundVars validates fn.name as a safe identifier too, not just var() references", () => {
    const fn = { name: "f(); process.exit(1); //", params: [], body: num(1) };
    assert.throws(() => checkUnboundVars(fn), /isn't a safe identifier/);
});

test("checkUnboundVars validates every fn.params entry as a safe identifier", () => {
    const fn = { name: "f", params: ["a", "b); evil(); //"], body: num(1) };
    assert.throws(() => checkUnboundVars(fn), /isn't a safe identifier/);
});

// --- checkUnboundVars' own shape guard -------------------------------
//
// checkUnboundVars is called BOTH internally (every real consumption
// path runs it right after expandMacros, see macros.js's own comment)
// AND directly by a caller who wants just this one check on its own
// (e.g. the playground's useExprForge.ts) -- unlike the internal
// callers, a direct caller hasn't necessarily gone through expandMacros'
// own equivalent guard first, so this needs its own copy: without it,
// `fn.name` crashes with a raw "Cannot read properties of undefined
// (reading 'name')" for the exact same "looked up a loadExprSource()
// 'macro'-marked name, got undefined back" mistake expandMacros' own
// guard (see test/macros.test.js) exists to catch clearly instead.

test("checkUnboundVars rejects undefined with a clear error, not a raw TypeError", () => {
    assert.throws(
        () => checkUnboundVars(undefined),
        /expected a \{name, params, body\} function definition, got undefined/,
    );
});

test("checkUnboundVars rejects null", () => {
    assert.throws(() => checkUnboundVars(null), /got null/);
});

test("checkUnboundVars rejects a bare Node (has \"type\" but no name/params/body wrapper) -- unlike expandMacros, this entry point only ever accepts a full function definition", () => {
    assert.throws(() => checkUnboundVars(num(5)), /expected a \{name, params, body\} function definition/);
});

test("checkUnboundVars rejects a plain object missing \"params\" or \"body\"", () => {
    assert.throws(() => checkUnboundVars({ name: "f" }), /expected a \{name, params, body\} function definition/);
    assert.throws(() => checkUnboundVars({ name: "f", params: [] }), /expected a \{name, params, body\} function definition/);
});

test("checkUnboundVars' error hints at the loadExprSource \"macro\" vs \"fn\" mistake specifically", () => {
    assert.throws(() => checkUnboundVars(undefined), /marked "fn" \(exported\), not "macro" \(private/);
});
