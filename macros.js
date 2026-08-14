// exprforge/macros.js
//
// Two independent ways to teach fn()/expr() bodies about a name beyond
// the fixed ~22 built-in Math primitives (see ast.js's call() node and
// every emitters/<lang>.js's own `calls` table) -- see GitHub issue #21
// for the full design discussion this shipped from.
//
// Vocabulary, deliberately not "intrinsic" for either tier: in real
// compilers an intrinsic is something the COMPILER already knows about,
// which is backwards for something a caller registers themselves.
//
// MACROS (loadMacro(name, def)): inline-expanded into the caller's AST
// at build time by expandMacros() below, NEVER emitted as a real call in
// any target -- "the emitter stays dumb, walks an AST, writes math" is
// load-bearing here, not just an implementation convenience: no call
// graph, no declaration-order/linking problem, no runtime coupling, and
// (since a macro can only ever reference macros ALREADY registered by
// the time IT'S registered -- see toMacro below and load-expr.js) no
// recursion either, structurally, not by a runtime guard. Safe by
// construction: a macro's result is built entirely from this library's
// own ast.js primitives, so it's exactly as trustworthy as anything else
// this library already emits.
//
// One classic macro trade-off DOES carry over, deliberately not hidden:
// expansion is pure substitution, so if a macro's body references one of
// its own parameters more than once, the caller's argument expression
// gets duplicated in the output everywhere that parameter appears -- not
// shared, not auto-let-bound. Same shape of trade-off `safeDiv`'s own
// doc comment (math/index.js) already warns about for its
// twice-referenced `denominatorExpr`; general to every macro now, not
// one helper. Pass an already-let-bound v(name) as the argument instead
// of a raw expensive expression if that duplication matters to you.
//
// EXTERNS (loadExtern(name, def)): a real, per-target native call --
// same mechanism as the built-in primitives, just supplied by the caller
// instead of shipped here. ExprForge can't verify the named symbol
// actually exists in a given target, or that it behaves identically
// across every target you provide a mapping for -- that's entirely on
// the caller, the same way linking an unfamiliar library is in any other
// compiled language. Prefer a macro whenever the math itself CAN be
// written in ExprForge; reach for extern only for something that
// genuinely can't be (a call into an existing native library, for
// instance).
const { v, letIn, call, collectLets, MACRO_GENSYM_PREFIX } = require("./ast.js");
const { PRIMITIVE_ARITY } = require("./primitives.js");

const PRIMITIVE_NAMES = new Set(Object.keys(PRIMITIVE_ARITY));

// A registry is just the pair of Maps loadMacro()/loadExtern() actually
// mutate -- { macros, externs }, both name -> entry, same shapes as
// before this existed. Every session-aware function below (loadMacro,
// loadExtern, expandMacros, resolveExternForEvaluate,
// resolveExternForEmitter, and (via index.js) evaluate/emit/emitMany/
// loadExpr/loadExprSource) takes one as an optional trailing argument,
// defaulting to `defaultRegistry` -- the same module-level Maps this
// file has always used, so every EXISTING call site (every test, every
// sample, math/index.js's own top-level registrations, the playground)
// keeps working completely unchanged. createSession() (see index.js) is
// what actually creates and threads a NON-default one through: a fresh,
// independently-namespaced registry that never touches `defaultRegistry`
// at all, garbage-collected normally once you drop the session, with no
// removal API needed for that -- see the README's "Sessions" section.
function createRegistry() {
    return {
        macros: new Map(), // name -> { arity: number|null, fn, alreadyExpanded: boolean }
        externs: new Map(), // name -> { evaluate?: (...args:number[])=>number, [lang]: (argStrs:string[])=>string }
    };
}

const defaultRegistry = createRegistry();

// Re-runs `fn`, and if it throws, re-throws with `context` prefixed onto
// the message -- a macro function, or an extern's own `evaluate`/
// per-target template, throwing (a bug in the CALLER's own
// implementation, not exprforge's) otherwise propagates with zero
// indication of which registered macro/extern/target was actually
// responsible, which gets genuinely painful to trace back once more than
// one or two of these exist in a real codebase. The original Error is
// preserved as `.cause`, not discarded -- nothing informative is lost,
// just given a clearer heading. Shared here (not duplicated per call
// site) since evaluate.js and emitters/base.js both already require this
// file for resolveExternForEvaluate/resolveExternForEmitter.
function withContext(context, fn) {
    try {
        return fn();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${context}: ${message}`, { cause: err });
    }
}

// A Node always has a string `.type` (see ast.js's own node-shape
// comment); a macro's multi-output result is a plain {fieldName: Node}
// object with no `.type` of its own -- same duck-typing convention
// expr.js's holeToNode already uses to tell a Node apart from a plain
// interpolated value.
function isNode(x) {
    return !!x && typeof x === "object" && typeof x.type === "string";
}

function isFnDefShape(def) {
    return !!def && typeof def === "object" && typeof def.name === "string" &&
        Array.isArray(def.params) && isNode(def.body);
}

// A macro's multi-output result, normalized to one shape regardless of
// which tier produced it: `letPrefix` is a (possibly empty) ORDERED list
// of {name, node} bindings that must be spliced in ONCE, shared, ahead
// of every field -- not per-field -- and `fields` is {name: Node}, each
// value typically just a bare var() reference into `letPrefix` (see
// toMacro below for why an AST-fn-def-shaped macro needs a non-empty
// letPrefix at all: cross3-in-fn-DSL-text returns `{ rx, ry, rz }` from
// a body that computes rx/ry/rz via its OWN "let" statements first, not
// as bare inline expressions). A plain-JS-function macro
// (dot3/cross3/normalize3/... in math/index.js) has no such separate
// prefix -- it returns a bare {field: Node} object directly, normalized
// here to letPrefix: [].
function makeMultiOutput(fields, letPrefix = []) {
    return { __exprforgeMultiOutput: true, letPrefix, fields };
}

function isMultiOutputResult(x) {
    return !!x && typeof x === "object" && x.__exprforgeMultiOutput === true;
}

// ---------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------

/**
 * Register a macro: a name usable inside fn()/expr() template text (and
 * in .expr files loaded via loadExpr()), inline-expanded at build time --
 * see this file's own header comment for what that guarantees (and the
 * one classic trade-off -- argument duplication -- that comes with it).
 *
 * `def` is either:
 *   - a plain JS function `(...argNodes) => Node | Record<string, Node>`
 *     -- exprforge/math's own dot3/len3/cross3/normalize3/safeDiv are
 *     registered exactly this way (see math/index.js) -- their existing
 *     signatures already match.
 *   - an AST function definition `{ name, params, body }` (e.g. straight
 *     out of fn`...`) -- sugar for wrapping it through toMacro() below.
 *
 * Throws if `name` collides with a built-in primitive or an
 * already-registered macro/extern -- names are a single shared
 * namespace, so a silent shadow never happens.
 *
 * Registers into this module's own default, process-wide registry
 * unless called as `session.loadMacro(...)` (see index.js's
 * createSession()), in which case it registers into that session's own,
 * independently-namespaced one instead -- see createRegistry() above.
 */
function loadMacro(name, def, registry = defaultRegistry) {
    assertNameAvailable("loadMacro", name, registry);
    if (typeof def === "function") {
        // def.length -- JS's own count of parameters before the first
        // one with a default value (or a rest parameter) -- is treated
        // as a MINIMUM, not an exact count: math/index.js's normalize3
        // is registered exactly this way and has three trailing default
        // parameters (fx/fy/fz), so normalize3.length is 3 even though
        // it's valid to call with 3-6 arguments. Anything at or above
        // this floor is JS's own call already; there's no upper bound to
        // enforce beyond what JS itself already does with extra
        // arguments (silently ignored, same as calling any other JS
        // function with too many).
        registry.macros.set(name, { arity: { min: def.length, max: null }, fn: def, alreadyExpanded: false });
        return;
    }
    if (isFnDefShape(def)) {
        registry.macros.set(name, toMacro(def, null, registry));
        return;
    }
    throw new Error(
        `loadMacro: "def" for "${name}" must be a function or an {name, params, body} AST function ` +
        `definition -- for a real per-target native call instead, use loadExtern()`,
    );
}

/**
 * Register an extern: a name usable the same way a macro is, but that
 * resolves to a real per-target native call instead of being expanded --
 * see this file's own header comment for the (caller-owned) risk that
 * comes with it.
 *
 * `def` is a plain mapping object, e.g.
 * `{ evaluate: (x) => ..., js: ([x]) => `myLib.f(${x})`, zig: ([x]) => ... }`,
 * plus an optional `arity` (a non-negative integer): unlike a macro,
 * there's no JS function signature to read a parameter count off of here
 * -- every per-target entry receives a single `argStrs` array, not N
 * positional Nodes, and `evaluate` isn't guaranteed to be present at all
 * -- so arity has to be stated explicitly if you want it checked.
 * Omitting it keeps today's behavior: no arg-count validation at all,
 * same as an unmapped call name never getting one either.
 *
 * Only the targets you provide a key for resolve; every other target
 * still throws "no mapping" for this name, same as an unmapped built-in
 * primitive would.
 *
 * Throws if `name` collides with a built-in primitive or an
 * already-registered macro/extern.
 */
function loadExtern(name, def, registry = defaultRegistry) {
    assertNameAvailable("loadExtern", name, registry);
    if (!def || typeof def !== "object") {
        throw new Error(
            `loadExtern: "def" for "${name}" must be a plain per-target mapping object, e.g. ` +
            `{ evaluate: (x) => ..., js: ([x]) => \`myLib.f(\${x})\`, ... }`,
        );
    }
    if (def.arity !== undefined && (!Number.isInteger(def.arity) || def.arity < 0)) {
        throw new Error(`loadExtern: "arity" for "${name}", if given, must be a non-negative integer`);
    }
    registry.externs.set(name, def);
}

function assertNameAvailable(fnName, name, registry) {
    if (typeof name !== "string" || !name) {
        throw new Error(`${fnName}: name must be a non-empty string`);
    }
    if (PRIMITIVE_NAMES.has(name)) {
        throw new Error(`${fnName}: "${name}" is already one of the built-in primitives -- choose a different name`);
    }
    if (registry.macros.has(name) || registry.externs.has(name)) {
        throw new Error(`${fnName}: "${name}" is already registered -- names must be unique across macros and externs`);
    }
}

function resolveExternForEvaluate(name, registry = defaultRegistry) {
    const entry = registry.externs.get(name);
    return entry && typeof entry.evaluate === "function" ? entry.evaluate : undefined;
}

function resolveExternForEmitter(name, lang, registry = defaultRegistry) {
    const entry = registry.externs.get(name);
    return entry && typeof entry[lang] === "function" ? entry[lang] : undefined;
}

// ---------------------------------------------------------------------
// Turning an AST function definition into a macro -- used by loadMacro()
// above for a {name, params, body} def, and by load-expr.js for every
// function defined in a .expr file (each becomes available as an inline
// macro to whatever's defined AFTER it in the same file -- see that
// file's own header comment).
// ---------------------------------------------------------------------

let gensymCounter = 0;

// Deep-substitutes every var(paramName) reference in `node` with the
// corresponding actual argument Node from `subst`, and alpha-renames
// every "let" this fn-def introduces to a fresh gensym'd name -- so
// invoking the SAME macro more than once in one consuming function (or
// nesting one inside another) never collides, either with each other or
// with the consuming function's own let names. Mirrors ast.js's
// collectLets/collectVarRefs's own node-type walk, and
// emitters/cobol.js's renameVarRefs -- same tree shape, same reason to
// walk it exhaustively.
function substituteAndRename(node, subst, renames) {
    switch (node.type) {
        case "num":
            return node;
        case "var": {
            if (node.name in subst) return subst[node.name];
            if (node.name in renames) return v(renames[node.name]);
            return node;
        }
        case "bin":
            return { ...node, left: substituteAndRename(node.left, subst, renames), right: substituteAndRename(node.right, subst, renames) };
        case "call":
            return { ...node, args: node.args.map((a) => substituteAndRename(a, subst, renames)) };
        case "cmp":
            return { ...node, left: substituteAndRename(node.left, subst, renames), right: substituteAndRename(node.right, subst, renames) };
        case "select":
            return {
                ...node,
                cond: substituteAndRename(node.cond, subst, renames),
                then: substituteAndRename(node.then, subst, renames),
                else: substituteAndRename(node.else, subst, renames),
            };
        case "let": {
            // MACRO_GENSYM_PREFIX ("efMacro_", defined in ast.js -- see
            // its own comment there for why it lives there and not here)
            // starts with a letter, not "_" -- confirmed against a real
            // Fortran compiler ("Invalid character in name") that a
            // leading underscore isn't a valid identifier start there,
            // same finding math/index.js's normalize3 already documents
            // (and follows) for its own gensym'd binding name; this one
            // missed it on the first pass, caught by actually emitting a
            // macro-with-an-internal-let to Fortran and inspecting the
            // declared name, not just running evaluate() against it (see
            // test/macros.test.js).
            const fresh = `${MACRO_GENSYM_PREFIX}${node.name}_${gensymCounter++}`;
            const value = substituteAndRename(node.value, subst, renames);
            const body = substituteAndRename(node.body, subst, { ...renames, [node.name]: fresh });
            return letIn(fresh, value, body);
        }
        case "outputs": {
            const fields = {};
            for (const [name, fieldValue] of Object.entries(node.fields)) {
                fields[name] = substituteAndRename(fieldValue, subst, renames);
            }
            return { ...node, fields };
        }
        default:
            throw new Error(
                `macros: internal error -- a "${node.type}" node reached substitution; expandMacros() should ` +
                `have already resolved it (macro calls/field access) before this ever runs`,
            );
    }
}

/**
 * Wraps an AST function definition (e.g. straight out of fn`...`) as a
 * macro: `(...argNodes) => Node | Record<string, Node>`, substituting
 * `fnDef.params` with the actual argument Nodes and alpha-renaming every
 * one of `fnDef`'s own let-bindings fresh on each invocation (see
 * substituteAndRename above).
 *
 * `fnDef.body` is expanded against `extraRegistry` FIRST, once, here at
 * registration time -- not deferred to each invocation -- which is what
 * makes recursion structurally impossible rather than merely
 * discouraged: fnDef isn't resolvable through `extraRegistry` (or the
 * global macro registry) yet while its own body is being expanded
 * (load-expr.js only adds it AFTER this returns), so it can never
 * reference itself, directly or transitively through another
 * not-yet-defined macro.
 *
 * `alreadyExpanded: true` on the returned entry matters beyond that:
 * whatever's still an unresolved "call" node in the pre-expanded body at
 * this point (a genuine typo, a not-yet-registered forward/self
 * reference) is meant to STAY unresolved forever, even after that name
 * eventually gets registered -- expandMacros() must never re-examine an
 * already-expanded macro's own output against the (by-then-different)
 * live registry, or a forward/self reference could silently start
 * "working" once its target happened to get registered, which is
 * exactly the declared-order guarantee this whole design depends on. A
 * plain-JS-function macro (loadMacro(name, someFunction)) has no such
 * pre-expansion step -- it runs fresh on every call and its result CAN
 * legitimately reference other macros, so `alreadyExpanded: false` there
 * means expandMacros() still walks its result once.
 */
function toMacro(fnDef, extraRegistry = null, registry = defaultRegistry) {
    const resolvedBody = expandBody(fnDef.body, { extraRegistry, aliases: new Map(), registry });
    return {
        // Exact, unlike a plain-JS macro's min-only arity below -- fn.js's
        // own grammar has no default-parameter syntax, so every AST
        // fn-def's param count is unambiguous.
        arity: { min: fnDef.params.length, max: fnDef.params.length },
        alreadyExpanded: true,
        fn: (...argNodes) => {
            const subst = {};
            fnDef.params.forEach((p, i) => {
                subst[p] = argNodes[i];
            });
            const renamed = substituteAndRename(resolvedBody, subst, {});
            // collectLets separates ANY leading let-chain (0, 1, or many
            // levels -- fn`...`'s own grammar always produces a
            // let-chain wrapping either a plain expression or an
            // outputs() -- see fn.js) from what it ultimately returns.
            // Every let name in `bindings` was already gensym'd uniquely
            // for THIS call by substituteAndRename above, so it's always
            // safe to splice `bindings` back in verbatim, however this
            // result ends up being used.
            const { bindings, body } = collectLets(renamed);
            if (body.type !== "outputs") return renamed; // single value, unchanged
            // Multi-output: `bindings` becomes the shared letPrefix
            // (e.g. cross3-in-fn-DSL-text's own "let rx = ...; let ry =
            // ...; let rz = ...;"), and each outputs() field -- almost
            // always just a bare var() reference into `bindings` -- is
            // exactly the value expandBody needs per field. See
            // makeMultiOutput's own comment for why this split matters.
            return makeMultiOutput(body.fields, bindings);
        },
    };
}

// ---------------------------------------------------------------------
// Expansion -- eliminates every macro "call" and "field" node from a
// tree, leaving only built-in primitive calls, extern calls (both left
// as plain "call" nodes -- resolved later, by evaluate()/an emitter's
// own `calls` table), and ast.js's other ordinary node types.
// ---------------------------------------------------------------------

function lookupMacro(name, ctx) {
    return (ctx.extraRegistry && ctx.extraRegistry.get(name)) || ctx.registry.macros.get(name);
}

// Shared by macro calls (`arity` always set -- see loadMacro/toMacro
// above) and extern calls (`arity` only set when the caller opted in via
// loadExtern's own optional `arity` field) -- `arity` of `null`/
// `undefined` means "not checked here", not "zero arguments".
// `max: null` means "no upper bound" (a plain-JS macro's own floor, via
// def.length -- see loadMacro).
function checkArity(name, arity, argCount) {
    if (!arity) return;
    const { min, max } = arity;
    if (argCount < min || (max !== null && argCount > max)) {
        const expected = max === null ? `at least ${min}` : min === max ? `${min}` : `${min}-${max}`;
        throw new Error(`expandMacros: "${name}" expects ${expected} argument(s), got ${argCount}`);
    }
}

// Extern arity is opt-in (loadExtern's own `arity` field) and checked
// here -- the one place every "call" node, macro or not, already passes
// through during expansion -- rather than deferred to evaluate()/an
// emitter, which would report it (if at all) as a confusing runtime
// crash inside whatever an extern's own per-target template does with a
// missing/extra argString, not a clear arg-count error.
function checkExternArity(name, argCount, registry) {
    const entry = registry.externs.get(name);
    if (!entry || entry.arity === undefined) return;
    checkArity(name, { min: entry.arity, max: entry.arity }, argCount);
}

// Unlike extern arity (opt-in) and macro arity (declared per-registration),
// every built-in primitive's arity is fixed and already known (see
// primitives.js) -- checked unconditionally here, the same tier as
// checkUnboundVars: a real correctness bug, not a style preference (a
// wrong arg count used to silently emit e.g. "Math.sqrt(a)" for
// call("sqrt", a, b, c) -- args b/c just silently dropped, not caught
// anywhere, in any target, until this existed). Deliberately checked
// here, not duplicated separately in evaluate.js/emitters/base.js: every
// real entry point (evaluate(), every emitter's emitFunction() --
// including the "expr" printer, which stays lenient about UNMAPPED
// names but was never meant to accept a structurally malformed call
// either) already runs expandMacros() first, so one check here covers
// all of them.
function checkPrimitiveArity(name, argCount) {
    if (!(name in PRIMITIVE_ARITY)) return;
    checkArity(name, { min: PRIMITIVE_ARITY[name], max: PRIMITIVE_ARITY[name] }, argCount);
}

// Resolves ONE call node against the macro registry, or returns
// undefined if `callNode.name` isn't a macro at all (a built-in
// primitive, an extern, or simply unmapped -- none of those are this
// function's concern; the caller leaves the node as-is).
function tryResolveMacroCall(callNode, ctx) {
    const entry = lookupMacro(callNode.name, ctx);
    if (!entry) return undefined;

    // An AST-fn-def-shaped macro's own self/forward references are
    // already ruled out structurally, by registration ordering (see
    // toMacro's own comment) -- but a plain-JS-function macro's RESULT
    // gets re-walked below (a fresh call every time, so it CAN
    // legitimately reference some other, unrelated macro), and if that
    // result calls right back into THIS SAME name -- directly, or
    // through a cycle of several plain-function macros -- that walk
    // would recurse without ever making progress. `ctx.expanding` tracks
    // "names currently being resolved on the path from here to the
    // result I'm walking" -- set only around that one re-walk below, so
    // using the SAME macro twice in separate, independent positions
    // (e.g. sqrt(x) + foo(a) + foo(b)) is unaffected; only a name
    // reappearing inside its OWN just-computed result trips this.
    // Deliberately unconditional, even for a result that would
    // eventually reach a real base case if it were allowed to keep
    // going (JS itself could express that) -- this library's own "no
    // recursion" guarantee (see the README) doesn't carve out an
    // exception for the convergent case, so neither does this.
    const expanding = ctx.expanding || new Set();
    if (expanding.has(callNode.name)) {
        throw new Error(
            `expandMacros: "${callNode.name}" can't call itself, directly or through a cycle -- macros are ` +
            `inline-expanded, not real function calls, so a self/cyclic reference would have to expand forever`,
        );
    }

    const expandedArgs = callNode.args.map((a) => expandExpr(a, ctx));
    checkArity(callNode.name, entry.arity, expandedArgs.length);

    const result = withContext(`expandMacros: while expanding macro "${callNode.name}"`, () => entry.fn(...expandedArgs));

    // An AST-fn-def-shaped macro (toMacro, above) is already fully
    // resolved once, at registration time -- its result must be used
    // VERBATIM, never re-walked against the (by-now-different) live
    // registry. See toMacro's own comment on `alreadyExpanded` for why
    // that specifically matters, not just as an optimization.
    if (entry.alreadyExpanded) {
        if (isNode(result)) return result;
        if (isMultiOutputResult(result)) return result;
        throw new Error(`expandMacros: "${callNode.name}" must return an AST Node or a plain object of named Nodes, got ${typeof result}`);
    }

    const expandingCtx = { ...ctx, expanding: new Set(expanding).add(callNode.name) };
    if (isNode(result)) return expandExpr(result, expandingCtx);
    // A plain-JS-function macro (dot3/cross3/normalize3/... in
    // math/index.js, or a caller's own) returns a BARE {field: Node}
    // object -- normalized here to makeMultiOutput's shape with an
    // empty letPrefix (nothing shared to splice ahead of the fields;
    // any internal let a field needs, it carries in its own subtree --
    // see normalize3's own comment on why that's still safe).
    const multi = isMultiOutputResult(result) ? result : (result && typeof result === "object" ? makeMultiOutput(result) : null);
    if (multi) {
        const expandedFields = {};
        for (const [field, fieldNode] of Object.entries(multi.fields)) {
            if (!isNode(fieldNode)) {
                throw new Error(`expandMacros: "${callNode.name}"'s "${field}" field must be an AST Node, got ${typeof fieldNode}`);
            }
            expandedFields[field] = expandExpr(fieldNode, expandingCtx);
        }
        const expandedPrefix = multi.letPrefix.map(({ name, node }) => ({ name, node: expandExpr(node, expandingCtx) }));
        return makeMultiOutput(expandedFields, expandedPrefix);
    }
    throw new Error(`expandMacros: "${callNode.name}" must return an AST Node or a plain object of named Nodes, got ${typeof result}`);
}

// Expands one expression-position Node: resolves any macro call anywhere
// in it (recursively) and rewrites "field" access into a plain variable
// reference, using `ctx.aliases` (populated by expandBody below as it
// walks past each multi-output "let"). A macro call that resolves to a
// multi-output record is only valid as a "let"'s direct value (see
// expandBody) -- reaching one here, nested inside a larger expression,
// is a clear user error, not resolved silently.
function expandExpr(node, ctx) {
    switch (node.type) {
        case "num":
            return node;
        case "var": {
            // A bare reference to a name that's ONLY ever a multi-output
            // alias prefix (see expandBody's own "let" case) is a
            // near-certain mistake: that name was never actually bound to
            // a value, only used to build its fields' flat names (e.g.
            // "z" in "let z = someMultiOutputMacro(...); return z;" --
            // only "z__x"/"z__y" etc. really exist). Left unchecked, this
            // survives as an ordinary-looking "var" node and only fails
            // later, at checkUnboundVars, with a message that can't know
            // WHY the name isn't declared ("never declared" reads as "you
            // forgot the let", when you very much did write one) --
            // caught here instead, with the actual reason and the fields
            // that ARE available.
            const aliasMap = ctx.aliases.get(node.name);
            if (aliasMap) {
                throw new Error(
                    `expandMacros: "${node.name}" is bound to a multi-output macro result (fields: ` +
                    `${Object.keys(aliasMap).join(", ")}) -- reference a field directly (e.g. ` +
                    `"${node.name}.${Object.keys(aliasMap)[0]}"), not the bare name`,
                );
            }
            return node;
        }
        case "field": {
            if (node.target.type !== "var") {
                throw new Error(
                    `expandMacros: "." field access is only supported directly on a variable bound to a ` +
                    `multi-output macro result (e.g. "b.rx"), not on a "${node.target.type}"`,
                );
            }
            const aliasMap = ctx.aliases.get(node.target.name);
            if (!aliasMap || !(node.field in aliasMap)) {
                const known = aliasMap ? ` (has: ${Object.keys(aliasMap).join(", ")})` : "";
                throw new Error(
                    `expandMacros: "${node.target.name}.${node.field}" -- "${node.target.name}" isn't bound ` +
                    `to a multi-output macro result with a "${node.field}" field${known}`,
                );
            }
            return v(aliasMap[node.field]);
        }
        case "bin":
            return { ...node, left: expandExpr(node.left, ctx), right: expandExpr(node.right, ctx) };
        case "cmp":
            return { ...node, left: expandExpr(node.left, ctx), right: expandExpr(node.right, ctx) };
        case "select":
            return {
                ...node,
                cond: expandExpr(node.cond, ctx),
                then: expandExpr(node.then, ctx),
                else: expandExpr(node.else, ctx),
            };
        case "let":
            // A "let" nested inside an expression position (spliced in
            // by a macro's own return value, e.g. normalize3's internal
            // length binding -- never authored directly by fn/expr text,
            // which only ever has "let" at statement position, see
            // expandBody) -- its value can't itself be ANOTHER
            // multi-output macro call (nothing in this codebase's own
            // macros does that, and there's no field-access syntax to
            // destructure it if it did), so this simpler branch is
            // sufficient; expandBody is the one that needs the
            // multi-output special case.
            return letIn(node.name, expandExpr(node.value, ctx), expandExpr(node.body, ctx));
        case "call": {
            const resolved = tryResolveMacroCall(node, ctx);
            if (resolved === undefined) {
                // Not a macro -- built-in primitive, extern, or simply
                // unmapped; leave the call itself alone, just expand its
                // args in case one of THEM has a macro call/field access
                // inside it. A primitive's fixed arity, or an extern's
                // own (opt-in) arity, is checked here too -- this is the
                // one place every "call" node already passes through,
                // whether or not it ends up being a macro.
                const args = node.args.map((a) => expandExpr(a, ctx));
                checkPrimitiveArity(node.name, args.length);
                checkExternArity(node.name, args.length, ctx.registry);
                return call(node.name, ...args);
            }
            if (isMultiOutputResult(resolved)) {
                throw new Error(
                    `expandMacros: "${node.name}(...)" returns multiple named outputs -- bind it with ` +
                    `"let name = ${node.name}(...);" first, then access fields as name.field, rather than ` +
                    `using it directly inside another expression`,
                );
            }
            return resolved;
        }
        case "outputs": {
            // outputs() is normally only ever a function's top-level body
            // (see ast.js), but a macro's OWN return value could in
            // principle be built with one -- handled here defensively
            // rather than assumed unreachable.
            const fields = {};
            for (const [name, fieldValue] of Object.entries(node.fields)) fields[name] = expandExpr(fieldValue, ctx);
            return { ...node, fields };
        }
        default:
            throw new Error(`expandMacros: cannot expand unknown node type "${node.type}"`);
    }
}

// Expands a function BODY -- the pre-collectLets nested let-chain/outputs/
// expression shape fn()/expr() produce. The one thing expandExpr alone
// can't do: when a "let"'s value is itself a call to a MULTI-output
// macro, that one let has to become several flat lets (one per field,
// named "letName__field"), with every later "name.field" reference in
// `node.body` rewritten to the matching flat name -- see ctx.aliases,
// populated here and consumed by expandExpr's "field" case above.
function expandBody(node, ctx) {
    if (node.type === "let") {
        if (node.value.type === "call") {
            const resolved = tryResolveMacroCall(node.value, ctx);
            if (resolved !== undefined && isMultiOutputResult(resolved)) {
                const flatNames = {};
                for (const field of Object.keys(resolved.fields)) flatNames[field] = `${node.name}__${field}`;
                const nextAliases = new Map(ctx.aliases);
                nextAliases.set(node.name, flatNames);
                let restBody = expandBody(node.body, { ...ctx, aliases: nextAliases });
                // Per-field flat lets first (innermost, closest to
                // restBody) -- each just aliases one of `resolved`'s
                // fields under its caller-visible flat name...
                const fieldEntries = Object.entries(resolved.fields);
                for (let i = fieldEntries.length - 1; i >= 0; i--) {
                    const [field, valueNode] = fieldEntries[i];
                    restBody = letIn(flatNames[field], valueNode, restBody);
                }
                // ...then the SHARED letPrefix (e.g. cross3-in-fn-DSL-
                // text's own "let rx = ...; let ry = ...; let rz = ...;"
                // -- see makeMultiOutput's comment) wraps all of that
                // ONCE, outermost -- never duplicated per field. Every
                // name in it is already gensym'd unique for this one
                // call (see toMacro), so nesting order here doesn't
                // matter for correctness (collectLets hoists everything
                // into one flat list regardless -- see its own comment
                // in ast.js), only for readability.
                for (let i = resolved.letPrefix.length - 1; i >= 0; i--) {
                    const { name, node: valueNode } = resolved.letPrefix[i];
                    restBody = letIn(name, valueNode, restBody);
                }
                return restBody;
            }
            if (resolved !== undefined) {
                // Single-value macro call -- splice directly as this
                // let's value, already fully expanded.
                return letIn(node.name, resolved, expandBody(node.body, ctx));
            }
        }
        return letIn(node.name, expandExpr(node.value, ctx), expandBody(node.body, ctx));
    }
    if (node.type === "outputs") {
        const fields = {};
        for (const [name, fieldValue] of Object.entries(node.fields)) fields[name] = expandExpr(fieldValue, ctx);
        return { ...node, fields };
    }
    return expandExpr(node, ctx);
}

/**
 * Eliminates every macro "call" and every "field" node from `fnOrNode` --
 * the one required step between parsing (fn()/expr()/loadExpr()) and
 * anything that consumes a tree directly (checkUnboundVars, evaluate(),
 * any emitter's emitFunction()) -- all three of those call this
 * unconditionally themselves, first, so ordinary callers never need to
 * call it by hand. Accepts either a bare Node or a full
 * {name, params, body} -- same dual shape fn() itself produces -- and
 * returns the same shape back. `extraRegistry` (a Map<name, {arity, fn,
 * alreadyExpanded}>) is load-expr.js's own hook for "functions defined
 * earlier in this same .expr file" -- see that file's header comment;
 * ordinary callers never need to pass it. `registry` (a {macros, externs}
 * pair, see createRegistry() above) defaults to this file's own module-
 * level registry -- pass a session's own (see index.js's createSession())
 * to resolve against that session's macros/externs instead of the
 * process-wide default ones.
 */
function expandMacros(fnOrNode, extraRegistry = null, registry = defaultRegistry) {
    // Every real caller (evaluate(), every emitter's emitFunction()) runs
    // this first, unconditionally, before touching fnOrNode.type/.name/
    // .body itself -- so this is the one place positioned to catch a
    // caller passing something that isn't actually a Node or a
    // {name, params, body} at all (undefined, null, a typo'd lookup that
    // silently evaluated to undefined, ...) with ONE clear message,
    // instead of letting it fall through to expandBody below and crash
    // with a raw "Cannot read properties of undefined (reading 'type')"
    // several frames later -- or, worse, having emitMany() (see index.js)
    // catch and report that same confusing crash once per language,
    // 18 near-identical unhelpful errors instead of one. Concretely
    // motivated by the "macro"-marked definitions loadExprSource() never
    // returns (see load-expr.js) -- a caller looking up a macro-only name
    // in the returned object gets `undefined` back, and previously the
    // very next thing that happened with it was exactly this crash.
    if (!isFnDefShape(fnOrNode) && !isNode(fnOrNode)) {
        throw new Error(
            `expandMacros: expected an AST Node ({type: ...}) or a {name, params, body} function ` +
            `definition, got ${fnOrNode === null ? "null" : typeof fnOrNode} -- if this came from a ` +
            `loadExprSource()/loadExpr() result object, double check the definition you're looking up was ` +
            `actually marked "fn" (exported), not "macro" (private -- never included in what that call returns)`,
        );
    }
    const ctx = { extraRegistry, aliases: new Map(), registry };
    if (isFnDefShape(fnOrNode)) {
        return { name: fnOrNode.name, params: fnOrNode.params, body: expandBody(fnOrNode.body, ctx) };
    }
    return expandBody(fnOrNode, ctx);
}

module.exports = {
    loadMacro,
    loadExtern,
    expandMacros,
    resolveExternForEvaluate,
    resolveExternForEmitter,
    toMacro,
    withContext,
    createRegistry,
};
