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
//   formatFunction — (fn: {name, params, body}, bodyStr: string) => string
//                    Full source text for one function, including any
//                    language-specific signature/type/wrapper syntax.

class Emitter {
    constructor(config) {
        this.ext = config.ext;
        this.formatNumber = config.formatNumber;
        this.calls = config.calls || {};
        this.formatFunctionImpl = config.formatFunction;
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
            default: {
                throw new Error(`emitter for .${this.ext}: unknown node type "${node.type}"`);
            }
        }
    }

    emitFunction(fn) {
        const bodyStr = this.emitExpr(fn.body);
        return this.formatFunctionImpl(fn, bodyStr);
    }
}

module.exports = Emitter;
