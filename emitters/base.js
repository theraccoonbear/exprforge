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
const { expandMacros, resolveExternForEmitter } = require("../macros.js");

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
                const template = this.calls[node.name] || (this.lang && resolveExternForEmitter(node.name, this.lang));
                if (!template) {
                    throw new Error(`emitter for .${this.ext}: no mapping for Math function "${node.name}"`);
                }
                return template(args);
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
            default: {
                throw new Error(`emitter for .${this.ext}: unknown node type "${node.type}"`);
            }
        }
    }

    emitFunction(fn) {
        // Resolves every macro call and field() access into plain
        // arithmetic first -- see macros.js's own header comment. Must
        // run before checkUnboundVars: expansion is what introduces the
        // flattened let-bindings a multi-output macro's fields become,
        // and eliminates "field" nodes, which checkUnboundVars/
        // collectLets don't know how to walk.
        fn = expandMacros(fn);
        // Checked once, before any per-target work starts -- see
        // checkUnboundVars's own comment in ast.js for why this matters
        // (a typo'd/forgotten identifier used to silently succeed here,
        // for every target, with no error at all).
        checkUnboundVars(fn);
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
            return this.formatSuiteImpl(fn, outputStrs, letBindings);
        }
        const bodyStr = this.emitExpr(body);
        return this.formatFunctionImpl(fn, bodyStr, letBindings);
    }
}

module.exports = Emitter;
