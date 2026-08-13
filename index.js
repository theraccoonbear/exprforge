// exprforge/index.js
const { num, v, bin, call, add, mul, sub, div, neg, letIn, letChain, cmp, select, outputs, field, collectLets, checkUnboundVars } = require("./ast.js");
const { forComponents } = require("./util.js");
const { expr } = require("./expr.js");
const { fn } = require("./fn.js");
const { evaluate } = require("./evaluate.js");
const { loadMacro, loadExtern, expandMacros, createRegistry } = require("./macros.js");
const { loadExpr, loadExprSource } = require("./load-expr.js");
const emitters = require("./emitters/registry.js");
const { catmullRomAst } = require("./samples/catmull-rom.js");
const { fibonacciAst } = require("./samples/fibonacci.js");
const { splineFrameAsts } = require("./samples/spline-frame.js");
const { kitchenSinkAst } = require("./samples/kitchen-sink.js");
const { mathDemoAst } = require("./samples/math-demo.js");
const { macroDemoAst } = require("./samples/macro-demo.js");

/**
 * Run ONE emitter against one AST function definition. Returns
 * { ext, source }. Throws if `lang` isn't a registered emitter name, or if
 * that emitter itself throws for this fn (an unmapped Math function, a
 * reserved-name collision, ...) -- the caller picked exactly this one
 * target, so there's no "other languages" for a per-language error to be
 * isolated from; let it propagate. Prefer this over emitAll (deprecated,
 * below) when you only need one or a few targets -- it doesn't pay for
 * every registered emitter to get one.
 *
 * `registry` (see macros.js's createRegistry()) defaults to the
 * process-wide default when omitted -- pass a session's own (see
 * createSession() below) to resolve macros/externs registered in that
 * session instead; ordinary callers never need to pass it directly.
 */
function emit(fnDef, lang, registry = undefined) {
    const emitter = emitters[lang];
    if (!emitter) {
        throw new Error(
            `emit(): no emitter registered for language "${lang}" -- known languages: ${Object.keys(emitters).sort().join(", ")}`,
        );
    }
    return { ext: emitter.ext, source: emitter.emitFunction(fnDef, registry) };
}

/**
 * Run several emitters against one AST function definition, each in
 * isolation from the others: one language's emitter throwing shows up as
 * { source: null, error } for THAT language only, alongside every other
 * requested language's real { source, error: null } result -- a single
 * bad target (e.g. a parameter name COBOL's reserved-word check rejects)
 * no longer takes the whole batch down with it. `langs` defaults to every
 * registered language; pass an explicit array to avoid running (and
 * paying for) emitters you don't need.
 *
 * `registry` -- see emit()'s own doc comment above -- same meaning here,
 * applied to every language in `langs`.
 */
function emitMany(fnDef, langs = Object.keys(emitters), registry = undefined) {
    const result = {};
    for (const lang of langs) {
        const emitter = emitters[lang];
        if (!emitter) {
            result[lang] = { ext: null, source: null, error: `no emitter registered for language "${lang}"` };
            continue;
        }
        try {
            result[lang] = { ext: emitter.ext, source: emitter.emitFunction(fnDef, registry), error: null };
        } catch (e) {
            result[lang] = { ext: emitter.ext, source: null, error: e instanceof Error ? e.message : String(e) };
        }
    }
    return result;
}

/**
 * @deprecated Runs every registered emitter unconditionally, whether you
 * need all of them or not -- prefer emit(fnDef, lang) for one target, or
 * emitMany(fnDef, langs) for an explicit subset (or emitMany(fnDef) with
 * no `langs` for the same "every language" behavior this has always had).
 * Kept working, not scheduled for removal -- existing callers reading
 * result[lang].ext/.source see no change; the only behavior change is the
 * bug fix this shares with emitMany: a single emitter throwing used to
 * abort the whole batch (nothing for ANY language came back), and now
 * surfaces as { source: null, error } for that language alone.
 */
function emitAll(fnDef) {
    return emitMany(fnDef);
}

/**
 * Creates an isolated "session": its own private macro/extern registry
 * (see macros.js's createRegistry()), plus every macro/extern/evaluate/
 * emit-shaped function bound to use it instead of the process-wide
 * default registry loadMacro/loadExtern/evaluate/emit/emitMany use when
 * called bare. Purely additive -- loadMacro/loadExtern/etc. above are
 * completely unaffected by a session's existence, and a session's own
 * registrations are invisible to them and to every OTHER session,
 * garbage-collected normally once the session object itself is no
 * longer referenced. No removal API: rebuild a fresh session (via a new
 * createSession() call) instead of trying to unregister one macro/extern
 * out of an existing one -- see the design discussion this came out of
 * (github.com/theraccoonbear/exprforge/issues/21).
 *
 * Useful whenever a program legitimately needs more than one independent
 * "namespace" of macros/externs at once -- e.g. a multi-tenant service
 * evaluating math defined by different untrusted users, where one
 * user's loadMacro("helper", ...) must never resolve inside another
 * user's expression just because they picked the same name.
 */
function createSession() {
    const registry = createRegistry();
    return {
        loadMacro: (name, def) => loadMacro(name, def, registry),
        loadExtern: (name, def) => loadExtern(name, def, registry),
        expandMacros: (fnOrNode, extraRegistry = null) => expandMacros(fnOrNode, extraRegistry, registry),
        evaluate: (fn, args) => evaluate(fn, args, registry),
        emit: (fnDef, lang) => emit(fnDef, lang, registry),
        emitMany: (fnDef, langs = Object.keys(emitters)) => emitMany(fnDef, langs, registry),
        loadExpr: (path) => loadExpr(path, registry),
        loadExprSource: (source, label = "loadExprSource()") => loadExprSource(source, label, registry),
    };
}

module.exports = {
    // AST builders — use these to define your own formulas.
    num, v, bin, call, add, mul, sub, div, neg, letIn, letChain, cmp, select, outputs, field, collectLets, checkUnboundVars,
    // Authoring convenience — not an AST primitive, see util.js.
    forComponents,
    // Infix syntax sugar over the builders above — same Nodes, see expr.js.
    expr,
    // Full function-body syntax (let/return) on top of expr's grammar —
    // see fn.js. "fn's contain expr's": every expression inside a fn`...`
    // template is parsed by the exact same engine expr() uses.
    fn,
    // A native interpreter over the AST -- evaluate(fn, args) computes a
    // result directly in JS, no codegen/compile step. See evaluate.js.
    evaluate,
    // Register a macro: a name usable inside fn`...`/expr`...` text
    // beyond the built-in primitives, inline-expanded at build time,
    // never emitted as a real call. See macros.js's own header comment.
    loadMacro,
    // Register an extern: same usable-by-name mechanism, but a real
    // per-target native call instead -- caller-owned risk, ExprForge
    // can't verify it. See macros.js's own header comment.
    loadExtern,
    // Runs the same macro/field-access expansion evaluate() and every
    // emitter already run internally -- exposed for callers who want the
    // expanded tree itself (e.g. to inspect or re-emit it without
    // re-running expansion). Ordinary callers never need this.
    expandMacros,
    // Parses a .expr file (the exprsyntax emitter's own round-trip
    // format) into its function definitions, letting later functions in
    // the file reference earlier ones as inline macros. See load-expr.js.
    loadExpr,
    // Same parser, given source text directly instead of a file path --
    // no filesystem involved, so this is the one usable from a browser
    // (a text editor buffer, an HTTP response, ...). loadExpr(path) is
    // now just this plus a readFileSync.
    loadExprSource,
    // Built-in example formulas — see samples/ for the source.
    catmullRomAst,
    fibonacciAst,
    splineFrameAsts,
    // Not a worked example -- a conformance-test fixture that calls every
    // supported Math function once. See samples/kitchen-sink.js.
    kitchenSinkAst,
    // Also not a worked example -- a conformance-test fixture for
    // require("exprforge/math"). See samples/math-demo.js.
    mathDemoAst,
    // Also not a worked example -- a conformance-test fixture for
    // macros.js's AST-fn-def macro tier specifically (loadMacro(name,
    // fn`...`), not the plain-JS-function tier mathDemoAst already
    // covers). See samples/macro-demo.js.
    macroDemoAst,
    samples: {
        catmullRom: catmullRomAst,
        fibonacci: fibonacciAst,
        splineFrame: splineFrameAsts,
        kitchenSink: kitchenSinkAst,
        mathDemo: mathDemoAst,
        macroDemo: macroDemoAst,
    },
    // Per-language emitter instances, keyed by name (js, qb64, c, java, go, rust).
    emitters,
    // One target, explicit -- see this function's own doc comment above.
    emit,
    // Several targets at once, each isolated from the others' failures.
    emitMany,
    // Deprecated: every target at once, no way to ask for fewer. Prefer
    // emit()/emitMany() above -- kept working, not removed.
    emitAll,
    // Creates an isolated session: its own private macro/extern registry,
    // plus loadMacro/loadExtern/evaluate/emit/emitMany/loadExpr/
    // loadExprSource bound to use it. See this function's own doc
    // comment above.
    createSession,
};
