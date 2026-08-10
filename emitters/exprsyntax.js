// exprforge/emitters/exprsyntax.js
//
// Prints an AST back out as fn`...`/expr`...`-compatible source text --
// the reverse direction of expr.js/fn.js. Not a third-party language:
// there's no external compiler/interpreter to run this output through,
// so it's verified by round-trip instead (emit -> reparse via fn() ->
// deepStrictEqual the original, see test/exprsyntax-emitter.test.js).
// Registered as a real target anyway (emitters.expr) since fn/expr
// syntax is a real, standalone, human-pasteable output format in its
// own right, not just a test fixture.
//
// "call" is overridden wholesale rather than populated via a `calls`
// table: every intrinsic passes through uniformly as `name(args...)`
// except pow, which recovers fn/expr's own `^` sugar -- both forms
// lower back to the identical call("pow", ...) node (see expr.js's
// grammar comment on rule 2), so this is a readability choice, not a
// correctness one. A side effect: this is the one emitter that never
// needs a table update when a new intrinsic is added anywhere else in
// the project.
const Emitter = require("./base.js");

class ExprSyntaxEmitter extends Emitter {
    emitExpr(node) {
        if (node.type === "call" && node.name === "pow" && node.args.length === 2) {
            const [base, exponent] = node.args.map((a) => this.emitExpr(a));
            return `(${base}^${exponent})`;
        }
        if (node.type === "call") {
            const args = node.args.map((a) => this.emitExpr(a));
            return `${node.name}(${args.join(", ")})`;
        }
        return super.emitExpr(node);
    }
}

function letLines(letBindings) {
    return letBindings.map(({ name, valueStr }) => `let ${name} = ${valueStr};`);
}

const emitter = new ExprSyntaxEmitter({
    ext: "fn",
    // fn/expr accepts JS-style numeric literal syntax directly -- it's
    // literally the same NUMBER lexing rule (see expr.js's tokenizer).
    formatNumber: (v) => String(v),
    // base.js's default _defaultSelect wraps just the comparison in its
    // own parens ("((L op R) ? then : else)") -- fn/expr's ternary
    // grammar has no parenthesized-COMPARISON form (see expr.js's
    // grammar comment: `ternary := additive compOp additive "?" ...`),
    // so "(L op R)" alone would try to parse as a complete, paren-
    // wrapped ternary condition with no "?" in sight and hit the parser's
    // own "comparison must be used as a ternary condition" error. This
    // wraps the WHOLE ternary in one outer paren pair instead -- still a
    // valid `primary := ... | "(" expression ")" | ...`, and unlike the
    // unwrapped form, safe to embed as a sub-expression anywhere (e.g.
    // `crossX / (rLen > eps ? rLen : 1)`) without the surrounding
    // operator's precedence reaching into the ternary's own condition.
    emitSelect: function (condNode, thenStr, elseStr) {
        const L = this.emitExpr(condNode.left);
        const R = this.emitExpr(condNode.right);
        return `(${L} ${condNode.op} ${R} ? ${thenStr} : ${elseStr})`;
    },
    // Output is bare fn/expr source text -- no JS wrapper/boilerplate.
    // That's both the most direct thing to paste into a real
    // `` fn`...` `` call, and exactly what the round-trip test reparses
    // with zero unwrapping first.
    //
    // ALWAYS includes the "name(params):" signature line -- every other
    // emitter's formatFunction includes the full declaration per
    // base.js's own documented contract ("Full source text for one
    // function, including any language-specific signature/type/wrapper
    // syntax"); this was the one target that didn't, dropping fn.name/
    // fn.params on the floor entirely. That wasn't a deliberate
    // minimalism choice, it was a leftover from before fn`...`'s
    // optional signature line (see fn.js) existed at all -- without it,
    // reparsing this emitter's own output via fn() could only ever
    // recover a bare Node, never a runnable {name, params, body}, unlike
    // literally every other target's output being immediately usable.
    // Body lines (every let, the return) are indented 2 spaces deeper
    // than the signature line itself -- a Python-esque pretty-print
    // convention, not something the parser requires (whitespace is
    // insignificant to fn's grammar; see expr.js's tokenizer). Applied
    // here, not just in hand-written docs/examples, so every printed
    // AST comes out reading the same way automatically.
    formatFunction: (fn, bodyStr, letBindings = []) => {
        const body = [...letLines(letBindings), `return ${bodyStr};`].map((line) => `  ${line}`);
        return [`${fn.name}(${fn.params.join(", ")}):`, ...body].join("\n") + "\n";
    },
    // Each output field gets its own line (4 spaces -- one level deeper
    // than "return {" itself, which sits at the usual 2), rather than
    // cramming every field onto one line -- found the gap by comparing
    // this against a hand-formatted multi-output example and noticing
    // the printer didn't follow its own convention once a suite had
    // more than a couple of fields (a real, wide, 5-output formula made
    // this one very long line instead of something readable).
    formatSuite: (fn, outputStrs, letBindings = []) => {
        const entries = Object.entries(outputStrs);
        const fieldLines = entries.map(([name, valueStr], i) => {
            const comma = i < entries.length - 1 ? "," : "";
            return `    ${name}: ${valueStr}${comma}`;
        });
        const lines = [
            `${fn.name}(${fn.params.join(", ")}):`,
            ...letLines(letBindings).map((line) => `  ${line}`),
            "  return {",
            ...fieldLines,
            "  };",
        ];
        return lines.join("\n") + "\n";
    },
});

module.exports = emitter;
