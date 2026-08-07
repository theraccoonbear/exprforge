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

const { collectLets } = require("../ast.js");

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
                const template = this.calls[node.name];
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
