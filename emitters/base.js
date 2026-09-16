// exprforge/emitters/base.js
//
// A language plugin is just a config object passed to `new Emitter(config)`.
// This is the extension point: adding a new language means writing ONE new
// file that builds an Emitter, not touching this file or any other emitter.
//
// config shape:
//   ext            — output file extension, e.g. "rs"
//   formatNumber   — (value: number) => string        (literal syntax)
//   calls          — { [mathFnName]: (argStrs: string[]) => string }
//                    Covers BOTH "direct" (sqrt -> `sqrt(${x})`) and
//                    "expanded" (sign -> ternary expression) cases, and
//                    postfix/method-call languages like Rust (`${x}.sqrt()`),
//                    uniformly — it's just a string template either way.
//   formatFunction — (fn: {name, params, body}, bodyStr: string, letBindings: {name, valueStr}[]) => string
//                    Full source text for one function, including any
//                    language-specific signature/type/wrapper syntax.
//                    letBindings is [] for let-free expressions.
//   emitSelect     — optional override: (condNode, thenStr, elseStr) => string
//                    Default is a ternary; QB64 has no ternary and overrides
//                    this with the equivalent arithmetic expression instead.
//   formatSuite    — (fn: {name, params}, outputStrs: {name: string}, letBindings) => string
//                    Only needed for targets that support multi-output
//                    suites (see ast.js's outputs()). Renders whatever
//                    multi-value idiom the language has. Required if any
//                    suite gets emitted through this emitter; omitted
//                    otherwise.

const { collectLets, checkUnboundVars } = require("../ast.js");
const { expandMacros, resolveExternForEmitter, withContext } = require("../macros.js");

class Emitter {
    constructor(config) {
        this.ext = config.ext;
        this.formatNumber = config.formatNumber;
        this.calls = config.calls || {};
        this.formatFunctionImpl = config.formatFunction;
        this.formatSuiteImpl = config.formatSuite || null;
        this.emitSelectImpl = config.emitSelect
            ? config.emitSelect.bind(this)
            : this._defaultSelect.bind(this);
        // No sane language-agnostic default exists (every target's array
        // subscript syntax, and whether it needs an index-origin
        // translation, differs -- see docs/array-index-primitives.md).
        // null here means emitExpr's "index" case throws a clear
        // "not supported for this target" error, same shape formatSuite
        // already uses for multi-output.
        this.emitIndexImpl = config.emitIndex
            ? config.emitIndex.bind(this)
            : null;
        // Optional, opt-in-only (see emitFunction's `addTypeGuards`):
        // (paramName, fnName) => one line of runtime-guard code asserting
        // that array-typed parameter actually holds an array-shaped value
        // at the call boundary. Only meaningful for targets with no
        // compile-time enforcement of that -- present on the
        // dynamically-typed emitters (js/ts/python/php/lua/perl/scheme/
        // julia), absent (null) everywhere else, since every compiled
        // target already gets this for free from its own compiler. See
        // docs/runtime-type-guards.md.
        this.typeGuardImpl = config.typeGuard || null;
    }

    // Default ternary (cond ? a : b) — correct for JS, C, and Java, which
    // all share this syntax. Go has no ternary at all (and `if` is a
    // statement, not an expression); Rust uses `if`-as-expression instead
    // of ?:; QB64 has no conditional expression syntax whatsoever. Those
    // three override emitSelect with their own syntax — see their files.
    _defaultSelect(condNode, thenStr, elseStr) {
        const L = this.emitExpr(condNode.left);
        const R = this.emitExpr(condNode.right);
        return `((${L} ${condNode.op} ${R}) ? ${thenStr} : ${elseStr})`;
    }

    emitExpr(node) {
        switch (node.type) {
            case "num": {
                return this.formatNumber(node.value);
            }
            case "var": {
                return node.name;
            }
            case "bin": {
                return `(${this.emitExpr(node.left)} ${node.op} ${this.emitExpr(node.right)})`;
            }
            case "call": {
                const args = node.args.map((a) => this.emitExpr(a));
                // `this.lang` is injected by emitters/registry.js (the
                // registered key, e.g. "js"/"cobol") -- not set for an
                // Emitter built standalone outside the registry, in which
                // case an extern simply never resolves here, same as an
                // unmapped name.
                const builtin = this.calls[node.name];
                const template = builtin || (this.lang && resolveExternForEmitter(node.name, this.lang, this._registry));
                if (!template) {
                    throw new Error(`emitter for .${this.ext}: no mapping for Math function "${node.name}"`);
                }
                // Only an extern's own per-target template is caller-
                // supplied code that could have a bug worth attributing
                // -- a built-in primitive's template is exprforge's own,
                // not worth wrapping.
                return builtin
                    ? template(args)
                    : withContext(`emitter for .${this.ext}: while emitting extern "${node.name}"`, () => template(args));
            }
            case "select": {
                const thenStr = this.emitExpr(node.then);
                const elseStr = this.emitExpr(node.else);
                return this.emitSelectImpl(node.cond, thenStr, elseStr);
            }
            case "cmp": {
                // cmp only ever appears as a select's cond, consumed directly
                // by emitSelectImpl above — it never reaches emitExpr in a
                // well-formed tree. Landing here means a cmp node was used
                // somewhere else (e.g. as a plain operand), which isn't
                // supported: cmp isn't a general boolean expression.
                throw new Error(`emitter for .${this.ext}: "cmp" is only valid inside a select() — got it elsewhere`);
            }
            case "index": {
                if (!this.emitIndexImpl) {
                    throw new Error(`emitter for .${this.ext}: array indexing not supported for this target yet`);
                }
                return this.emitIndexImpl(node.target, node.at);
            }
            default: {
                throw new Error(`emitter for .${this.ext}: unknown node type "${node.type}"`);
            }
        }
    }

    // `registry` (see macros.js's createRegistry()) defaults to the
    // process-wide default when omitted -- pass a session's own (see
    // index.js's createSession()) to resolve macros/externs against that
    // session instead. Stashed on `this` for emitExpr's "call" case to
    // read, same instance-state pattern emitters/cobol.js's own
    // `this._pool` already established.
    //
    // `opts.addTypeGuards` (default false): opt-in only, see
    // docs/runtime-type-guards.md for the full rationale. When true AND
    // this target declares a `typeGuard` template (see the constructor)
    // AND `fn.paramTypes` actually has an array-typed entry, one runtime
    // guard line per array-typed parameter is generated and spliced into
    // the output by formatFunctionImpl/formatSuiteImpl (both receive it
    // as a 4th argument, `guardLines: string[]`, defaulting to `[]` for
    // every target that doesn't consume it -- an extra unused argument
    // is harmless in JS, so the ~10 compiled-language emitters (which
    // never declare `typeGuard` and so never receive a non-empty array
    // here) don't need any change at all to stay correct). No effect
    // whatsoever for a target with no `typeGuard` template (every
    // compiled target already gets this from its own compiler) or a
    // call with no array-typed parameter.
    emitFunction(fn, registry = undefined, opts = {}) {
        this._registry = registry;
        // Resolves every macro call and field() access into plain
        // arithmetic first -- see macros.js's own header comment. Must
        // run before checkUnboundVars: expansion is what introduces the
        // flattened let-bindings a multi-output macro's fields become,
        // and eliminates "field" nodes, which checkUnboundVars/
        // collectLets don't know how to walk.
        fn = expandMacros(fn, null, registry);
        // Checked once, before any per-target work starts -- see
        // checkUnboundVars's own comment in ast.js for why this matters
        // (a typo'd/forgotten identifier used to silently succeed here,
        // for every target, with no error at all).
        checkUnboundVars(fn);
        const guardLines =
            opts.addTypeGuards && this.typeGuardImpl && fn.paramTypes
                ? Object.keys(fn.paramTypes)
                      .filter((p) => fn.paramTypes[p] === "number[]")
                      .map((p) => this.typeGuardImpl(p, fn.name))
                : [];
        const { bindings, body } = collectLets(fn.body);
        const letBindings = bindings.map(({ name, node }) => ({
            name,
            valueStr: this.emitExpr(node),
        }));
        if (body.type === "outputs") {
            if (!this.formatSuiteImpl) {
                throw new Error(`emitter for .${this.ext}: no formatSuite configured — multi-output suites aren't supported for this target yet`);
            }
            const outputStrs = {};
            for (const [name, node] of Object.entries(body.fields)) {
                outputStrs[name] = this.emitExpr(node);
            }
            return this.formatSuiteImpl(fn, outputStrs, letBindings, guardLines);
        }
        const bodyStr = this.emitExpr(body);
        return this.formatFunctionImpl(fn, bodyStr, letBindings, guardLines);
    }
}

module.exports = Emitter;
