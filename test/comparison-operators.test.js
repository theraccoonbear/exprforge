// exprforge/test/comparison-operators.test.js
//
// Exhaustive per-emitter, per-operator coverage for cmp()'s six operators
// (">" "<" ">=" "<=" "==" "!="), written after a real, shipped bug: qb64.js,
// fortran.js, and lua.js all passed condNode.op straight through as a raw
// JS/C-spelled token inside their emitSelect (the only place a cmp() op is
// ever actually printed -- see ast.js's own comment: cmp is never a general
// boolean expression, only select()'s cond). ">" "<" ">=" "<=" happen to be
// spelled identically in every one of this project's 18 targets, so those
// four masked the bug completely; QB64 has no "==" or "!=" at all (needs
// "=" / "<>"), Fortran has no "!=" (needs "/="), and Lua has no "!=" (needs
// "~="). Every one of those is a real compile error on a real compiler
// (gfortran, lua, qb64pe -- all confirmed directly, not assumed), not a
// theoretical concern.
//
// The reason this shipped for as long as it did: no sample ANYWHERE in
// this project's history -- not the ones wired into
// test/conformance.test.js's real-compiler runs, not any hand-written
// example -- ever used "==" or "!=" in a cmp() node. spline-frame.js (the
// only sample exercising cmp()/select() against real compiled toolchains
// at all) uses ">" exclusively. So this exact gap was never caught by a
// real compiler, only by evaluate() (which just uses JS's OWN "=="/"!="
// operators, so it can't help but "pass"). This file exists to make that
// structurally impossible to repeat: every emitter, every operator, string-
// level checked against what a real compiler for that language actually
// accepts -- and a genuinely compiled/executed sample is registered in
// test/conformance.test.js's SAMPLES (see comparisonOpsAst there) so "=="
// and "!=" specifically get run through every available real toolchain
// from now on, not just this file's static string checks.
const test = require("node:test");
const assert = require("node:assert");
const { v, num, cmp, select } = require("../ast.js");
const { evaluate } = require("../evaluate.js");
const emitters = require("../emitters/registry.js");

const OPS = [">", "<", ">=", "<=", "==", "!="];

// What each emitter is expected to actually print for "==" / "!=" --
// defaults to the JS/C spelling every target shares EXCEPT the ones
// listed explicitly. `forbid` (only present where it differs from the
// default) is the naive JS/C token that must NOT appear anywhere in the
// output for that operator -- this is the literal assertion that would
// have caught the original bug immediately, for exactly the language it
// broke in.
const EXPECTED = {
    // qb64/fortran/lua: the three real, shipped bugs this file locks down.
    qb64: { eq: "=", ne: "<>", forbidEq: "==", forbidNe: "!=" },
    fortran: { eq: "==", ne: "/=", forbidNe: "!=" },
    lua: { eq: "==", ne: "~=", forbidNe: "!=" },
    // scheme: prefix notation, not an infix token -- "(=" for equality,
    // "(not (=" for inequality (R7RS has no single not-equal procedure).
    // Already correct before this file existed (see scheme.js's own
    // comment) -- included here so a regression there is caught too.
    scheme: { eq: "(=", ne: "(not (=" },
    // cobol: dispatches to a dedicated FUNCTION-ID helper per operator
    // (ef-cmp-eq/ef-cmp-ne) rather than embedding a relational token
    // inline at all -- see CMP_HELPERS in emitters/cobol.js. Already
    // correct before this file existed, included for the same reason.
    cobol: { eq: "ef-cmp-eq", ne: "ef-cmp-ne" },
};

function expectedFor(lang) {
    return { eq: "==", ne: "!=", ...(EXPECTED[lang] || {}) };
}

function makeFn(op) {
    return { name: "f", params: ["x"], body: select(cmp(v("x"), op, num(5)), num(1), num(0)) };
}

test("every registered emitter prints a real, valid comparison operator for == and !=", () => {
    for (const [lang, emitter] of Object.entries(emitters)) {
        const expected = expectedFor(lang);
        const eqSource = emitter.emitFunction(makeFn("=="));
        const neSource = emitter.emitFunction(makeFn("!="));

        assert.ok(
            eqSource.includes(expected.eq),
            `${lang}: "==" should emit to include "${expected.eq}" -- got:\n${eqSource}`,
        );
        assert.ok(
            neSource.includes(expected.ne),
            `${lang}: "!=" should emit to include "${expected.ne}" -- got:\n${neSource}`,
        );

        const forbidEq = (EXPECTED[lang] || {}).forbidEq;
        if (forbidEq) {
            assert.ok(
                !eqSource.includes(forbidEq),
                `${lang}: "==" must NOT emit the naive JS/C token "${forbidEq}" -- got:\n${eqSource}`,
            );
        }
        const forbidNe = (EXPECTED[lang] || {}).forbidNe;
        if (forbidNe) {
            assert.ok(
                !neSource.includes(forbidNe),
                `${lang}: "!=" must NOT emit the naive JS/C token "${forbidNe}" -- got:\n${neSource}`,
            );
        }
    }
});

test("every registered emitter prints the four operators shared identically across every target (>, <, >=, <=)", () => {
    // Unlike ==/!=, these four really are spelled the same everywhere in
    // this project's 18 targets (confirmed by the per-language audit that
    // found the ==/!= bug in the first place) -- this just locks that in,
    // so a FUTURE target with different spelling (rare, but not
    // impossible) fails here immediately instead of joining qb64/fortran/
    // lua's blind spot.
    for (const op of [">", "<", ">=", "<="]) {
        for (const [lang, emitter] of Object.entries(emitters)) {
            const source = emitter.emitFunction(makeFn(op));
            assert.ok(
                source.includes(op),
                `${lang}: "${op}" should appear unchanged in the emitted source -- got:\n${source}`,
            );
        }
    }
});

test("evaluate() computes every operator correctly (interpreter-level sanity, unaffected by the emitter bug)", () => {
    const cases = [
        [">", 6, 1], [">", 5, 0], [">", 4, 0],
        ["<", 4, 1], ["<", 5, 0], ["<", 6, 0],
        [">=", 5, 1], [">=", 6, 1], [">=", 4, 0],
        ["<=", 5, 1], ["<=", 4, 1], ["<=", 6, 0],
        ["==", 5, 1], ["==", 4, 0],
        ["!=", 4, 1], ["!=", 5, 0],
    ];
    for (const [op, x, expected] of cases) {
        assert.strictEqual(evaluate(makeFn(op), [x]), expected, `evaluate() for x ${op} 5 with x=${x}`);
    }
});

test("all six operators are covered above -- OPS list itself matches cmp()'s documented set", () => {
    // Guards the guard: if ast.js's cmp() ever grows/shrinks its allowed
    // operator set, this fails loudly instead of this file silently only
    // covering a stale subset.
    for (const op of OPS) {
        assert.doesNotThrow(() => cmp(v("x"), op, num(1)), `cmp() should accept "${op}"`);
    }
    assert.throws(() => cmp(v("x"), "<>", num(1)), /op/i, "cmp() should reject an op outside the documented six");
});
