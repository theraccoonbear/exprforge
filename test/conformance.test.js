// exprforge/test/conformance.test.js
//
// This is the thing that actually justifies the tool's existence: proving
// the emitted targets agree numerically, not just that they compile. Each
// compiled-language block is skipped (not failed) when its toolchain isn't
// on PATH, so this suite degrades gracefully across machines — see
// .github/workflows/test-*.yml (one file per language) for the CI images
// that have them.
//
// Two independent checks per sample:
//   1. the emitted JS vs. a hand-written reference implementation that
//      shares no code with the AST/emitters — catches a wrong formula.
//   2. every other target vs. that same emitted JS — catches an emitter
//      bug (wrong operator, wrong argument order, etc.) even if the AST
//      itself is correct.
// Comparisons use a relative tolerance, not exact equality: pow/sqrt/etc.
// aren't guaranteed bit-identical across every platform's libm, and a
// bit-exact check would be flaky rather than rigorous.

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const { DOTNET_TFM } = require("./dotnet-tfm.js");
const os = require("node:os");
const path = require("node:path");
const { tmpDir, hasQb64, compileQb64, runQb64, QB64_ERROR_PROLOGUE, QB64_ERROR_HANDLER } = require("./harness-util.js");

const {
    num,
    v,
    call,
    add,
    mul,
    div,
    letIn,
    cmp,
    select,
    collectLets,
    expr,
    catmullRomAst,
    fibonacciAst,
    splineFrameAsts,
    kitchenSinkAst,
    mathDemoAst,
    macroDemoAst,
    comparisonOpsAst,
    nestedSelectAst,
    numberExtremesAst,
    roundTieBoundaryAst,
    domainSafetyAst,
    arraySuiteAst,
    arrayMacroDemoAst,
    mathEdgeCasesAst,
    divisionByZeroAst,
    nonFiniteRoundingAst,
    roundingZeroSignAst,
    differentiateDemoAst,
    zeroParamDemoAst,
    cyclicElemAst,
    clampedElemAst,
    emitters,
} = require("../index.js");
const { evaluate } = require("../evaluate.js");

function catmullRomReference(P0, P1, P2, P3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * P1 + (-P0 + P2) * t + (2 * P0 - 5 * P1 + 4 * P2 - P3) * t2 + (-P0 + 3 * P1 - 3 * P2 + P3) * t3);
}

// Independent of macro-demo.js's own AST entirely -- hand-computed
// straight from the same arithmetic (hypot-squared twice, plus a 90°
// rotation) rather than re-deriving it through any exprforge machinery,
// so this also proves the macro EXPANSION itself is correct, not just
// that every target agrees with whatever expandMacros() produced.
function macroDemoReference(ax, ay, bx, byy) {
    const hSq1 = ax * ax + ay * ay;
    const hSq2 = bx * bx + byy * byy;
    const rx = 0 - ay;
    const ry = ax;
    return hSq1 + hSq2 + rx + ry;
}

function fibonacciReference(n) {
    // Plain iterative integer recurrence -- independent of the closed-form
    // (Binet's formula) the AST uses, so this also checks that the closed
    // form is accurate at these n, not just that every target agrees with
    // whatever it computes.
    let a = 0;
    let b = 1;
    for (let i = 0; i < n; i++) {
        [a, b] = [b, a + b];
    }
    return a;
}

// Exercises let + select + cmp together: length computed once via letIn,
// then select() picks between the normalized value and a safe fallback.
// Covers the near-zero case specifically, since that's the one a naive
// select-as-a-guard implementation gets wrong (see ast.js's select() doc
// comment and samples/spline-frame.js's safeDiv) -- and this AST
// deliberately IS that naive pattern (div(x, mag) directly in the guarded
// branch, not clamped first), specifically to demonstrate the divergence:
// JS/C/Go/Rust/Java/TS all short-circuit their ternary/if, so div-by-zero
// never actually executes there, but QB64's select always evaluates both
// branches -- 0/0 there really does produce NaN, confirmed against a real
// QB64 compiler. That's not a QB64 bug to fix; it's this AST correctly
// being unsafe on the one target that can't short-circuit around it, which
// is exactly why samples/spline-frame.js's safeDiv clamps the denominator
// instead of guarding the division directly. QB64 is excluded from this
// one test's targets below for that reason -- everywhere else, expected
// and required to agree.
const EPS = num(1e-9);
const normalizeXAst = {
    name: "normalizeX",
    params: ["x", "y", "z"],
    // "mag", not "len": LEN is a reserved QB64 builtin (string/array
    // length) -- Dim'ing a local named "len" fails to compile there. See
    // the QB64 gotchas this project's memory records from a sibling
    // project's experience.
    body: letIn(
        "mag",
        call("sqrt", add(mul(v("x"), v("x")), mul(v("y"), v("y")), mul(v("z"), v("z")))),
        select(cmp(v("mag"), ">", EPS), div(v("x"), v("mag")), num(0)),
    ),
};

function normalizeXReference(x, y, z) {
    const len = Math.sqrt(x * x + y * y + z * z);
    return len > 1e-9 ? x / len : 0;
}

// Built via expr() (see expr.js) instead of hand-nested calls -- proves
// the infix syntax sugar produces trees that are fully emitter-compatible
// across every target, not just structurally plausible locally (that
// weaker guarantee is what test/expr.test.js already checks). Exercises
// "^" (lowers to pow), a function call, and the ternary/select() lowering
// together in one compact expression -- exactly the "readable at a
// glance" case that motivated expr() over add(mul(...)) nesting in the
// first place.
//
// "c", not "fallback" -- deliberately reverted back to the real,
// motivating identifier once the actual underlying bug was fixed for
// real, same discipline this file already applies to spillPow's "**"
// fix below: a bare "c" param used to break GnuCOBOL's CALL ... USING
// clause specifically, and this fixture used to work around it by using
// "fallback" instead. Now that emitters/cobol.js renames a colliding
// PARAMETER internally (EFLF_c) rather than throwing -- see
// renameConflictingParams there, and
// https://github.com/theraccoonbear/exprforge/issues/18 for the design
// rationale -- "c" is proven to actually work here, in the real
// conformance suite, across every executable target, not just in an isolated
// throwaway script.
//
// sqrt(a^2 + b^2) here specifically -- not simplified to avoid it -- is
// deliberate: a "**" expression nested inside another function call's
// argument once broke some GnuCOBOL 4.x builds (confirmed against real
// CI; see spillPow's comment in emitters/cobol.js for the actual fix),
// and this is exactly that shape. Left as the real thing being tested,
// not routed around it.
const exprSyntaxDemoAst = {
    name: "exprSyntaxDemo",
    params: ["a", "b", "c"],
    body: expr`a > 0 ? sqrt(a^2 + b^2) : c`,
};

function exprSyntaxDemoReference(a, b, c) {
    return a > 0 ? Math.sqrt(a * a + b * b) : c;
}

const SAMPLES = {
    catmullRom: {
        ast: catmullRomAst,
        reference: catmullRomReference,
        inputs: [
            [0.0, 1.0, 2.0, 3.0, 0.0],
            [0.0, 1.0, 2.0, 3.0, 0.5],
            [0.0, 1.0, 2.0, 3.0, 1.0],
            [-4.2, 7.1, 0.0, 12.75, 0.33],
        ],
    },
    fibonacci: {
        ast: fibonacciAst,
        reference: fibonacciReference,
        inputs: [[0], [1], [2], [10], [20], [30]],
    },
    normalizeX: {
        ast: normalizeXAst,
        reference: normalizeXReference,
        inputs: [
            [1, 0, 0],
            [3, 4, 0],
            [1, 1, 1],
            [0, 0, 0], // degenerate: len=0, must fall back to 0, not divide
        ],
        // Deliberately excludes QB64 -- see the comment on normalizeXAst
        // above for why it's expected (not a bug) to diverge there.
        skipTargets: ["QB64"],
    },
    exprSyntaxDemo: {
        ast: exprSyntaxDemoAst,
        reference: exprSyntaxDemoReference,
        inputs: [
            [3, 4, -1], // a>0 branch: sqrt(9 + 16) = 5
            [-1, 4, 7], // a<=0 branch: falls back to fallback
            [0, 5, 2], // a==0 -- also falls back (a>0 is strictly false)
            [0.5, 0.5, 0.5],
        ],
    },
    // Calls all 22 supported Math functions in one expression -- coverage,
    // not a formula with real meaning, so no independent reference (there
    // isn't a second sensible way to compute "call everything and sum").
    // x stays in (0, 1) so sqrt/log*/asin/acos are all simultaneously in
    // domain; d = x - y varies sign (and hits exactly 0 once) for
    // floor/ceil/round/trunc/sign, while deliberately avoiding exact .5
    // boundaries -- see samples/kitchen-sink.js for why.
    kitchenSink: {
        ast: kitchenSinkAst,
        inputs: [
            [0.5, 0.2],
            [0.3, 0.7],
            [0.9, 0.9], // d = 0 exactly
            [0.1, 2.5],
        ],
    },
    // Coverage fixture for macros.js's AST-fn-def macro tier specifically
    // (loadMacro(name, fn`...`), not the plain-JS-function tier mathDemo
    // already covers) -- see samples/macro-demo.js's own header comment
    // for exactly what risk this proves out on every real target, not
    // just evaluate() (which can't see codegen at all): a macro's own
    // internal "let" gets alpha-renamed to a gensym'd name on every call
    // (hypotSq is called TWICE here, proving two calls' names don't
    // collide with each other either), and a multi-output macro whose
    // outputs() is wrapped in its own let-chain (rotate90) is spliced in
    // and field-accessed correctly.
    macroDemo: {
        ast: macroDemoAst,
        reference: macroDemoReference,
        inputs: [
            [3, 4, 5, 12],
            [0, 0, 0, 0], // every gensym'd let evaluates to exactly 0
            [-2, 7, 1.5, -3.25],
            [10, -10, -10, 10],
        ],
    },
    // Chained/nested select() (a ternary-of-ternary) against every real
    // target -- see samples/nested-select-demo.js's own header comment
    // for why this specifically, not previously exercised by any other
    // real-compiled sample.
    nestedSelect: {
        ast: nestedSelectAst,
        reference: (a, b) => (a > 0 ? 1 : b > 0 ? 2 : b < 0 ? 3 : 4),
        inputs: [
            [1, 0], // outer true branch -- inner never evaluated logically,
            // but select() always evaluates both sides regardless (see
            // ast.js), so this still exercises every emitter's own
            // recursive-select emission, just not its RUNTIME result.
            [-1, 5], // outer false, first inner branch true
            [-1, -5], // outer false, second inner branch true
            [-1, 0], // outer false, innermost fallback (b == 0)
        ],
        // Genuine GnuCOBOL codegen limitation, not an ExprForge bug --
        // confirmed via 4 real CI runs on this repo, not local guessing
        // (a local reproduction attempt turned out to be unreliable --
        // see this repo's PR history for the full trail, including a
        // gnucobol3-vs-gnucobol4 dead end). The real, CI-confirmed
        // pattern: normalizeX/exprSyntaxDemo (each use exactly ONE
        // distinct comparison operator, ">") pass; this sample (uses TWO,
        // ">" and "<", each its own emitters/cobol.js FUNCTION-ID helper
        // -- ef-cmp-gt/ef-cmp-lt) fails with "unknown type name
        // 'cob_decimal'", a fatal error in cobc's OWN generated C, on
        // BOTH gnucobol3 (a real stable release) and gnucobol4 (an
        // early-dev snapshot) identically. Calling more than one
        // DISTINCT ef-cmp-* helper in one PROCEDURE DIVISION is the best
        // current explanation, not yet proven by a full bisection -- see
        // comparisonOps' own skipTargets below for the same pattern at
        // its most extreme (all 6 operators). Fixing this for real would
        // mean reworking cobol.js's one-FUNCTION-ID-per-operator
        // architecture -- real, separate, riskier follow-up work on a
        // carefully-tuned emitter, not attempted here. Same reasoning as
        // normalizeX's own QB64 skip: a real, external, confirmed
        // limitation, not silently ignored.
        skipTargets: ["COBOL"],
    },
    // Extreme-magnitude numeric literals against every real target -- see
    // samples/number-extremes-demo.js's own header comment for two real
    // things this found (a genuine c/rust/go/java formatNumber bug, now
    // fixed, plus a confirmed QB64 upstream limitation at magnitudes far
    // beyond this) and why 1e25, not the original 1e250, is what's
    // actually locked in as a permanent regression test here.
    numberExtremes: {
        ast: numberExtremesAst,
        reference: (x) => x + 1e25 + 1e-25,
        inputs: [[3], [-7.5], [0]],
    },
    // A real, PERMANENT divergence, not a bug -- see
    // samples/round-tie-demo.js's own header comment for the full,
    // directly-verified breakdown (three distinct tie-breaking
    // conventions across this project's targets) and the root
    // README's "round() at exact .5 boundaries" section for why this is
    // documented and demonstrated rather than unified. Reference is
    // JS's own Math.round (half-up, ties toward +Infinity) -- the same
    // "JS is the baseline every compiled target is compared against"
    // role it already plays everywhere else in this file (see
    // loadJsFn). skipTargets lists every target confirmed (or, for
    // PHP/C#, documented) to use a DIFFERENT convention -- that's most
    // of them, and that's the actual point being proven here, not a
    // sign of something broken.
    // Proves round() ties AWAY FROM ZERO identically on every target, no
    // exceptions -- see samples/round-tie-demo.js's own header comment
    // for the real, three-way divergence this fixes (this file used to
    // need a long skipTargets list here; it doesn't anymore, and that's
    // the actual point being proven now, not a loosened check). Reference
    // is a hand-written away-from-zero implementation, deliberately NOT
    // Math.round (which ties the other way, toward +Infinity, and would
    // silently validate the WRONG convention here of all places).
    roundTieBoundary: {
        ast: roundTieBoundaryAst,
        reference: (which) => {
            const x = [-0.5, -1.5, 0.5, 1.5][which];
            return Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
        },
        inputs: [[0], [1], [2], [3]],
    },
    // Array-typed parameters (arr[i], see docs/array-index-primitives.md)
    // compiled and executed against every real toolchain -- closes #36:
    // this feature was previously verified by hand once during
    // development, never wired into permanent, automatic conformance
    // coverage. COBOL is excluded because it doesn't support array
    // parameters at all (a structural OCCURS-table-size limitation, not
    // a gap -- see docs/array-index-primitives.md); every runX/runSuiteX
    // harness here now has real, per-language array-argument parsing
    // (comma-joined CLI string -> a native array/vector/slice), each
    // confirmed against a real compiler/interpreter during development,
    // not assumed from the scalar-only pattern they used to share.
    cyclicElem: {
        ast: cyclicElemAst,
        reference: (arr, m, i) => arr[((i % m) + m) % m],
        inputs: [
            [[10, 20, 30, 40], 4, 5], // wraps past the end
            [[10, 20, 30, 40], 4, -1], // wraps past the start (negative)
            [[10, 20, 30, 40], 4, 2], // no wrap needed
            [[5], 1, 3], // single-element array
            // Exact-boundary and multi-wrap cases -- previously untested
            // (every case above wraps by exactly one step past an end,
            // never lands exactly ON the boundary or wraps more than
            // once): i == m exactly (not m+1) must wrap all the way
            // around to index 0, and i == -m exactly likewise.
            [[10, 20, 30, 40], 4, 4], // i == m exactly -> index 0
            [[10, 20, 30, 40], 4, -4], // i == -m exactly -> index 0
            [[10, 20, 30, 40], 4, 11], // multi-wrap forward (wraps twice + 3)
            [[10, 20, 30, 40], 4, -9], // multi-wrap backward
        ],
        skipTargets: ["COBOL"],
    },
    clampedElem: {
        ast: clampedElemAst,
        reference: (arr, n, i) => arr[Math.max(0, Math.min(n - 1, i))],
        inputs: [
            [[10, 20, 30, 40], 4, 5], // clamps past the end
            [[10, 20, 30, 40], 4, -1], // clamps past the start
            [[10, 20, 30, 40], 4, 2], // no clamp needed
            // Exact-boundary cases -- previously untested (every case
            // above is either strictly outside or strictly inside the
            // range, never landing exactly ON a boundary, where a
            // fencepost/off-by-one in the clamp itself would show up as
            // a no-op that should have been one, or vice versa).
            [[10, 20, 30, 40], 4, 0], // i == lo exactly -> no-op, index 0
            [[10, 20, 30, 40], 4, 3], // i == hi exactly (n-1) -> no-op, index 3
        ],
        skipTargets: ["COBOL"],
    },
    // Array param threaded through a macro call (see
    // samples/array-macro-demo.js's own header comment) -- proves this
    // compiles/runs correctly on every real target, not just
    // evaluate()/expandMacros() in-process.
    arrayMacroDemo: {
        ast: arrayMacroDemoAst,
        reference: (arr, m, i) => arr[((i % m) + m) % m] + 1,
        inputs: [
            [[10, 20, 30, 40], 4, 5], // wraps past the end
            [[10, 20, 30, 40], 4, -1], // wraps past the start
        ],
        skipTargets: ["COBOL"],
    },
    // Proves differentiate()'s OUTPUT compiles and runs correctly on
    // every real target -- see samples/differentiate-demo.js's own
    // header comment for the gap this closes (previously verified only
    // via numericalDerivative()'s central-difference check against
    // evaluate()/JS, never through a real compiler). The reference here
    // is the hand-derived closed-form d/dx(x^2 * sin(x)), independent of
    // differentiate.js's own rule implementations -- same "two
    // independent checks" shape as every other sample in this file.
    differentiateDemo: {
        ast: differentiateDemoAst,
        reference: (x) => 2 * x * Math.sin(x) + x * x * Math.cos(x),
        inputs: [[0.5], [1.0], [2.0], [-1.5], [3.14159]],
    },
    // Proves a zero-parameter function compiles and runs correctly on
    // every real target -- see samples/zero-param-demo.js's own header
    // comment for exactly what this boundary value could plausibly
    // break that every other sample here, with >=1 parameter, never
    // exercised. Single input row: an empty argument tuple -- there's
    // nothing else to vary.
    zeroParamDemo: {
        ast: zeroParamDemoAst,
        reference: () => Math.sqrt(16) + Math.sign(-3),
        inputs: [[]],
    },
};

// Real, previously-open gap: `Math.abs(NaN - NaN)` is `NaN`, and
// `NaN <= tol` is `false` -- so two genuinely-matching NaN results (or
// two matching same-signed Infinity results, where subtracting them
// also gives NaN) used to FAIL this assertion even when both sides were
// actually correct. That's why no sample here has ever deliberately
// produced NaN/Infinity as an expected reference value: this couldn't
// have proven it correct even when it was. Special-cased below instead
// of just hoped never to matter.
function ulpDistance(a, b) {
    if (a === b) return 0;
    const view = new DataView(new ArrayBuffer(16));
    view.setFloat64(0, a);
    view.setFloat64(8, b);
    const ordered = (off) => {
        const bits = view.getBigInt64(off);
        return bits < 0n ? -(bits & 0x7fffffffffffffffn) : bits;
    };
    const d = ordered(0) - ordered(8);
    return Number(d < 0n ? -d : d);
}

const DEFAULT_MAX_ULPS = 64;

function showNum(x) {
    if (Object.is(x, -0)) return "-0";
    return String(x);
}

// Comparison policy (see README "Numeric guarantees"): NaN only matches
// NaN, each infinity only matches itself, and finite values must agree
// within `maxUlps` units in the last place -- a purely relative bound,
// so a result near 1e-12 is held to the same precision as one near 1.
// There is deliberately no absolute floor: an expected value of exactly
// 0 requires exactly 0 (either sign) unless the call site opts into an
// explicit `absTol` for a known cancellation-to-zero case.
// Options:
//   exact       Object.is on every value (also distinguishes +0 / -0)
//   signedZero  tolerant comparison, but a zero must match the zero's sign
//   maxUlps     override the default ULP budget
//   absTol      explicit absolute tolerance for cancellation-to-zero cases
function assertClose(actual, expected, msg, opts = {}) {
    if (opts.exact) {
        assert.ok(Object.is(actual, expected), `${msg}: got ${showNum(actual)}, expected ${showNum(expected)} (exact, Object.is)`);
        return;
    }
    if (Number.isNaN(expected) || Number.isNaN(actual)) {
        assert.ok(
            Number.isNaN(expected) && Number.isNaN(actual),
            `${msg}: got ${actual}, expected ${expected} -- NaN only matches NaN, not a near-miss`,
        );
        return;
    }
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
        assert.strictEqual(actual, expected, `${msg}: got ${actual}, expected ${expected}`);
        return;
    }
    if (opts.signedZero && actual === 0 && expected === 0) {
        assert.ok(Object.is(actual, expected), `${msg}: got ${showNum(actual)}, expected ${showNum(expected)} (signed zero)`);
        return;
    }
    if (opts.absTol !== undefined && Math.abs(actual - expected) <= opts.absTol) return;
    const maxUlps = opts.maxUlps ?? DEFAULT_MAX_ULPS;
    const ulps = ulpDistance(actual, expected);
    assert.ok(
        ulps <= maxUlps,
        `${msg}: got ${actual}, expected ${expected} (${ulps} ulps apart, budget ${maxUlps}, diff ${Math.abs(actual - expected)})`,
    );
}

// Toolchain probes are declared per emitter (meta.toolchain.probes in
// emitters/<lang>.js) and resolved once in test/toolchains.js. TOOLS is
// keyed by registry language; bin() returns the resolved command name,
// which is not consistent across distros (Guile ships as guile3.0 on
// Fedora and guile-3.0 on Ubuntu).
const { TOOLS, bin } = require("./toolchains.js");
const { targets: registryTargets } = require("../emitters/meta.js");

// Each language's run/runSuite harness is registered next to its own
// implementation below with registerRunner(). The sample-by-target matrix
// is then built from the registry's metadata, so adding a language needs
// no central list here.
const RUNNERS = {};
function registerRunner(lang, run, runSuite) {
    RUNNERS[lang] = { run, runSuite };
}

// Number -> CLI argument text. String() renders -0 as "0", which would
// silently turn a signed-zero probe into a +0 probe on every target.
function argText(x) {
    if (Object.is(x, -0)) return "-0";
    if (Number.isFinite(x) && Math.abs(x) >= 1e15) return x.toExponential();
    return String(x);
}

function runnerTargets(kind) {
    return registryTargets()
        .filter(({ meta }) => meta.kind === "executable" && meta.testTarget)
        .map(({ lang, meta }) => [meta.testTarget, TOOLS[lang], RUNNERS[lang] && RUNNERS[lang][kind]]);
}

// Optional CI-only filter: EXPRFORGE_TEST_TARGETS="Go" npm test runs only
// the Go-labeled checks (plus the toolchain-independent JS/reference ones,
// which aren't gated by this at all). Unset locally, so `npm test` on a
// dev machine still runs everything its installed toolchains allow --
// this exists so CI can run each language's checks in its own workflow
// (installing just that one toolchain) instead of one job serially
// installing all of them, most of which have nothing to do with each
// other -- also what gets each language its own status badge. See
// .github/workflows/test-*.yml.
const TARGET_FILTER = process.env.EXPRFORGE_TEST_TARGETS
    ? new Set(process.env.EXPRFORGE_TEST_TARGETS.split(",").map((s) => s.trim()))
    : null;

function targetAllowed(label) {
    return !TARGET_FILTER || TARGET_FILTER.has(label);
}

// The emitted JS implementation, loaded in-process, is the baseline every
// compiled target gets compared against.
function loadJsFn(ast) {
    const source = emitters.js.emitFunction(ast);
    const file = path.join(
        os.tmpdir(),
        `${ast.name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.js`,
    );
    fs.writeFileSync(file, source);
    const mod = require(file);
    fs.unlinkSync(file);
    return mod[ast.name];
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- Interpreter (evaluate.js) --------------------------------------------
//
// evaluate.js's native tree-walking interpreter, run directly in-process
// -- no emit/compile/subprocess step, unlike every other target below.
// Wired in as one more conformance target (not a replacement for
// loadJsFn's hand-written reference implementations above) so a bug in
// the interpreter itself can't slip through unnoticed, the same
// guarantee every compiled target already gets. One function covers
// both the scalar and suite shapes -- evaluate() already returns a bare
// number or a {name: value} object on its own, matching whichever this
// sample needs, so there's no output-parsing step to write here at all;
// registerSuiteConformance calls run(ast, inputs, outputNames) with a
// 3rd argument this doesn't need, same as runTS's unused outputNames
// parameter above.
function runEval(ast, inputs) {
    return inputs.map((args) => evaluate(ast, args));
}

// --- C -----------------------------------------------------------------
//
// Array-typed params (see ast.js's paramTypes): the CLI-arg side needs no
// change at all -- String([10, 20, 30]) is already "10,20,30" for free
// (see args.map(argText) below, unchanged from the scalar-only original).
// Only the per-language HARNESS text generated here needs a real parsing
// snippet for that one param instead of a bare atof() -- fixed-size
// buffer (256 elements), strtok() splits on "," in place. c.js's own
// array-param signature is a bare `double arr[]` (see its formatFunction),
// so the call site just passes the array name unchanged, same as a
// scalar -- no address-of/cast needed.
function cParamDecls(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `double ${p}[256]; int ${p}_n = 0; { char *ef_tok = strtok(argv[${i + 1}], ","); ` +
                    `while (ef_tok) { ${p}[${p}_n++] = atof(ef_tok); ef_tok = strtok(NULL, ","); } }`;
            }
            return `double ${p} = atof(argv[${i + 1}]);`;
        })
        .join(" ");
}

function runC(ast, inputs) {
    const source = emitters.c.emitFunction(ast);
    const dir = tmpDir("ef-c-");
    fs.writeFileSync(path.join(dir, "fn.c"), source);
    const decls = cParamDecls(ast);
    const callArgs = ast.params.join(", ");
    const harness =
        `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include "fn.c"\n` +
        `int main(int argc, char **argv) {\n    ${decls}\n    printf("%.17g", ${ast.name}(${callArgs}));\n    return 0;\n}\n`;
    fs.writeFileSync(path.join(dir, "main.c"), harness);
    const bin = path.join(dir, "bin");
    execFileSync("gcc", [path.join(dir, "main.c"), "-o", bin, "-lm"]);
    const results = inputs.map((args) => parseNumericOutput(execFileSync(bin, args.map(argText)).toString()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- Go ------------------------------------------------------------------

// Array-typed params: comma-joined CLI string -> []float64 via
// strings.Split + strconv.ParseFloat. go.js's own array-param signature
// is `[]float64` (see its formatFunction), matching what this builds
// exactly -- the call site passes the slice unchanged, same as a scalar.
function goParamParses(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `\t${p}_parts := strings.Split(os.Args[${i + 1}], ",")\n` +
                    `\t${p} := make([]float64, len(${p}_parts))\n` +
                    `\tfor _i, _s := range ${p}_parts {\n\t\t${p}[_i], _ = strconv.ParseFloat(_s, 64)\n\t}`;
            }
            return `\t${p}, _ := strconv.ParseFloat(os.Args[${i + 1}], 64)`;
        })
        .join("\n");
}

function goUsesArray(ast) {
    return ast.params.some((p) => ast.paramTypes?.[p] === "number[]");
}

function runGo(ast, inputs) {
    const source = emitters.go.emitFunction(ast);
    const funcDecl = source.slice(source.indexOf("func "));
    const usesMath = funcDecl.includes("math.");
    const dir = tmpDir("ef-go-");
    execFileSync("go", ["mod", "init", "ef"], { cwd: dir });
    const parses = goParamParses(ast);
    const callArgs = ast.params.join(", ");
    // "os" and "strconv" are only ever referenced inside goParamParses'
    // own output -- both become "imported and not used" (a real Go
    // compile error, confirmed directly, not a warning) for a
    // zero-parameter function, where `parses` is empty. Every sample
    // before zeroParamDemo had >=1 parameter, so this import list never
    // hit the empty case before.
    const hasParams = ast.params.length > 0;
    const mainSrc =
        `package main\n\n` +
        `import (\n\t"fmt"\n${usesMath ? `\t"math"\n` : ""}${hasParams ? `\t"os"\n` : ""}${goUsesArray(ast) ? `\t"strings"\n` : ""}${hasParams ? `\t"strconv"\n` : ""})\n\n` +
        `${funcDecl}\n` +
        `func main() {\n${parses}\n\tfmt.Printf("%.17g", ${capitalize(ast.name)}(${callArgs}))\n}\n`;
    fs.writeFileSync(path.join(dir, "main.go"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("go", ["build", "-o", bin, "."], { cwd: dir });
    const results = inputs.map((args) => parseNumericOutput(execFileSync(bin, args.map(argText)).toString()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- Rust ------------------------------------------------------------------

// Array-typed params: comma-joined CLI string -> Vec<f64>. rust.js's own
// array-param signature is `&[f64]` (a slice reference, see its
// formatFunction) -- Vec<f64> does NOT implicitly coerce to that at a
// call site (needs an explicit `&`), so rustCallArgs (unlike every other
// language's callArgs, which is just ast.params.join(", ")) prefixes
// exactly the array-typed params with "&".
function rustParamParses(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `    let ${p}: Vec<f64> = args[${i + 1}].split(',').map(|s| s.parse().unwrap()).collect();`;
            }
            return `    let ${p}: f64 = args[${i + 1}].parse().unwrap();`;
        })
        .join("\n");
}

function rustCallArgs(ast) {
    return ast.params.map((p) => (ast.paramTypes?.[p] === "number[]" ? `&${p}` : p)).join(", ");
}

function runRust(ast, inputs) {
    const source = emitters.rust.emitFunction(ast);
    const dir = tmpDir("ef-rs-");
    const parses = rustParamParses(ast);
    const callArgs = rustCallArgs(ast);
    const mainSrc =
        `${source}\n` +
        `fn main() {\n` +
        `    let args: Vec<String> = std::env::args().collect();\n` +
        `${parses}\n` +
        `    print!("{:e}", ${ast.name}(${callArgs}));\n` +
        `}\n`;
    const srcPath = path.join(dir, "main.rs");
    fs.writeFileSync(srcPath, mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("rustc", ["-O", srcPath, "-o", bin]);
    const results = inputs.map((args) => parseNumericOutput(execFileSync(bin, args.map(argText)).toString()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- Java --------------------------------------------------------------

// Array-typed params: comma-joined CLI string -> double[] via String.split
// + Double.parseDouble. java.js's own array-param signature is `double[]`
// (see its formatFunction), matching this exactly.
function javaParamParses(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `        String[] ${p}Parts = args[${i}].split(",");\n` +
                    `        double[] ${p} = new double[${p}Parts.length];\n` +
                    `        for (int _i = 0; _i < ${p}Parts.length; _i++) ${p}[_i] = Double.parseDouble(${p}Parts[_i]);`;
            }
            return `        double ${p} = Double.parseDouble(args[${i}]);`;
        })
        .join("\n");
}

function runJava(ast, inputs) {
    const source = emitters.java.emitFunction(ast);
    const className = capitalize(ast.name);
    const dir = tmpDir("ef-java-");
    fs.writeFileSync(path.join(dir, `${className}.java`), source);
    const parses = javaParamParses(ast);
    const callArgs = ast.params.join(", ");
    const mainSrc =
        `public class Main {\n` +
        `    public static void main(String[] args) {\n` +
        `${parses}\n` +
        `        System.out.println(${className}.${ast.name}(${callArgs}));\n` +
        `    }\n` +
        `}\n`;
    fs.writeFileSync(path.join(dir, "Main.java"), mainSrc);
    execFileSync("javac", ["-d", dir, path.join(dir, `${className}.java`), path.join(dir, "Main.java")]);
    const results = inputs.map((args) =>
        parseNumericOutput(execFileSync("java", ["-cp", dir, "Main", ...args.map(argText)]).toString()),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- TypeScript ------------------------------------------------------------
//
// Unlike C/Go/Rust/Java, this doesn't need an argv-parsing harness or a
// printf/parse round trip: tsc both type-checks AND compiles to plain JS
// (catching a type error the same way C/Go/Rust catch build errors), and
// the result can just be require()'d and called in-process. That also
// means one function handles both scalar and suite results unchanged --
// tsc's output returns a number or an object either way, matching
// whatever registerConformance/registerSuiteConformance expects; the
// (unused, for suites) outputNames parameter is only there so this fits
// the same run(ast, inputs, outputNames) shape as the suite runners below.
function runTS(ast, inputs) {
    const source = emitters.ts.emitFunction(ast);
    const dir = tmpDir("ef-ts-");
    const srcPath = path.join(dir, "fn.ts");
    fs.writeFileSync(srcPath, source);
    execFileSync("tsc", ["--strict", "--target", "es2020", "--module", "commonjs", "--outDir", dir, srcPath]);
    const mod = require(path.join(dir, "fn.js"));
    const results = inputs.map((args) => mod[ast.name](...args));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("ts", runTS, runTS);

// --- QB64 --------------------------------------------------------------
//
// Headless via `$CONSOLE:ONLY`: makes the compiled binary a pure text-
// console program with no SDL/graphics window, so no display (real or
// virtual) is needed, unlike a typical QB64 build. Args come in via
// COMMAND$(n); a suite's output params are just plain local variables
// passed to the SUB and read back after the CALL, since QB64 SUB params
// are by reference by default.

// QB64's PRINT, like its own literal syntax, uses D (not E) as the
// exponent marker for a double in scientific notation ("...D-17") --
// confirmed against a real compiler. Plain Number() doesn't understand
// that and silently gives NaN, so this is needed on every value QB64
// prints, not just ones near the E/D-notation-vs-fixed threshold.
// Harness-side helpers (not part of the emitted code under test). VAL()
// cannot read NaN/Infinity/-0, and PRINT drops the sign of zero and shows
// only ~15 digits, so non-finite and signed-zero values are synthesized
// at runtime from a variable zero (a literal would be constant-folded)
// and printed through ef_show$ instead.
const QB64_HARNESS_HELPERS =
    `FUNCTION ef_arg# (s AS STRING)\n` +
    `    DIM z AS DOUBLE\n` +
    `    z = 0#\n` +
    `    IF s = "NaN" THEN\n        ef_arg# = z / z\n` +
    `    ELSEIF s = "Infinity" THEN\n        ef_arg# = 1# / z\n` +
    `    ELSEIF s = "-Infinity" THEN\n        ef_arg# = -1# / z\n` +
    `    ELSEIF s = "-0" THEN\n        ef_arg# = z * -1#\n` +
    `    ELSE\n        ef_arg# = VAL(s + "#")\n    END IF\n` +
    `END FUNCTION\n\n` +
    `FUNCTION ef_show$ (x AS DOUBLE)\n` +
    `    IF x <> x THEN\n        ef_show$ = "NaN"\n` +
    `    ELSEIF x = 0# THEN\n        IF 1# / x < 0# THEN ef_show$ = "-0" ELSE ef_show$ = "0"\n` +
    `    ELSEIF x > 1.7976931348623157D308 THEN\n        ef_show$ = "inf"\n` +
    `    ELSEIF x < -1.7976931348623157D308 THEN\n        ef_show$ = "-inf"\n` +
    `    ELSE\n        ef_show$ = _TRIM$(STR$(x))\n    END IF\n` +
    `END FUNCTION\n\n`;

function qb64ToNumber(str) {
    if (str.includes("QB64-RUNTIME-ERROR")) throw new Error(`QB64 runtime error: ${str}`);
    // QB64 prints "-NAN"/"NAN" for NaN and "inf"/"-inf" for Infinity
    // (confirmed against a real compile) -- parseNumericOutput handles
    // both, same as every other target's own spelling; only a genuine
    // finite value ever needs the D-exponent rewrite below at all.
    // QB64-PE 4.7.0 pads a non-finite PRINT with NUL bytes and a stray
    // "D" (e.g. "INF\0\0...D\0\0"); only the leading token is the value.
    const nonFinite = /^\s*([+-]?(?:inf|nan))/i.exec(str);
    if (nonFinite) return parseNumericOutput(nonFinite[1]);
    return parseNumericOutput(str.replace(/D([+-]?\d+)/i, "E$1"));
}

// Array-typed params: DIM'd with EXPLICIT fixed bounds (0 TO 255), not a
// dynamic `DIM arr() AS DOUBLE` + REDIM -- confirmed against a real
// compile that a dynamic array here fails with "Incorrect array type
// passed to function" (QB64 wants the specific array-declaration shape
// the docs already specify as the caller contract -- see
// docs/array-index-primitives.md's "Index origin is a real, unresolved
// risk" section: an explicitly 0-based array is required regardless of
// OPTION BASE). No built-in split, so a manual INSTR/MID$/VAL loop parses
// the comma-joined CLI string one element at a time. At the CALL site
// (not the DIM), an array-typed argument needs bare parens -- "arr()",
// not "arr" -- matching qb64.js's own arr() parameter declaration
// convention; qb64CallArgs exists for exactly this (unlike every other
// language here, whose call args are always just ast.params.join(", ")).
function qb64ArgReads(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `DIM ${p}(0 TO 255) AS DOUBLE\n` +
                    `DIM ${p}_raw AS STRING : ${p}_raw = COMMAND$(${i + 1})\n` +
                    `DIM ${p}_pos AS INTEGER : ${p}_pos = 1\n` +
                    `DIM ${p}_comma AS INTEGER\n` +
                    `DIM ${p}_n AS INTEGER : ${p}_n = 0\n` +
                    `DO WHILE ${p}_pos <= LEN(${p}_raw)\n` +
                    `    ${p}_comma = INSTR(${p}_pos, ${p}_raw, ",")\n` +
                    `    IF ${p}_comma = 0 THEN\n` +
                    `        ${p}(${p}_n) = VAL(MID$(${p}_raw, ${p}_pos))\n` +
                    `        ${p}_pos = LEN(${p}_raw) + 1\n` +
                    `    ELSE\n` +
                    `        ${p}(${p}_n) = VAL(MID$(${p}_raw, ${p}_pos, ${p}_comma - ${p}_pos))\n` +
                    `        ${p}_pos = ${p}_comma + 1\n` +
                    `    END IF\n` +
                    `    ${p}_n = ${p}_n + 1\n` +
                    `LOOP`;
            }
            return `DIM ${p} AS DOUBLE : ${p} = ef_arg#(COMMAND$(${i + 1}))`;
        })
        .join("\n");
}

function qb64CallArgs(ast) {
    return ast.params.map((p) => (ast.paramTypes?.[p] === "number[]" ? `${p}()` : p)).join(", ");
}

function runQB64(ast, inputs) {
    const source = emitters.qb64.emitFunction(ast);
    const dir = tmpDir("ef-qb64-");
    const argReads = qb64ArgReads(ast);
    const callArgs = qb64CallArgs(ast);
    // NOT unconditionally `name#(${callArgs})`: confirmed directly
    // against a real compile that QB64 rejects a zero-argument call
    // written with empty parens ("name#()", "Expected (...)") -- a
    // zero-param FUNCTION must be called bare ("name#", no parens at
    // all). Every sample before zeroParamDemo had >=1 parameter, so
    // this call site never hit the empty case before.
    const callExpr = callArgs ? `${ast.name}#(${callArgs})` : `${ast.name}#`;
    const harness =
        `$CONSOLE:ONLY\n${source}\n${QB64_HARNESS_HELPERS}${QB64_ERROR_PROLOGUE}${argReads}\nPRINT ef_show$(${callExpr})\nSYSTEM\n${QB64_ERROR_HANDLER}`;
    const srcPath = path.join(dir, "main.bas");
    fs.writeFileSync(srcPath, harness);
    const bin = path.join(dir, "bin");
    compileQb64(srcPath, bin);
    const results = inputs.map((args) => qb64ToNumber(runQb64(bin, args.map(argText)).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteQB64(ast, inputs, outputNames) {
    const source = emitters.qb64.emitFunction(ast);
    const dir = tmpDir("ef-qb64-");
    const argReads = qb64ArgReads(ast);
    const callArgs = qb64CallArgs(ast);
    const outDecl = `DIM ${outputNames.join(" AS DOUBLE, ")} AS DOUBLE`;
    const prints = outputNames.map((n) => `PRINT ef_show$(${n})`).join("\n");
    // Same reasoning as runQB64's own callExpr above -- a leading comma
    // ("CALL name(, out1, out2)") if callArgs were ever empty would be
    // just as broken as the bare-parens case there. No zero-param SUITE
    // sample exists yet to force this in practice (a suite needs >=1
    // output field, never 0 params AND 0 args together here), but this
    // stays correct if one ever does.
    const allCallArgs = [callArgs, outputNames.join(", ")].filter(Boolean).join(", ");
    const harness =
        `$CONSOLE:ONLY\n${source}\n${QB64_HARNESS_HELPERS}${QB64_ERROR_PROLOGUE}${argReads}\n${outDecl}\n` +
        `CALL ${ast.name}(${allCallArgs})\n${prints}\nSYSTEM\n${QB64_ERROR_HANDLER}`;
    const srcPath = path.join(dir, "main.bas");
    fs.writeFileSync(srcPath, harness);
    const bin = path.join(dir, "bin");
    compileQb64(srcPath, bin);
    const results = inputs.map((args) => {
        const lines = runQb64(bin, args.map(argText)).toString().trim().split("\n");
        const record = {};
        outputNames.forEach((name, i) => {
            record[name] = qb64ToNumber(lines[i]);
        });
        return record;
    });
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("qb64", runQB64, runSuiteQB64);

// --- suite (multi-output) variants ----------------------------------------
//
// Same idea as the four run* functions above, but a suite returns several
// named values (see ast.js's outputs()), not one -- each harness prints one
// value per line, in the same field order the emitter itself used
// (Object.keys order, matching suiteOutputNames below), and each result
// comes back as a { [fieldName]: number } record instead of a bare number.

function suiteOutputNames(ast) {
    const { body } = collectLets(ast.body);
    if (body.type !== "outputs") {
        throw new Error(`test/conformance.test.js: ${ast.name} is not a suite (body.type is "${body.type}")`);
    }
    return Object.keys(body.fields);
}

// Every target's own printf/print/repr spells NaN/Infinity as "nan"/
// "inf"/"-inf" (various capitalizations) -- NOT JS's own "NaN"/
// "Infinity"/"-Infinity" spelling, which is the ONLY thing plain
// Number() actually understands. Real gap, not a hypothetical one:
// Number("-inf") is NaN, not -Infinity -- so a target that's genuinely,
// correctly returning -Infinity (see samples/domain-safety-demo.js) used
// to get silently MISREAD as NaN right here, before ever reaching
// assertClose's own comparison. Used everywhere subprocess text output
// gets turned into a JS number, in place of a bare Number(...) call.
function parseNumericOutput(str) {
    const s = str.trim();
    // Scheme/Guile spells these "+inf.0"/"-inf.0"/"+nan.0" -- a
    // mandatory sign AND a trailing ".0" neither of the other targets'
    // spellings have (confirmed directly: the first version of this
    // regex, without the optional "(\.0)?", still misread Guile's own
    // correct -Infinity as NaN -- caught by actually running this
    // against every real toolchain, not just the host-available ones).
    if (/^[+-]?(inf|infinity)(\.0)?$/i.test(s)) {
        return s.startsWith("-") ? -Infinity : Infinity;
    }
    if (/^[+-]?nan(\.0)?$/i.test(s)) {
        return NaN;
    }
    return Number(s);
}

function parseSuiteOutput(stdout, outputNames) {
    const lines = stdout.toString().trim().split("\n");
    const record = {};
    outputNames.forEach((name, i) => {
        record[name] = parseNumericOutput(lines[i]);
    });
    return record;
}

function runSuiteC(ast, inputs, outputNames) {
    const source = emitters.c.emitFunction(ast);
    const dir = tmpDir("ef-c-");
    fs.writeFileSync(path.join(dir, "fn.c"), source);
    const decls = cParamDecls(ast);
    const callArgs = ast.params.join(", ");
    const structName = `${capitalize(ast.name)}Result`;
    const prints = outputNames.map((n) => `printf("%.17g\\n", r.${n});`).join(" ");
    const harness =
        `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include "fn.c"\n` +
        `int main(int argc, char **argv) {\n    ${decls}\n    ${structName} r = ${ast.name}(${callArgs});\n    ${prints}\n    return 0;\n}\n`;
    fs.writeFileSync(path.join(dir, "main.c"), harness);
    const bin = path.join(dir, "bin");
    execFileSync("gcc", [path.join(dir, "main.c"), "-o", bin, "-lm"]);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync(bin, args.map(argText)), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("c", runC, runSuiteC);

function runSuiteGo(ast, inputs, outputNames) {
    const source = emitters.go.emitFunction(ast);
    const funcDecl = source.slice(source.indexOf("func "));
    const usesMath = funcDecl.includes("math.");
    const dir = tmpDir("ef-go-");
    execFileSync("go", ["mod", "init", "ef"], { cwd: dir });
    const parses = goParamParses(ast);
    const callArgs = ast.params.join(", ");
    const resultVars = outputNames.map((_, i) => `r${i}`).join(", ");
    const printFmt = outputNames.map(() => "%.17g").join("\\n");
    const mainSrc =
        `package main\n\n` +
        `import (\n\t"fmt"\n${usesMath ? `\t"math"\n` : ""}\t"os"\n${goUsesArray(ast) ? `\t"strings"\n` : ""}\t"strconv"\n)\n\n` +
        `${funcDecl}\n` +
        `func main() {\n${parses}\n\t${resultVars} := ${capitalize(ast.name)}(${callArgs})\n\tfmt.Printf("${printFmt}\\n", ${resultVars})\n}\n`;
    fs.writeFileSync(path.join(dir, "main.go"), mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("go", ["build", "-o", bin, "."], { cwd: dir });
    const results = inputs.map((args) => parseSuiteOutput(execFileSync(bin, args.map(argText)), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("go", runGo, runSuiteGo);

function runSuiteRust(ast, inputs, outputNames) {
    const source = emitters.rust.emitFunction(ast);
    const dir = tmpDir("ef-rs-");
    const parses = rustParamParses(ast);
    const callArgs = rustCallArgs(ast);
    const prints = outputNames.map((n) => `println!("{:e}", r.${n});`).join("\n    ");
    const mainSrc =
        `${source}\n` +
        `fn main() {\n` +
        `    let args: Vec<String> = std::env::args().collect();\n` +
        `${parses}\n` +
        `    let r = ${ast.name}(${callArgs});\n` +
        `    ${prints}\n` +
        `}\n`;
    const srcPath = path.join(dir, "main.rs");
    fs.writeFileSync(srcPath, mainSrc);
    const bin = path.join(dir, "bin");
    execFileSync("rustc", ["-O", srcPath, "-o", bin]);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync(bin, args.map(argText)), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("rust", runRust, runSuiteRust);

function runSuiteJava(ast, inputs, outputNames) {
    const source = emitters.java.emitFunction(ast);
    const className = capitalize(ast.name);
    const dir = tmpDir("ef-java-");
    fs.writeFileSync(path.join(dir, `${className}.java`), source);
    const parses = javaParamParses(ast);
    const callArgs = ast.params.join(", ");
    const printStmts = outputNames.map((n) => `        System.out.println(r.${n});`).join("\n");
    const mainSrc =
        `public class Main {\n` +
        `    public static void main(String[] args) {\n` +
        `${parses}\n` +
        `        ${className}.Result r = ${className}.${ast.name}(${callArgs});\n` +
        `${printStmts}\n` +
        `    }\n` +
        `}\n`;
    fs.writeFileSync(path.join(dir, "Main.java"), mainSrc);
    execFileSync("javac", ["-d", dir, path.join(dir, `${className}.java`), path.join(dir, "Main.java")]);
    const results = inputs.map((args) =>
        parseSuiteOutput(execFileSync("java", ["-cp", dir, "Main", ...args.map(argText)]), outputNames),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("java", runJava, runSuiteJava);

// --- C# --------------------------------------------------------------
//
// dotnet build needs a project, not a single file -- a minimal SDK-style
// .csproj gets written alongside the emitted source each time. Built once
// per test (dotnet build, into an out/ subdir) and the resulting .dll run
// directly (dotnet <dll>) per input row, same compile-once-run-many shape
// as C/Go/Rust. InvariantGlobalization avoids any locale-dependent decimal
// separator surprises when parsing argv.

//
// ImplicitUsings is OFF on purpose: the emitted source must compile with
// no `using` directives at all (csharp.js fully qualifies global::System.Math).
// Only the harness's own Program.cs imports System. TargetFramework comes
// from test/dotnet-tfm.js (EXPRFORGE_DOTNET_TFM override, else the highest
// installed SDK major).

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>${DOTNET_TFM}</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <InvariantGlobalization>true</InvariantGlobalization>
  </PropertyGroup>
</Project>
`;

// Matches csharp.js's wrapperClassName -- not just capitalize(fn.name),
// since C# forbids a member sharing its enclosing type's exact name and
// every SpEf-prefixed sample name is already capitalized (see csharp.js).
function csharpClassName(fnName) {
    return `${capitalize(fnName)}Impl`;
}

// Array-typed params: comma-joined CLI string -> double[] via
// string.Split + Array.ConvertAll(..., double.Parse). csharp.js's own
// array-param signature is a plain `double[]` (see its formatFunction),
// so the call site is unchanged, same as a scalar.
function csharpParamParses(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `double[] ${p} = Array.ConvertAll(args[${i}].Split(','), double.Parse);`;
            }
            return `double ${p} = double.Parse(args[${i}]);`;
        })
        .join("\n");
}

function runCSharp(ast, inputs) {
    const source = emitters.csharp.emitFunction(ast);
    const className = csharpClassName(ast.name);
    const dir = tmpDir("ef-cs-");
    fs.writeFileSync(path.join(dir, `${className}.cs`), source);
    fs.writeFileSync(path.join(dir, "app.csproj"), CSPROJ);
    const parses = csharpParamParses(ast);
    const callArgs = ast.params.join(", ");
    const mainSrc = `using System;\n${parses}\nConsole.WriteLine(${className}.${ast.name}(${callArgs}).ToString("G17"));\n`;
    fs.writeFileSync(path.join(dir, "Program.cs"), mainSrc);
    const outDir = path.join(dir, "out");
    execFileSync("dotnet", ["build", "-c", "Release", "-o", outDir], { cwd: dir });
    const dll = path.join(outDir, "app.dll");
    const results = inputs.map((args) => parseNumericOutput(execFileSync("dotnet", [dll, ...args.map(argText)]).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteCSharp(ast, inputs, outputNames) {
    const source = emitters.csharp.emitFunction(ast);
    const className = csharpClassName(ast.name);
    const dir = tmpDir("ef-cs-");
    fs.writeFileSync(path.join(dir, `${className}.cs`), source);
    fs.writeFileSync(path.join(dir, "app.csproj"), CSPROJ);
    const parses = csharpParamParses(ast);
    const callArgs = ast.params.join(", ");
    const prints = outputNames.map((n) => `Console.WriteLine(r.${n}.ToString("G17"));`).join("\n");
    const mainSrc = `using System;\n${parses}\nvar r = ${className}.${ast.name}(${callArgs});\n${prints}\n`;
    fs.writeFileSync(path.join(dir, "Program.cs"), mainSrc);
    const outDir = path.join(dir, "out");
    execFileSync("dotnet", ["build", "-c", "Release", "-o", outDir], { cwd: dir });
    const dll = path.join(outDir, "app.dll");
    const results = inputs.map((args) => parseSuiteOutput(execFileSync("dotnet", [dll, ...args.map(argText)]), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("csharp", runCSharp, runSuiteCSharp);

// --- Python --------------------------------------------------------------
//
// No compile step -- python3 interprets the emitted source directly, with
// a small argv-reading harness appended.

// Array-typed params: comma-joined CLI string -> a plain Python list via
// a split + float() comprehension. python.js's own array-param signature
// is just a bare name (no type annotation at all -- see its
// formatFunction), so the call site is unchanged, same as a scalar.
function pythonParamParses(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `${p} = [float(_v) for _v in sys.argv[${i + 1}].split(",")]`;
            }
            return `${p} = float(sys.argv[${i + 1}])`;
        })
        .join("\n");
}

function runPython(ast, inputs) {
    const source = emitters.python.emitFunction(ast);
    const dir = tmpDir("ef-py-");
    const parses = pythonParamParses(ast);
    const callArgs = ast.params.join(", ");
    const harness = `${source}\nimport sys\n${parses}\nprint(repr(${ast.name}(${callArgs})))\n`;
    const srcPath = path.join(dir, "main.py");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseNumericOutput(execFileSync("python3", [srcPath, ...args.map(argText)]).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuitePython(ast, inputs, outputNames) {
    const source = emitters.python.emitFunction(ast);
    const dir = tmpDir("ef-py-");
    const parses = pythonParamParses(ast);
    const callArgs = ast.params.join(", ");
    const prints = outputNames.map((n) => `print(repr(r.${n}))`).join("\n");
    const harness = `${source}\nimport sys\n${parses}\nr = ${ast.name}(${callArgs})\n${prints}\n`;
    const srcPath = path.join(dir, "main.py");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync("python3", [srcPath, ...args.map(argText)]), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("python", runPython, runSuitePython);

// --- Lua -------------------------------------------------------------------
//
// No compile step -- lua interprets the emitted source directly. CLI args
// arrive via the global `arg` table (arg[1] is the first argument, like
// argv[1] in C -- arg[0] is the script name, same convention).

// Array-typed params: comma-joined CLI string -> a plain Lua table via a
// gmatch split loop (Lua has no built-in string-split) + tonumber. This
// naturally builds a 1-indexed table, matching lua.js's own array-param
// convention (a bare name; the emitted function itself does the +1
// translation internally, see its emitIndex), so the call site is
// unchanged, same as a scalar.
// tonumber() cannot read NaN/Infinity (and returns nil, which then fails
// far from the cause), so non-finite and signed-zero arguments go through
// ef_num; same idea for PHP and Scheme below.
const LUA_NUM_HELPER =
    `local function ef_num(s)\n` +
    `    if s == "NaN" then return 0/0 elseif s == "Infinity" then return math.huge\n` +
    `    elseif s == "-Infinity" then return -math.huge elseif s == "-0" then return -0.0\n` +
    `    else return tonumber(s) + 0.0 end\nend\n`;

function luaParamParses(ast) {
    return LUA_NUM_HELPER + ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `local ${p} = {}\n` +
                    `for _s in string.gmatch(arg[${i + 1}], "[^,]+") do table.insert(${p}, tonumber(_s)) end`;
            }
            return `local ${p} = ef_num(arg[${i + 1}])`;
        })
        .join("\n");
}

function runLua(ast, inputs) {
    const source = emitters.lua.emitFunction(ast);
    const dir = tmpDir("ef-lua-");
    const parses = luaParamParses(ast);
    const callArgs = ast.params.join(", ");
    const harness = `${source}\n${parses}\nprint(string.format("%.17g", ${ast.name}(${callArgs})))\n`;
    const srcPath = path.join(dir, "main.lua");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseNumericOutput(execFileSync(bin("lua"), [srcPath, ...args.map(argText)]).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteLua(ast, inputs, outputNames) {
    const source = emitters.lua.emitFunction(ast);
    const dir = tmpDir("ef-lua-");
    const parses = luaParamParses(ast);
    const callArgs = ast.params.join(", ");
    const resultVars = outputNames.map((_, i) => `r${i}`).join(", ");
    const prints = outputNames.map((_, i) => `print(string.format("%.17g", r${i}))`).join("\n");
    const harness = `${source}\n${parses}\nlocal ${resultVars} = ${ast.name}(${callArgs})\n${prints}\n`;
    const srcPath = path.join(dir, "main.lua");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync(bin("lua"), [srcPath, ...args.map(argText)]), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("lua", runLua, runSuiteLua);

// --- Perl --------------------------------------------------------------
//
// No compile step -- perl interprets the emitted source directly. Args
// come in via @ARGV (0-indexed), like argv[1..] in C.

// Array-typed params: comma-joined CLI string -> an arrayref. perl.js's
// own array-param convention is an ARRAYREF (see its own comment on
// emitIndex: "$ref->[i]", arrow-deref, not a plain @array) -- so unlike
// every scalar param, an array-typed one is built as a REAL Perl array
// first, then referenced with "\@...", not just assigned directly.
function perlParamParses(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `my @${p}_list = split(',', $ARGV[${i}]);\nmy $${p} = \\@${p}_list;`;
            }
            return `my $${p} = $ARGV[${i}] eq "-0" ? "-0.0" * 1.0 : $ARGV[${i}];`;
        })
        .join("\n");
}

function runPerl(ast, inputs) {
    const source = emitters.perl.emitFunction(ast);
    const dir = tmpDir("ef-pl-");
    const parses = perlParamParses(ast);
    const callArgs = ast.params.map((p) => `$${p}`).join(", ");
    const harness = `${source}\n${parses}\nprintf("%.17g\\n", ${ast.name}(${callArgs}));\n`;
    const srcPath = path.join(dir, "main.pl");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseNumericOutput(execFileSync("perl", [srcPath, ...args.map(argText)]).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuitePerl(ast, inputs, outputNames) {
    const source = emitters.perl.emitFunction(ast);
    const dir = tmpDir("ef-pl-");
    const parses = perlParamParses(ast);
    const callArgs = ast.params.map((p) => `$${p}`).join(", ");
    const prints = outputNames.map((n) => `printf("%.17g\\n", $r->{${n}});`).join("\n");
    const harness = `${source}\n${parses}\nmy $r = ${ast.name}(${callArgs});\n${prints}\n`;
    const srcPath = path.join(dir, "main.pl");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync("perl", [srcPath, ...args.map(argText)]), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

// --- Ruby --------------------------------------------------------------
//
// No compile step -- ruby interprets the emitted source directly. Args
// come in via ARGV (0-indexed). Array-typed params: comma-joined CLI
// string -> an Array of Floats. Scalar params are passed as the raw ARGV
// String on purpose: the emitted function coerces them with Float() on
// entry (see emitters/ruby.js), so this also exercises that coercion.
// Float() rejects "NaN" and "Infinity", so those three spellings are mapped
// to the Float constants harness-side; every other scalar stays a raw
// String and is coerced by the emitted function.
const RUBY_NONFINITE =
    `EF_NONFINITE = { "NaN" => Float::NAN, "Infinity" => Float::INFINITY, "-Infinity" => -Float::INFINITY }\n`;

function rubyParamParses(ast) {
    return RUBY_NONFINITE + ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `${p} = ARGV[${i}].split(',').map { |s| Float(s) }`;
            }
            return `${p} = EF_NONFINITE.fetch(ARGV[${i}], ARGV[${i}])`;
        })
        .join("\n");
}

function runRuby(ast, inputs) {
    const source = emitters.ruby.emitFunction(ast);
    const dir = tmpDir("ef-rb-");
    const parses = rubyParamParses(ast);
    const callArgs = ast.params.join(", ");
    const harness = `${source}\n${parses}\nputs format("%.17g", ${ast.name}(${callArgs}))\n`;
    const srcPath = path.join(dir, "main.rb");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseNumericOutput(execFileSync(bin("ruby"), [srcPath, ...args.map(argText)]).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteRuby(ast, inputs, outputNames) {
    const source = emitters.ruby.emitFunction(ast);
    const dir = tmpDir("ef-rb-");
    const parses = rubyParamParses(ast);
    const callArgs = ast.params.join(", ");
    const prints = outputNames.map((n) => `puts format("%.17g", r[:${n}])`).join("\n");
    const harness = `${source}\n${parses}\nr = ${ast.name}(${callArgs})\n${prints}\n`;
    const srcPath = path.join(dir, "main.rb");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync(bin("ruby"), [srcPath, ...args.map(argText)]), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("ruby", runRuby, runSuiteRuby);
registerRunner("perl", runPerl, runSuitePerl);

// --- PHP -------------------------------------------------------------------
//
// No compile step -- php interprets the emitted source directly. The
// emitted source opens `<?php` and never closes it (see emitters/php.js),
// so the harness just continues appending plain PHP statements.

// Array-typed params: comma-joined CLI string -> a plain PHP array via
// explode + array_map('floatval', ...). php.js's own array-param
// convention is a bare name (no type annotation -- see its
// formatFunction), so the call site is unchanged, same as a scalar.
const PHP_NUM_HELPER =
    `function ef_num($s) {\n` +
    `    if ($s === "NaN") return NAN; if ($s === "Infinity") return INF;\n` +
    `    if ($s === "-Infinity") return -INF; if ($s === "-0") return -0.0;\n` +
    `    return floatval($s);\n}\n`;

function phpParamParses(ast) {
    return PHP_NUM_HELPER + ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `$${p} = array_map('floatval', explode(',', $argv[${i + 1}]));`;
            }
            return `$${p} = ef_num($argv[${i + 1}]);`;
        })
        .join("\n");
}

// This PHP build's own printf()/sprintf() (confirmed: NOT echo, NOT
// var_dump -- both of those already show the correct signed value)
// silently DROPS THE SIGN of negative infinity specifically -- "%.17g"
// and "%f" both print bare "INF" for a value that var_dump() itself
// reports as float(-INF). A real PHP output-formatting bug (confirmed
// directly, on the exact php-cli version this project's own CI
// installs), not anything wrong with the computed value itself or with
// this project's emitted PHP source -- worked around here, in the test
// harness, by checking is_infinite() and picking the correctly-signed
// string by hand instead of trusting printf with it.
function phpPrintExpr(varExpr) {
    return `printf("%s\\n", is_infinite(${varExpr}) ? ((${varExpr}) < 0 ? "-INF" : "INF") : sprintf("%.17g", ${varExpr}));`;
}

function runPhp(ast, inputs) {
    const source = emitters.php.emitFunction(ast);
    const dir = tmpDir("ef-php-");
    const parses = phpParamParses(ast);
    const callArgs = ast.params.map((p) => `$${p}`).join(", ");
    const harness = `${source}\n${parses}\n$ef_result = ${ast.name}(${callArgs});\n${phpPrintExpr("$ef_result")}\n`;
    const srcPath = path.join(dir, "main.php");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseNumericOutput(execFileSync("php", [srcPath, ...args.map(argText)]).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuitePhp(ast, inputs, outputNames) {
    const source = emitters.php.emitFunction(ast);
    const dir = tmpDir("ef-php-");
    const parses = phpParamParses(ast);
    const callArgs = ast.params.map((p) => `$${p}`).join(", ");
    const prints = outputNames.map((n) => phpPrintExpr(`$r['${n}']`)).join("\n");
    const harness = `${source}\n${parses}\n$r = ${ast.name}(${callArgs});\n${prints}\n`;
    const srcPath = path.join(dir, "main.php");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync("php", [srcPath, ...args.map(argText)]), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("php", runPhp, runSuitePhp);

// --- Julia -------------------------------------------------------------------
//
// No compile step -- julia interprets the emitted source directly. Args
// come in via ARGS (1-indexed), unlike every 0-indexed argv convention
// elsewhere in this file -- Julia arrays are 1-indexed throughout.

// Array-typed params: comma-joined CLI string -> a plain Julia Vector via
// split + broadcast parse. julia.js's own array-param convention is a
// bare name (no type annotation -- see its formatFunction; the emitted
// function itself handles the 0-based-caller-index -> Julia's native
// 1-based indexing translation internally, see its emitIndex), so the
// call site is unchanged, same as a scalar.
function juliaParamParses(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `${p} = parse.(Float64, split(ARGS[${i + 1}], ","))`;
            }
            return `${p} = parse(Float64, ARGS[${i + 1}])`;
        })
        .join("\n");
}

function runJulia(ast, inputs) {
    const source = emitters.julia.emitFunction(ast);
    const dir = tmpDir("ef-jl-");
    const parses = juliaParamParses(ast);
    const callArgs = ast.params.join(", ");
    const harness = `${source}\n${parses}\nprintln(${ast.name}(${callArgs}))\n`;
    const srcPath = path.join(dir, "main.jl");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseNumericOutput(execFileSync("julia", [srcPath, ...args.map(argText)]).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteJulia(ast, inputs, outputNames) {
    const source = emitters.julia.emitFunction(ast);
    const dir = tmpDir("ef-jl-");
    const parses = juliaParamParses(ast);
    const callArgs = ast.params.join(", ");
    const prints = outputNames.map((n) => `println(r.${n})`).join("\n");
    const harness = `${source}\n${parses}\nr = ${ast.name}(${callArgs})\n${prints}\n`;
    const srcPath = path.join(dir, "main.jl");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync("julia", [srcPath, ...args.map(argText)]), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("julia", runJulia, runSuiteJulia);

// --- R -----------------------------------------------------------------------
//
// No compile step -- Rscript interprets the emitted source directly.
// Arguments arrive through commandArgs(trailingOnly = TRUE); array-typed
// params are comma-joined strings split into a numeric vector. Output goes
// through sprintf("%.17g") so doubles round-trip exactly; Inf/-Inf/NaN
// spellings are handled by parseNumericOutput.

function rParamParses(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `${p} <- as.numeric(strsplit(args[${i + 1}], ",")[[1]])`;
            }
            return `${p} <- as.numeric(args[${i + 1}])`;
        })
        .join("\n");
}

function runR(ast, inputs) {
    const source = emitters.r.emitFunction(ast);
    const dir = tmpDir("ef-r-");
    const callArgs = ast.params.join(", ");
    const harness = `${source}\nargs <- commandArgs(trailingOnly = TRUE)\n${rParamParses(ast)}\ncat(sprintf("%.17g", ${ast.name}(${callArgs})), "\\n", sep = "")\n`;
    const srcPath = path.join(dir, "main.R");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseNumericOutput(execFileSync("Rscript", [srcPath, ...args.map(argText)]).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteR(ast, inputs, outputNames) {
    const source = emitters.r.emitFunction(ast);
    const dir = tmpDir("ef-r-");
    const callArgs = ast.params.join(", ");
    const prints = outputNames.map((n) => `cat(sprintf("%.17g", r$${n}), "\\n", sep = "")`).join("\n");
    const harness = `${source}\nargs <- commandArgs(trailingOnly = TRUE)\n${rParamParses(ast)}\nr <- ${ast.name}(${callArgs})\n${prints}\n`;
    const srcPath = path.join(dir, "main.R");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync("Rscript", [srcPath, ...args.map(argText)]), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("r", runR, runSuiteR);

// --- MATLAB / Octave ---------------------------------------------------------
//
// Run with octave-cli (never the GUI binary) against the emitted .m file,
// which must be named after its function. MATLAB itself is not exercised
// anywhere in CI -- see emitters/matlab.js's header comment. One Octave
// process per sample: a driver script calls the function once per input
// with the argument values written as literals and prints every result
// with %.17g (Octave prints Inf/NaN as "Inf"/"NaN", which
// parseNumericOutput already understands). Array-typed params are passed
// as plain row vectors.

function octaveLiteral(value) {
    if (Array.isArray(value)) return `[${value.map(octaveLiteral).join(", ")}]`;
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Inf";
    if (value === -Infinity) return "-Inf";
    if (Object.is(value, -0)) return "-0";
    return String(value);
}

function runOctaveDriver(ast, inputs, outputNames) {
    const source = emitters.matlab.emitFunction(ast);
    const dir = tmpDir("ef-oct-");
    fs.writeFileSync(path.join(dir, `${ast.name}.m`), source);
    const resultVars = outputNames.map((_, i) => `ef_o${i}`);
    const lhs = outputNames.length === 1 ? resultVars[0] : `[${resultVars.join(", ")}]`;
    const calls = inputs.map((args) => {
        const prints = resultVars.map((r) => `printf("%.17g\\n", ${r});`).join(" ");
        return `${lhs} = ${ast.name}(${args.map(octaveLiteral).join(", ")}); ${prints}`;
    });
    fs.writeFileSync(path.join(dir, "ef_driver.m"), calls.join("\n") + "\n");
    const stdout = execFileSync("octave-cli", ["--norc", "ef_driver.m"], { cwd: dir }).toString().trim().split("\n");
    fs.rmSync(dir, { recursive: true, force: true });
    return inputs.map((_, i) => outputNames.map((__, j) => parseNumericOutput(stdout[i * outputNames.length + j])));
}

function runOctave(ast, inputs) {
    return runOctaveDriver(ast, inputs, ["result"]).map(([r]) => r);
}

function runSuiteOctave(ast, inputs, outputNames) {
    return runOctaveDriver(ast, inputs, outputNames).map((row) =>
        Object.fromEntries(outputNames.map((n, i) => [n, row[i]])));
}
registerRunner("matlab", runOctave, runSuiteOctave);

// --- Scheme (Guile) --------------------------------------------------------
//
// No compile step -- guile3.0 interprets the emitted source directly
// (--no-auto-compile skips writing a bytecode cache, unneeded for a
// one-shot run). (command-line) returns a list with the script path at
// index 0 and the real args from index 1 on. A suite's (values ...)
// return is unpacked with call-with-values, same mechanism
// samples/spline-frame.js-equivalent Scheme code would use by hand.

// Array-typed params: comma-joined CLI string -> a Scheme vector via
// string-split + map + string->number. scheme.js's own emitIndex uses
// vector-ref (see its own comment), so this has to build a VECTOR, not a
// list -- list->vector wraps the mapped list of numbers.
const SCHEME_NUM_HELPER =
    `(define (ef-num s) (cond ((string=? s "NaN") +nan.0) ((string=? s "Infinity") +inf.0) ` +
    `((string=? s "-Infinity") -inf.0) ((string=? s "-0") -0.0) (else (exact->inexact (string->number s)))))\n`;

function schemeParamParses(ast) {
    return SCHEME_NUM_HELPER + ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `(define ${p} (list->vector (map (lambda (s) (exact->inexact (string->number s))) ` +
                    `(string-split (list-ref (command-line) ${i + 1}) #\\,))))`;
            }
            return `(define ${p} (ef-num (list-ref (command-line) ${i + 1})))`;
        })
        .join("\n");
}

function runScheme(ast, inputs) {
    const source = emitters.scheme.emitFunction(ast);
    const dir = tmpDir("ef-scm-");
    const parses = schemeParamParses(ast);
    const callArgs = ast.params.join(" ");
    const harness = `${source}\n${parses}\n(display (${ast.name} ${callArgs})) (newline)\n`;
    const srcPath = path.join(dir, "main.scm");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) =>
        parseNumericOutput(execFileSync(bin("scheme"), ["--no-auto-compile", srcPath, ...args.map(argText)]).toString().trim()),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteScheme(ast, inputs, outputNames) {
    const source = emitters.scheme.emitFunction(ast);
    const dir = tmpDir("ef-scm-");
    const parses = schemeParamParses(ast);
    const callArgs = ast.params.join(" ");
    const bindings = outputNames.join(" ");
    const prints = outputNames.map((n) => `(display ${n}) (newline)`).join(" ");
    const harness =
        `${source}\n${parses}\n` +
        `(call-with-values (lambda () (${ast.name} ${callArgs})) (lambda (${bindings}) ${prints}))\n`;
    const srcPath = path.join(dir, "main.scm");
    fs.writeFileSync(srcPath, harness);
    const results = inputs.map((args) =>
        parseSuiteOutput(execFileSync(bin("scheme"), ["--no-auto-compile", srcPath, ...args.map(argText)]), outputNames),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("scheme", runScheme, runSuiteScheme);

// --- Fortran -----------------------------------------------------------
//
// Compiled via gfortran, fn.f90 (the emitted module) and main.f90 (the
// harness) as two separate source files built together in one invocation
// -- same compile-once-run-many shape as C/Go/Rust. The external
// function's return type has to be redeclared in the caller (Fortran has
// no header/prototype file here), matching how it was actually verified
// working during development (see emitters/fortran.js).
//
// wrapFortranLine mirrors emitters/fortran.js's own wrapLine -- needed
// here too, not just in the emitter, since this harness builds its own
// declaration/call lines (confirmed against real CI: mathDemo's 9 params
// + 13 outputs made both exceed Fortran's real 132-character free-form
// line limit here, in the hand-written harness, even after the emitter
// itself was already fixed).
function wrapFortranLine(line, maxWidth = 100) {
    if (line.length <= maxWidth) return line;
    const words = line.split(" ");
    const wrapped = [];
    let current = "";
    for (const word of words) {
        if (current && current.length + 1 + word.length > maxWidth) {
            wrapped.push(`${current} &`);
            current = `        ${word}`;
        } else {
            current = current ? `${current} ${word}` : word;
        }
    }
    if (current) wrapped.push(current);
    return wrapped.join("\n");
}

// Array-typed params: fixed-size (0:63) real(8) array, matching
// fn.f90's own assumed-size `dimension(0:*)` dummy argument (see
// emitters/fortran.js -- confirmed working regardless of the CALLER's
// own declared bounds). Fortran has no built-in string-split, so the
// comma-joined CLI arg is parsed with a manual index()-based loop, one
// element at a time, into per-param-prefixed loop variables (never a
// shared/reused name -- safe even with multiple array params in one
// function). Every scalar param still shares the one `double precision`
// declaration line exactly as before; array params get their own
// `dimension` line instead.
function fortranScalarNames(ast) {
    return ast.params.filter((p) => ast.paramTypes?.[p] !== "number[]");
}

function fortranArrayNames(ast) {
    return ast.params.filter((p) => ast.paramTypes?.[p] === "number[]");
}

function fortranArrayDecls(ast) {
    return fortranArrayNames(ast)
        .map((p) => `    real(8), dimension(0:63) :: ${p}\n    integer :: ${p}_pos, ${p}_comma, ${p}_n`)
        .join("\n");
}

function fortranReads(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `    call get_command_argument(${i + 1}, argstr)\n` +
                    `    ${p}_pos = 1\n    ${p}_n = 0\n` +
                    `    do while (${p}_pos <= len_trim(argstr))\n` +
                    `        ${p}_comma = index(argstr(${p}_pos:), ',')\n` +
                    `        if (${p}_comma == 0) then\n` +
                    `            read(argstr(${p}_pos:len_trim(argstr)), *) ${p}(${p}_n)\n` +
                    `            ${p}_pos = len_trim(argstr) + 1\n` +
                    `        else\n` +
                    `            read(argstr(${p}_pos:${p}_pos + ${p}_comma - 2), *) ${p}(${p}_n)\n` +
                    `            ${p}_pos = ${p}_pos + ${p}_comma\n` +
                    `        end if\n` +
                    `        ${p}_n = ${p}_n + 1\n` +
                    `    end do`;
            }
            return `    call get_command_argument(${i + 1}, argstr)\n    read(argstr, *) ${p}`;
        })
        .join("\n");
}

function runFortran(ast, inputs) {
    const source = emitters.fortran.emitFunction(ast);
    const dir = tmpDir("ef-f90-");
    fs.writeFileSync(path.join(dir, "fn.f90"), source);
    const varDecl = [...fortranScalarNames(ast), ast.name].join(", ");
    const reads = fortranReads(ast);
    const callArgs = ast.params.join(", ");
    const harness =
        `program main\n` +
        `    implicit none\n` +
        wrapFortranLine(`    double precision :: ${varDecl}`) + "\n" +
        fortranArrayDecls(ast) + (fortranArrayNames(ast).length ? "\n" : "") +
        `    character(len=256) :: argstr\n` +
        reads + "\n" +
        wrapFortranLine(`    write(*, '(ES32.16E3)') ${ast.name}(${callArgs})`) + "\n" +
        `end program main\n`;
    fs.writeFileSync(path.join(dir, "main.f90"), harness);
    const bin = path.join(dir, "bin");
    execFileSync("gfortran", ["-O2", "-o", bin, path.join(dir, "main.f90"), path.join(dir, "fn.f90")]);
    const results = inputs.map((args) => parseNumericOutput(execFileSync(bin, args.map(argText)).toString()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteFortran(ast, inputs, outputNames) {
    const source = emitters.fortran.emitFunction(ast);
    const dir = tmpDir("ef-f90-");
    fs.writeFileSync(path.join(dir, "fn.f90"), source);
    const varDecl = [...fortranScalarNames(ast), ...outputNames].join(", ");
    const reads = fortranReads(ast);
    const callArgs = [...ast.params, ...outputNames].join(", ");
    const prints = outputNames.map((n) => `    write(*, '(ES32.16E3)') ${n}`).join("\n");
    const harness =
        `program main\n` +
        `    implicit none\n` +
        wrapFortranLine(`    double precision :: ${varDecl}`) + "\n" +
        fortranArrayDecls(ast) + (fortranArrayNames(ast).length ? "\n" : "") +
        `    character(len=256) :: argstr\n` +
        reads + "\n" +
        wrapFortranLine(`    call ${ast.name}(${callArgs})`) + "\n" +
        prints + "\n" +
        `end program main\n`;
    fs.writeFileSync(path.join(dir, "main.f90"), harness);
    const bin = path.join(dir, "bin");
    execFileSync("gfortran", ["-O2", "-o", bin, path.join(dir, "main.f90"), path.join(dir, "fn.f90")]);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync(bin, args.map(argText)), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("fortran", runFortran, runSuiteFortran);

// --- Zig -----------------------------------------------------------------
//
// Compiled via `zig build-exe`. Unlike C/Go/Rust/Fortran, there's no
// separate-compilation-plus-link step -- Zig resolves its whole
// dependency graph from one entry point, so the harness's main.zig just
// `@import`s the emitted fn.zig directly and `zig build-exe` compiles
// both together in one invocation.
//
// Output goes through std.io.getStdOut().writer(), NOT std.debug.print --
// confirmed the hard way (every value came back as 0/NaN here before this
// fix) that std.debug.print writes to stderr by design, not stdout, so
// execFileSync (which only captures stdout) was reading nothing.

// Array-typed params: comma-joined CLI string -> a fixed-size (256-slot)
// buffer, sliced to the real element count, via std.mem.splitScalar +
// std.fmt.parseFloat. zig.js's own array-param signature is `[]const
// f64` (a slice -- see its formatFunction), which a sliced-down buffer
// coerces to directly, so the call site is unchanged, same as a scalar.
function zigParamParses(ast) {
    return ast.params
        .map((p, i) => {
            if (ast.paramTypes?.[p] === "number[]") {
                return `    var ${p}_it = std.mem.splitScalar(u8, args[${i + 1}], ',');\n` +
                    `    var ${p}_buf: [256]f64 = undefined;\n` +
                    `    var ${p}_n: usize = 0;\n` +
                    `    while (${p}_it.next()) |_s| {\n` +
                    `        ${p}_buf[${p}_n] = try std.fmt.parseFloat(f64, _s);\n` +
                    `        ${p}_n += 1;\n    }\n` +
                    `    const ${p} = ${p}_buf[0..${p}_n];`;
            }
            return `    const ${p} = try std.fmt.parseFloat(f64, args[${i + 1}]);`;
        })
        .join("\n");
}

function runZig(ast, inputs) {
    const source = emitters.zig.emitFunction(ast);
    const dir = tmpDir("ef-zig-");
    fs.writeFileSync(path.join(dir, "fn.zig"), source);
    const parses = zigParamParses(ast);
    const callArgs = ast.params.join(", ");
    // `args` is only ever referenced inside zigParamParses' own output --
    // an unused local `const` is a real Zig compile error (confirmed
    // directly, not a warning) for a zero-parameter function, where
    // `parses` never references it. Every sample before zeroParamDemo
    // had >=1 parameter, so this declaration never hit the empty case
    // before.
    const argsDecl = ast.params.length > 0
        ? `    const args = try std.process.argsAlloc(std.heap.page_allocator);\n`
        : "";
    const harness =
        `const std = @import("std");\n` +
        `const fnmod = @import("fn.zig");\n\n` +
        `pub fn main() !void {\n` +
        argsDecl +
        `    const stdout = std.io.getStdOut().writer();\n` +
        parses + "\n" +
        `    try stdout.print("{d}\\n", .{fnmod.${ast.name}(${callArgs})});\n` +
        `}\n`;
    fs.writeFileSync(path.join(dir, "main.zig"), harness);
    const bin = path.join(dir, "bin");
    execFileSync("zig", ["build-exe", path.join(dir, "main.zig"), "-O", "ReleaseFast", `-femit-bin=${bin}`], { cwd: dir });
    const results = inputs.map((args) => parseNumericOutput(execFileSync(bin, args.map(argText)).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteZig(ast, inputs, outputNames) {
    const source = emitters.zig.emitFunction(ast);
    const dir = tmpDir("ef-zig-");
    fs.writeFileSync(path.join(dir, "fn.zig"), source);
    const parses = zigParamParses(ast);
    const callArgs = ast.params.join(", ");
    const prints = outputNames.map((n) => `    try stdout.print("{d}\\n", .{r.${n}});`).join("\n");
    const harness =
        `const std = @import("std");\n` +
        `const fnmod = @import("fn.zig");\n\n` +
        `pub fn main() !void {\n` +
        `    const args = try std.process.argsAlloc(std.heap.page_allocator);\n` +
        `    const stdout = std.io.getStdOut().writer();\n` +
        parses + "\n" +
        `    const r = fnmod.${ast.name}(${callArgs});\n` +
        prints + "\n" +
        `}\n`;
    fs.writeFileSync(path.join(dir, "main.zig"), harness);
    const bin = path.join(dir, "bin");
    execFileSync("zig", ["build-exe", path.join(dir, "main.zig"), "-O", "ReleaseFast", `-femit-bin=${bin}`], { cwd: dir });
    const results = inputs.map((args) => parseSuiteOutput(execFileSync(bin, args.map(argText)), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("zig", runZig, runSuiteZig);

// --- COBOL (GnuCOBOL) -------------------------------------------------------
//
// Compiled via cobc, fn.cob (the emitted PROGRAM-ID module, which also
// carries its own ef-cmp-* select() helpers -- see emitters/cobol.js) and
// main.cob (the harness) as two separate source files built together, same
// shape as Fortran's two-file build above. Both scalar and suite results
// come back via CALL "name" USING ... with every output as a trailing
// BY REFERENCE parameter (see emitters/cobol.js for why scalars use this
// instead of a FUNCTION-style return too). Args arrive one at a time via
// GnuCOBOL's ARGUMENT-NUMBER/ARGUMENT-VALUE mechanism, converted with
// FUNCTION NUMVAL -- there's no argv-array equivalent.

// This harness's own local variables are declared directly from
// ast.params/outputNames -- but COBOL's CALL...USING is purely
// positional (the CALLEE's linkage-section parameter name is
// independent of whatever the CALLER's own local variable holding that
// argument happens to be named), so prefixing every harness-local name
// this way is completely safe and changes nothing about what's actually
// being tested. Needed for real, not just defensively: found the hard
// way when test/conformance.test.js's own exprSyntaxDemo fixture
// started using "c" as a real param name again (see its own comment) to
// prove emitters/cobol.js's renameConflictingParams fix works end-to-end
// -- this harness had an entirely independent instance of the exact
// same bare-"c"-in-a-USING-clause restriction, on the CALLER's side,
// unrelated to whatever the callee's own parameters are named.
function harnessVar(name) {
    return `harness-${name}`;
}

function runCobol(ast, inputs) {
    const source = emitters.cobol.emitFunction(ast);
    const dir = tmpDir("ef-cob-");
    fs.writeFileSync(path.join(dir, "fn.cob"), source);
    const varDecl = [...ast.params, "ef-result"].map((p) => `       01 ${harnessVar(p)} USAGE COMP-2.`).join("\n");
    const reads = ast.params
        .map(
            (p, i) =>
                `           DISPLAY ${i + 1} UPON ARGUMENT-NUMBER\n` +
                `           ACCEPT WS-ARG FROM ARGUMENT-VALUE\n` +
                `           COMPUTE ${harnessVar(p)} = FUNCTION NUMVAL(WS-ARG)`,
        )
        .join("\n");
    const callArgs = [...ast.params, "ef-result"].map(harnessVar).join(" ");
    const harness =
        `       >>SOURCE FORMAT FREE\n` +
        `       IDENTIFICATION DIVISION.\n` +
        `       PROGRAM-ID. mainharness.\n` +
        `       DATA DIVISION.\n` +
        `       WORKING-STORAGE SECTION.\n` +
        `       01 WS-ARG PIC X(64).\n` +
        varDecl + "\n" +
        `       PROCEDURE DIVISION.\n` +
        reads + "\n" +
        `           CALL "${ast.name}" USING ${callArgs}\n` +
        `           DISPLAY ${harnessVar("ef-result")}\n` +
        `           STOP RUN.\n`;
    const srcPath = path.join(dir, "main.cob");
    fs.writeFileSync(srcPath, harness);
    const bin = path.join(dir, "bin");
    execFileSync("cobc", ["-x", "-free", "-o", bin, srcPath, path.join(dir, "fn.cob")]);
    const results = inputs.map((args) => parseNumericOutput(execFileSync(bin, args.map(argText)).toString().trim()));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}

function runSuiteCobol(ast, inputs, outputNames) {
    const source = emitters.cobol.emitFunction(ast);
    const dir = tmpDir("ef-cob-");
    fs.writeFileSync(path.join(dir, "fn.cob"), source);
    const varDecl = [...ast.params, ...outputNames].map((p) => `       01 ${harnessVar(p)} USAGE COMP-2.`).join("\n");
    const reads = ast.params
        .map(
            (p, i) =>
                `           DISPLAY ${i + 1} UPON ARGUMENT-NUMBER\n` +
                `           ACCEPT WS-ARG FROM ARGUMENT-VALUE\n` +
                `           COMPUTE ${harnessVar(p)} = FUNCTION NUMVAL(WS-ARG)`,
        )
        .join("\n");
    const callArgs = [...ast.params, ...outputNames].map(harnessVar).join(" ");
    const prints = outputNames.map((n) => `           DISPLAY ${harnessVar(n)}`).join("\n");
    const harness =
        `       >>SOURCE FORMAT FREE\n` +
        `       IDENTIFICATION DIVISION.\n` +
        `       PROGRAM-ID. mainharness.\n` +
        `       DATA DIVISION.\n` +
        `       WORKING-STORAGE SECTION.\n` +
        `       01 WS-ARG PIC X(64).\n` +
        varDecl + "\n" +
        `       PROCEDURE DIVISION.\n` +
        reads + "\n" +
        `           CALL "${ast.name}" USING ${callArgs}\n` +
        prints + "\n" +
        `           STOP RUN.\n`;
    const srcPath = path.join(dir, "main.cob");
    fs.writeFileSync(srcPath, harness);
    const bin = path.join(dir, "bin");
    execFileSync("cobc", ["-x", "-free", "-o", bin, srcPath, path.join(dir, "fn.cob")]);
    const results = inputs.map((args) => parseSuiteOutput(execFileSync(bin, args.map(argText)), outputNames));
    fs.rmSync(dir, { recursive: true, force: true });
    return results;
}
registerRunner("cobol", runCobol, runSuiteCobol);

function collect(list, fn) {
    try {
        fn();
    } catch (e) {
        list.push(e.message);
    }
}

function jsonNum(_k, x) {
    if (typeof x !== "number") return x;
    return Object.is(x, -0) ? "-0" : Number.isFinite(x) ? x : String(x);
}

// todoTargets: { label: reason } -- a real, recorded divergence on that
// target. The test still runs and is reported, but as a node:test TODO so
// it does not fail the suite.
function registerSuiteConformance(sampleName, { ast, inputs, skipTargets = [], targetCmp = {}, skipRows = {}, todo = false, todoTargets = {}, ...cmpOpts }) {
    const outputNames = suiteOutputNames(ast);
    const targets = [["Interpreter", true, runEval], ...runnerTargets("runSuite")].filter(([label]) => !skipTargets.includes(label) && targetAllowed(label));

    for (const [label, available, run] of targets) {
        test(
            `${sampleName}: ${label} emitted output matches JS`,
            { skip: !available && `${label} toolchain not available`, todo: todo || todoTargets[label] || false },
            () => {
                const jsFn = loadJsFn(ast);
                const rows = inputs.filter((args) => !skipRows[label]?.(args));
                const expected = rows.map((args) => jsFn(...args));
                const actual = run(ast, rows, outputNames);
                assert.strictEqual(actual.length, expected.length);
                const mismatches = [];
                for (let i = 0; i < rows.length; i++) {
                    for (const name of outputNames) {
                        collect(mismatches, () =>
                            assertClose(
                                actual[i][name],
                                expected[i][name],
                                `${label} vs JS at args=${JSON.stringify(rows[i], jsonNum)}, field "${name}"`,
                                { ...cmpOpts, ...targetCmp[label] },
                            ),
                        );
                    }
                }
                assert.ok(mismatches.length === 0, `${mismatches.length} mismatch(es):\n${mismatches.join("\n")}`);
            },
        );
    }
}

// --- test registration ---------------------------------------------------

function registerConformance(sampleName, { ast, reference, inputs, skipTargets = [], targetCmp = {}, skipRows = {}, todo = false, ...cmpOpts }) {
    if (reference) {
        test(`${sampleName}: emitted JS matches an independent reference implementation`, () => {
            const fn = loadJsFn(ast);
            for (const args of inputs) {
                assertClose(fn(...args), reference(...args), `args=${JSON.stringify(args)}`);
            }
        });
    }

    const targets = [["Interpreter", true, runEval], ...runnerTargets("run")].filter(([label]) => !skipTargets.includes(label) && targetAllowed(label));

    for (const [label, available, run] of targets) {
        test(
            `${sampleName}: ${label} emitted output matches JS`,
            { skip: !available && `${label} toolchain not available`, todo: todo || false },
            () => {
                const jsFn = loadJsFn(ast);
                const rows = inputs.filter((args) => !skipRows[label]?.(args));
                const expected = rows.map((args) => jsFn(...args));
                const actual = run(ast, rows);
                assert.strictEqual(actual.length, expected.length);
                const mismatches = [];
                for (let i = 0; i < rows.length; i++) {
                    collect(mismatches, () =>
                        assertClose(actual[i], expected[i], `${label} vs JS at args=${JSON.stringify(rows[i], jsonNum)}`, { ...cmpOpts, ...targetCmp[label] }),
                    );
                }
                assert.ok(mismatches.length === 0, `${mismatches.length} mismatch(es):\n${mismatches.join("\n")}`);
            },
        );
    }
}

test("every executable target with a conformance label has registered run and runSuite harnesses", () => {
    for (const { lang, meta } of registryTargets()) {
        if (meta.kind !== "executable" || !meta.testTarget) continue;
        assert.ok(
            RUNNERS[lang] && typeof RUNNERS[lang].run === "function" && typeof RUNNERS[lang].runSuite === "function",
            `${lang}: no registerRunner("${lang}", run, runSuite) in test/conformance.test.js`,
        );
        assert.ok(TOOLS[lang] !== undefined, `${lang}: meta.toolchain.probes is required for a target with a testTarget`);
    }
    for (const lang of Object.keys(RUNNERS)) {
        assert.ok(registryTargets().some((t) => t.lang === lang), `runner registered for unknown target ${lang}`);
    }
});

for (const [sampleName, sample] of Object.entries(SAMPLES)) {
    registerConformance(sampleName, sample);
}

// --- samples/spline-frame.js ---------------------------------------------
//
// The real-world motivating case for let/select/cmp, and now for outputs()
// (see ast.js): 4 suites, each replacing what used to be several separate
// functions independently re-deriving the same let-chain. No independent
// per-suite reference (that would mean re-deriving the whole Gram-Schmidt
// frame math by hand) — instead, cross-language conformance (every target
// vs. JS) for all 4, plus one independent check of a property the math
// must satisfy regardless of how it's computed: the constructed R basis
// vector is unit length, including at the degenerate (0,0,0) tangent
// where safeDiv's fallback kicks in.

const SPLINE_FRAME_INPUTS = {
    "tx,ty,tz": [
        [0, 1, 0], // near-vertical branch
        [1, 0, 0], // normal branch
        [0, 0, 0], // degenerate: safeDiv fallback
        [0.577, 0.577, 0.577],
    ],
    "wx,wy_wire,wz_wire,tx,ty,tz,prDeg,so": [
        [0, 0, 0, 1, 0, 0, 0, 1],
        [1, 2, 3, 0, 1, 0, 90, 0.5],
        [0, 0, 0, 0, 0, 0, 45, 1], // degenerate tangent
    ],
    "ux,uy,uz,rx,ry,rz,crDeg": [
        [1, 0, 0, 0, 1, 0, 0],
        [1, 0, 0, 0, 1, 0, 90],
        [0, 1, 0, 1, 0, 0, 45],
    ],
    t: [[0], [0.5], [1], [-0.3]],
};

for (const ast of splineFrameAsts) {
    const inputs = SPLINE_FRAME_INPUTS[ast.params.join(",")];
    if (!inputs) {
        throw new Error(`test/conformance.test.js: no sample inputs registered for params ${ast.params.join(",")}`);
    }
    registerSuiteConformance(`splineFrame.${ast.name}`, {
        ast,
        inputs,
        // Found by the ULP-based comparison (the old 1e-9 absolute floor hid
        // it): cos(90 degrees) is a near-zero result (~6.1e-17, pure
        // argument-rounding residue) and GnuCOBOL's FUNCTION COS returns
        // ~2.8e-16 there. An absolute 1e-15 bound is granted to COBOL for
        // this cancellation-to-zero residue only; see README "Numeric
        // guarantees".
        targetCmp: { COBOL: { absTol: 1e-15 } },
    });
}

// --- samples/comparison-ops-demo.js ---------------------------------------
//
// Real compiled/executed coverage for every cmp() operator, on every
// available real toolchain -- see that file's own header comment for the
// actual shipped bug (qb64/fortran/lua all mishandled "!="; qb64 also
// mishandled "==") this exists to make structurally impossible to repeat.
// Every input row below hits BOTH the true and false side of every one of
// the six operators at least once (a > b, a < b, a == b), including a
// negative-number pair -- not just the "a > b" shape every OTHER sample
// that ever exercised select()/cmp() against a real compiler happened to
// use exclusively.
registerSuiteConformance("comparisonOps", {
    ast: comparisonOpsAst,
    inputs: [
        [3, 5], // a < b: lt/le/ne true, gt/ge/eq false
        [5, 3], // a > b: gt/ge/ne true, lt/le/eq false
        [5, 5], // a == b: ge/le/eq true, gt/lt/ne false
        [-2, 4], // negative vs positive
        [-2, -2], // negative equality
    ],
    // Same genuine GnuCOBOL codegen limitation as nestedSelect's own
    // skipTargets above, at its most extreme -- all 6 distinct
    // comparison operators, each its own emitters/cobol.js FUNCTION-ID
    // helper, called in one PROCEDURE DIVISION. Confirmed via real CI
    // runs (not local reproduction, which proved unreliable for this
    // specific question) on both gnucobol3 and gnucobol4 identically.
    // See nestedSelect's own comment for the full pattern and what a
    // real fix would require.
    skipTargets: ["COBOL"],
});

// MATLAB/Octave has no conditional expression, so emitters/matlab.js picks
// with an `if` inside a helper function rather than arithmetic emulation.
// Octave-only on purpose: a value from the untaken branch (Inf here, from
// 1/x at x == 0) must not leak into the result, which arithmetic select
// (QB64's c*a + (1-c)*b) cannot guarantee and other targets handle under
// their own rules.
test(
    "selectNoLeak: Octave select does not leak Inf/NaN from the untaken branch",
    { skip: (!TOOLS.matlab && "Octave toolchain not available") || (!targetAllowed("Octave") && "Octave filtered out") },
    () => {
        const { v, num, cmp, select, call, bin } = require("../ast.js");
        const ast = {
            name: "selectNoLeak",
            params: ["x"],
            body: select(cmp(v("x"), "==", num(0)), num(7), bin("/", num(1), v("x"))),
        };
        const nanBranch = {
            name: "selectNoLeakNaN",
            params: ["x"],
            body: select(cmp(v("x"), ">=", num(0)), call("sqrt", v("x")), num(-1)),
        };
        const inputs = [[0], [4], [-4], [0.25]];
        const jsFn = loadJsFn(ast);
        const actual = runOctave(ast, inputs);
        inputs.forEach((args, i) => assertClose(actual[i], jsFn(...args), `selectNoLeak at ${JSON.stringify(args)}`));
        assert.strictEqual(actual[0], 7);
        const jsNan = loadJsFn(nanBranch);
        const actualNan = runOctave(nanBranch, inputs);
        inputs.forEach((args, i) => assertClose(actualNan[i], jsNan(...args), `selectNoLeakNaN at ${JSON.stringify(args)}`));
    },
);

// Proves sqrt/log/asin/acos/pow/log2/log10 return NaN/Infinity for an
// out-of-domain argument identically on every target -- see
// samples/domain-safety-demo.js's own header comment for the full,
// directly-verified breakdown of what each target used to do instead
// (QB64: crashed/hung; Python: raised; Perl: raised for sqrt/log/log2;
// Scheme: silently became a COMPLEX number) and how each was fixed.
registerSuiteConformance("domainSafety", {
    ast: domainSafetyAst,
    inputs: [
        [0.5], // fully in-domain -- real values, sanity-checks the fix
        // didn't change anything for the case that was already correct
        [-1], // sqrt/log/pow/log2/log10 -> NaN/-Infinity; asin(-1)/
        // acos(-1) are still in-domain (valid at the boundary)
        [2], // asin/acos -> NaN; everything else in-domain
        [0], // log/log2/log10 -> -Infinity; sqrt/asin/acos/pow in-domain
    ],
    // GnuCOBOL's intrinsic FUNCTION SQRT/LOG/ASIN/ACOS (and pow's own
    // spillPow helper) all silently return 0 -- not NaN, not a crash,
    // not an error -- for an out-of-domain argument, confirmed directly
    // against a real compile+run. A SIXTH distinct real divergence this
    // audit found (see domain-safety-demo.js), deliberately NOT
    // guard-fixed the way QB64/Python/Perl/Scheme were: this project
    // already found and confirmed (see nestedSelect/comparisonOps'
    // own skipTargets above, same file) that GnuCOBOL's codegen has a
    // real, fatal "unknown type name 'cob_decimal'" bug triggered by
    // piling up multiple decimal-arithmetic-heavy IF-guarded helper
    // FUNCTION-IDs in one compilation unit -- exactly the shape a
    // domain-guard fix for 5 different primitives would need. Adding
    // that risked reintroducing the exact crash already worked around
    // elsewhere in this same file, for a target whose math intrinsics
    // are already documented elsewhere as not fully reliable. Skipped,
    // not silently ignored.
    skipTargets: ["COBOL"],
});

// Array-typed parameter used inside a multi-output outputs() suite (see
// samples/array-suite-demo.js's own header comment) -- the array-param
// harness work (#36) and the suite/multi-output harness machinery
// existed independently before this; this is the one place they're
// actually exercised TOGETHER, against real toolchains.
registerSuiteConformance("arraySuite", {
    ast: arraySuiteAst,
    inputs: [
        [[10, 20, 30, 40], 4, 5], // wraps past the end
        [[10, 20, 30, 40], 4, -1], // wraps past the start
        [[10, 20, 30, 40], 4, 2], // no wrap needed
    ],
    skipTargets: ["COBOL"],
});

// Proves min()/max() propagate NaN identically (regardless of which
// argument it's in) on every target -- see samples/math-edge-cases-
// demo.js's own header comment for the full, directly-verified
// breakdown (C/Rust/Zig: NaN-ignoring; Python/Lua/QB64: position-
// dependent, first-wins; PHP: position-dependent, second-wins; Perl:
// inconsistent even with itself) and docs/adr/0003-min-max-nan-
// propagation.md for the decision record.
registerSuiteConformance("mathEdgeCases", {
    ast: mathEdgeCasesAst,
    inputs: [
        [5, -1], // real, positive, finite -- the value that "wins" once
        // NaN is correctly recognized and excluded. negSrc just needs
        // to be negative (see math-edge-cases-demo.js's own comment on
        // why it must be a runtime parameter, not a literal constant).
        [-3, -1], // real, negative, finite -- same check, opposite sign
    ],
    // Same GnuCOBOL cob_decimal codegen fragility as domainSafety/
    // comparisonOps/nestedSelect/arraySuite above -- FUNCTION MIN is
    // confirmed flatly wrong (returns 0, not either operand) for a NaN
    // argument, and a real fix needs a new helper FUNCTION-ID, the exact
    // shape already confirmed to crash cobc when piled up with others.
    // See emitters/cobol.js's own min:/max: comment. Skipped, not
    // silently ignored.
    skipTargets: ["COBOL"],
});

// Proves division by a runtime zero follows IEEE 754 identically on
// every target (see samples/division-by-zero-demo.js and
// docs/adr/0004-division-by-zero.md): x/0 is +-Infinity with the sign
// taken from both operands (including a -0 denominator, synthesized in
// the expression), 0/0 and NaN/0 are NaN.
registerSuiteConformance("divisionByZero", {
    ast: divisionByZeroAst,
    inputs: [
        [5, 0], // positive numerator: +Infinity / -Infinity
        [-5, 0], // negative numerator: signs flip
        [0, 0], // 0/0 numerator: NaN everywhere
    ],
    // Documented exception, see docs/adr/0004-division-by-zero.md:
    // GnuCOBOL's COMPUTE is decimal arithmetic. A zero denominator is a
    // size error that leaves the target unchanged, and Infinity/NaN
    // cannot survive any COMPUTE (confirmed: COMPUTE y = inf stores 0),
    // so IEEE results are not reachable inside an expression.
    skipTargets: ["COBOL"],
});

// Proves floor/ceil/trunc/round agree with the interpreter on every target
// for NaN, +-Infinity (built inside the expression from a runtime zero),
// halves, +-0 and finite values beyond the integer range (see
// samples/non-finite-rounding-demo.js).
registerSuiteConformance("nonFiniteRounding", {
    ast: nonFiniteRoundingAst,
    inputs: [
        [2.5, 0],
        [-2.5, 0],
        [0.5, 0],
        [-0.5, 0],
        [1.5, 0],
        [-1.5, 0],
        [-0.4, 0],
        [0.4, 0],
        [0, 0],
        [1e300, 0],
        [-1e300, 0],
        [3e9, 0],
    ],
    // GnuCOBOL's COMPUTE is decimal arithmetic with no Infinity or NaN;
    // same documented exception as divisionByZero above.
    skipTargets: ["COBOL"],
});

// Sign of zero through the same four operations, observed as 1/op(v).
registerSuiteConformance("roundingZeroSign", {
    ast: roundingZeroSignAst,
    inputs: [
        [-0.4, 0],
        [0.4, 0],
        [0, 0],
        [-2.5, 0],
        [2.5, 0],
    ],
    skipTargets: ["COBOL"],
});

// --- samples/math-demo.js -------------------------------------------------
//
// Cross-language coverage for require("exprforge/math") (see
// /v0.2.0-spec.md and math/index.js). One suite exercising every helper at
// once, same shape as the splineFrame wiring above. Input rows are chosen
// to hit both the safe and degenerate/fallback path of each guarded
// helper, not just the easy case:
//   row 0: everything comfortably in the "normal" branch.
//   row 1: vector a is (0,0,0) -- normalize3's fallback kicks in for normA;
//          t is below lo -- clamp's low branch.
//   row 2: vector b is (0,0,0) -- normalize3's fallback for normB, AND
//          bx == 0 -- safeDiv's fallback (-1); t is above hi -- clamp's
//          high branch.
//   row 3: two non-axis-aligned, non-degenerate vectors; t inside [lo,hi]
//          -- clamp is a no-op, both normalize3 calls take the safe path.
const MATH_DEMO_INPUTS = [
    [3, 4, 0, 1, 0, 0, 0.5, 0, 1],
    [0, 0, 0, 1, 1, 1, -0.5, 0, 1],
    [1, 0, 0, 0, 0, 0, 1.5, 0, 1],
    [0.577, 0.577, 0.577, 0.577, -0.577, 0.577, 0.3, -1, 1],
];

registerSuiteConformance("mathDemo", { ast: mathDemoAst, inputs: MATH_DEMO_INPUTS });

test("math-demo: normalize3's fallback is used exactly when the input vector is (0,0,0)", () => {
    const mathDemo = loadJsFn(mathDemoAst);
    const safe = mathDemo(1, 0, 0, 1, 0, 0, 0.5, 0, 1);
    assert.ok(Math.abs(safe.normAX ** 2 + safe.normAY ** 2 + safe.normAZ ** 2 - 1) < 1e-9, "normal input normalizes to unit length");

    const degenerate = mathDemo(0, 0, 0, 1, 0, 0, 0.5, 0, 1);
    // Default fallback per math/index.js: (0, 1, 0).
    assertClose(degenerate.normAX, 0, "degenerate normA.x falls back to 0");
    assertClose(degenerate.normAY, 1, "degenerate normA.y falls back to 1");
    assertClose(degenerate.normAZ, 0, "degenerate normA.z falls back to 0");
});

test("math-demo: clamp actually clamps at both ends and is a no-op inside range", () => {
    const mathDemo = loadJsFn(mathDemoAst);
    assertClose(mathDemo(1, 0, 0, 1, 0, 0, -0.5, 0, 1).clamped, 0, "below lo clamps to lo");
    assertClose(mathDemo(1, 0, 0, 1, 0, 0, 1.5, 0, 1).clamped, 1, "above hi clamps to hi");
    assertClose(mathDemo(1, 0, 0, 1, 0, 0, 0.5, 0, 1).clamped, 0.5, "inside range passes through unchanged");
});

test("math-demo: safeDiv falls back to its third argument exactly when the denominator is 0", () => {
    const mathDemo = loadJsFn(mathDemoAst);
    assertClose(mathDemo(1, 0, 0, 1, 0, 0, 0.5, 0, 1).safeDivResult, 1, "1/1 takes the safe path");
    assertClose(mathDemo(1, 0, 0, 0, 0, 0, 0.5, 0, 1).safeDivResult, -1, "bx=0 falls back to -1");
});

test("math-demo: cross3's result is orthogonal to both input vectors", () => {
    const mathDemo = loadJsFn(mathDemoAst);
    const dot = (ux, uy, uz, wx, wy, wz) => ux * wx + uy * wy + uz * wz;
    for (const args of MATH_DEMO_INPUTS) {
        const [ax, ay, az, bx, by, bz] = args;
        const { crossX, crossY, crossZ } = mathDemo(...args);
        assertClose(dot(crossX, crossY, crossZ, ax, ay, az), 0, `cross·a at args=${JSON.stringify(args)}`);
        assertClose(dot(crossX, crossY, crossZ, bx, by, bz), 0, `cross·b at args=${JSON.stringify(args)}`);
    }
});

test("spline-frame: SpEfMkFrame's R is unit length, including at the degenerate tangent", () => {
    const mkFrame = loadJsFn(splineFrameAsts.find((a) => a.name === "SpEfMkFrame"));
    const tangents = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0.99, 0.1],
        [0.577, 0.577, 0.577],
        [0, 0, 0], // degenerate -- fallback frame (0,0,1) must still be unit length
    ];
    for (const [tx, ty, tz] of tangents) {
        const { rx, ry, rz } = mkFrame(tx, ty, tz);
        const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
        assert.ok(Math.abs(len - 1) < 1e-9, `R not unit length for tangent (${tx},${ty},${tz}): len=${len}`);
    }
});

// --- expr-syntax emitter round-trip ---------------------------------------
//
// The strongest available proof that fn.js's parser and
// emitters/exprsyntax.js's printer are exact inverses of each other:
// print every sample AST used in this file back out as fn/expr source
// text, reparse it, and confirm it BEHAVES identically to the original
// -- evaluated (via evaluate.js) across each sample's own already-
// registered representative inputs, not compared as raw tree shapes.
//
// Structural (deepStrictEqual) comparison was tried first and produces
// false failures: ast.js's own neg(x) is CANONICALLY defined as
// sub(num(0), x) (see ast.js), but a negative number literal like
// num(-5) prints as the bare text "-5" -- which the tokenizer (by
// design; NUMBER never lexes a leading sign, see expr.js) reparses as
// unary minus over a positive literal, i.e. exactly neg(num(5)), a
// *different* tree shape computing the *identical* value. Several
// samples here (catmullRom's polynomial coefficients, mathDemo's/
// splineFrame's fallback constants) hit this. Evaluating both sides
// instead of diffing JSON is both the fix and, per this file's own
// opening comment ("proving the emitted targets agree numerically, not
// just that they compile"), the more honest form of proof anyway.
//
// This lives here rather than its own test file because
// normalizeXAst/exprSyntaxDemoAst above are deliberately local-only
// fixtures (not exported from index.js like the others), and this is
// the one place every sample AST this project has is already in scope
// at once, alongside the same input rows already used above.
//
const { loadExprSource } = require("../load-expr.js");

function assertExprSyntaxRoundTrips(ast, inputs) {
    const printed = emitters.expr.emitFunction(ast);
    // The printed text always carries its own "fn name(params):"
    // signature line (emitters/exprsyntax.js -- always "fn", never
    // "macro": the printer only ever handles one already-resolved
    // definition in isolation, so "fn" is the only honest thing to
    // print, see that file's own comment). Reparsed via loadExprSource
    // -- the real parser for this format now that a bare signature
    // isn't legal there (see fn.js's requireExportKeyword mode) -- not
    // fn() directly, which doesn't recognize "fn" as a keyword at all
    // (see fn.js's own header comment on why that's scoped to
    // load-expr.js specifically). Recovers a full {name, params, body}
    // directly, with no need to borrow ast.name/ast.params from the
    // original the way an earlier version of this test did. Asserting
    // on the reparsed values themselves (not just reusing the source
    // ones) is what actually proves the signature line round-trips, not
    // just the body.
    const reparsedDef = loadExprSource(printed)[ast.name];
    assert.strictEqual(reparsedDef.name, ast.name, `${ast.name}: signature name didn't round-trip -- printed:\n${printed}`);
    assert.deepStrictEqual(reparsedDef.params, ast.params, `${ast.name}: signature params didn't round-trip -- printed:\n${printed}`);
    for (const args of inputs) {
        const original = evaluate(ast, args);
        const roundTripped = evaluate(reparsedDef, args);
        if (original && typeof original === "object") {
            for (const key of Object.keys(original)) {
                assertClose(
                    roundTripped[key],
                    original[key],
                    `${ast.name} round-trip field "${key}" at args=${JSON.stringify(args)} -- printed:\n${printed}`,
                );
            }
        } else {
            assertClose(roundTripped, original, `${ast.name} round-trip at args=${JSON.stringify(args)} -- printed:\n${printed}`);
        }
    }
}

for (const [sampleName, sample] of Object.entries(SAMPLES)) {
    test(`${sampleName}: round-trips through the expr-syntax emitter and back through fn()`, () => {
        assertExprSyntaxRoundTrips(sample.ast, sample.inputs);
    });
}

for (const ast of splineFrameAsts) {
    test(`splineFrame.${ast.name}: round-trips through the expr-syntax emitter and back through fn()`, () => {
        assertExprSyntaxRoundTrips(ast, SPLINE_FRAME_INPUTS[ast.params.join(",")]);
    });
}

test("mathDemo: round-trips through the expr-syntax emitter and back through fn()", () => {
    assertExprSyntaxRoundTrips(mathDemoAst, MATH_DEMO_INPUTS);
});

// --- samples/boundary-conditions-demo.js -----------------------------------
//
// Issue #45: huge / non-finite / signed-zero / subnormal / degenerate
// operands against every real toolchain. See that file's header,
// docs/adr/0005-boundary-conditions.md and README "Numeric guarantees"
// for the outcome per behavior.
{
    const B = require("../samples/boundary-conditions-demo.js");
    const NaN_ = NaN;
    const INF = Infinity;
    const NZ = -0;

    // GnuCOBOL's harness reads arguments through FUNCTION NUMVAL, which
    // understands neither exponent notation, NaN, Infinity nor -0.
    const COBOL_PLAIN_ONLY = {
        COBOL: (args) => nonFiniteOrNegZero(args) || args.some((a) => /e/i.test(argText(a))),
    };

    // GnuCOBOL has no negative zero: a result in (-1, 0) is plain 0.
    const COBOL_NO_NEGZERO = { COBOL: { signedZero: false } };

    // round() uses the exact floor-plus-fraction form (ADR 0001), so
    // 0.49999999999999994 and values above 2^52 round correctly. The sign
    // of a zero result must match too: ceil/round/trunc of (-1, 0) are -0.
    registerSuiteConformance("boundary.rounding", {
        ast: B.roundingBoundaryAst,
        inputs: [
            [1e300], [-1e300], [9.3e18], [-9.3e18], [2147483648.5], [4503599627370496], [-4503599627370496],
            [2 ** 53], [1e15 + 0.5], [INF], [-INF], [NaN_], [NZ], [0.4], [-0.4], [0.5], [-0.5], [3e9], [-3e9],
            [2.5], [-2.5],
        ],
        maxUlps: 0,
        signedZero: true,
        targetCmp: COBOL_NO_NEGZERO,
        skipRows: COBOL_PLAIN_ONLY,
    });
    registerSuiteConformance("boundary.roundPrecisionEdge", {
        ast: B.roundingBoundaryAst,
        inputs: [
            [4503599627370497], [-4503599627370497], [0.49999999999999994], [-0.49999999999999994],
            [2.5], [-2.5], [0.5], [-0.5], [0], [NZ], [1.5], [-1.5], [4503599627370495.5],
        ],
        maxUlps: 0,
        signedZero: true,
        targetCmp: COBOL_NO_NEGZERO,
        skipRows: COBOL_PLAIN_ONLY,
    });
    registerConformance("boundary.sign", {
        ast: B.signBoundaryAst,
        inputs: [[5], [-5], [0], [NZ], [NaN_], [INF], [-INF], [5e-324], [-5e-324]],
        maxUlps: 0,
        signedZero: true,
        skipRows: COBOL_PLAIN_ONLY,
    });
    registerConformance("boundary.hypot", {
        ast: B.hypotBoundaryAst,
        inputs: [
            [3, 4], [1e200, 1e200], [1e308, 1e308], [1e-200, 1e-200], [5e-324, 5e-324], [1e-170, 1e-170],
            [INF, 1], [-INF, 1], [INF, NaN_], [NaN_, INF], [NaN_, 1], [1, NaN_], [0, 0], [NZ, NZ], [NZ, 0],
        ],
        skipRows: COBOL_PLAIN_ONLY,
    });
    registerConformance("boundary.pow", {
        ast: B.powBoundaryAst,
        inputs: [
            [0, 0], [NZ, 0], [NaN_, 0], [INF, 0],
            [0, -1], [0, -2], [0, -0.5], [0, 3], [NZ, 2],
            [INF, 2], [INF, -2], [-INF, 3], [-INF, 2], [-INF, -3], [-INF, -2],
            [2, INF], [2, -INF], [0.5, INF], [0.5, -INF],
            [-8, 3], [-8, 2], [-8, -3], [-8, 1 / 3], [-8, 0.5],
            [2, 1024], [2, -1075], [2, 0.5], [NaN_, 1], [2, NaN_],
        ],
        skipRows: {
            COBOL: (args) => COBOL_PLAIN_ONLY.COBOL(args) || !Number.isFinite(Math.pow(...args)),
        },
    });
    registerConformance("boundary.powSignedZero", {
        ast: B.powBoundaryAst,
        inputs: [[NZ, -1], [NZ, -2], [NZ, -0.5], [NZ, 3], [NZ, 2], [0, 3]],
        signedZero: true,
        skipTargets: ["Perl", "COBOL"],
    });
    registerConformance("boundary.powIeeeCorners", {
        ast: B.powBoundaryAst,
        inputs: [[1, NaN_], [1, INF], [1, -INF], [-1, INF], [-1, -INF], [1, 2], [-1, 3], [-1, NaN_], [NaN_, 0]],
        skipTargets: ["COBOL"],
    });
    registerConformance("boundary.pow.hugeExponent", {
        ast: B.powBoundaryAst,
        inputs: [[-2, 1e300], [-2, 1e15 + 1], [2, 1e300]],
        skipTargets: ["COBOL", "Zig"],
    });
    registerConformance("boundary.atan2", {
        ast: B.atan2BoundaryAst,
        inputs: [
            [0, 0], [NZ, 0], [0, NZ], [NZ, NZ], [0, 1], [NZ, 1], [0, -1], [NZ, -1],
            [1, 0], [-1, 0], [1, NZ], [-1, NZ], [INF, INF], [INF, -INF], [-INF, INF], [-INF, -INF],
            [1, INF], [1, -INF], [NaN_, 1], [1, NaN_],
        ],
        signedZero: true,
        skipRows: COBOL_PLAIN_ONLY,
    });
    registerConformance("boundary.passThrough", {
        ast: B.passThroughAst,
        inputs: [[NaN_], [INF], [-INF], [0], [5e-324], [-5e-324]],
        exact: true,
        skipRows: COBOL_PLAIN_ONLY,
    });
    registerConformance("boundary.passThroughBare", {
        ast: B.passThroughBareAst,
        inputs: [[NaN_], [INF], [-INF], [NZ], [0]],
        exact: true,
        skipTargets: ["COBOL"],
    });
    registerConformance("boundary.passThrough.fullPrecision", {
        ast: B.passThroughAst,
        inputs: [[1.7976931348623157e308], [2.2250738585072014e-308], [0.1 + 0.2], [1 / 3]],
        exact: true,
        skipTargets: ["QB64", "COBOL"],
    });
    registerConformance("boundary.negate", {
        ast: B.negateAst,
        inputs: [[NZ], [0], [INF], [-INF], [NaN_]],
        signedZero: true,
        skipRows: COBOL_PLAIN_ONLY,
    });
    test("boundary.overflowSubnormal: COBOL refuses literals beyond 38 digits at generation time", () => {
        assert.throws(() => emitters.cobol.emitFunction(B.overflowBoundaryAst), /not supported for this target/);
    });
    registerSuiteConformance("boundary.overflowSubnormal", {
        ast: B.overflowBoundaryAst,
        skipTargets: ["COBOL"],
        inputs: [
            [1e200], [-1e200], [1e308], [-1e308], [1e155], [710], [-745], [-746], [0],
            [5e-324], [1e-320], [2.2250738585072014e-308],
        ],
        skipRows: COBOL_PLAIN_ONLY,
    });
    registerSuiteConformance("boundary.expNearOverflow", {
        ast: B.overflowBoundaryAst,
        inputs: [[709.5], [709.78]],
        skipTargets: ["Go", "COBOL"],
    });
    registerConformance("boundary.wrapIndex", {
        ast: B.wrapIndexBoundaryAst,
        inputs: [
            [5, 0], [-5, 0], [0, 0], [5, -3], [-5, -3], [4, -4], [5.5, 3], [-5.5, 3], [5, 2.5], [-1, 2.5],
            [5, 1], [3, 3], [-3, 3], [NZ, 3],
        ],
        skipTargets: [],
        skipRows: { COBOL: (args) => args[1] === 0 || args.some((a) => !Number.isInteger(a)) || Object.is(args[0], -0) },
    });
}

function nonFiniteOrNegZero(args) {
    return args.some((a) => typeof a === "number" && (!Number.isFinite(a) || Object.is(a, -0)));
}
