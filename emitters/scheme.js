// exprforge/emitters/scheme.js
//
// Targets Guile (R7RS-ish Scheme) specifically -- see
// test/conformance.test.js for the exact `guile3.0` invocation this is
// verified against. Prefix notation throughout: this project's "bin" node
// is the one thing every OTHER emitter can handle via base.js's default
// infix `(${L} ${op} ${R})` -- Scheme is the one target here where even
// `+`/`-`/`*`/`/` themselves need to move into the operator position, so
// this overrides emitExpr's "bin" case specifically (Emitter is a real
// class -- see base.js -- so this is a small subclass, not a new shared
// hook every other emitter would have to ignore).
const Emitter = require("./base.js");

// Guile special forms plus the procedure names this emitter's own calls
// table depends on -- same role as QB64_RESERVED in emitters/qb64.js.
// Scheme technically allows shadowing a procedure name like `sqrt` with a
// local binding, but doing so would break every OTHER call in the same
// scope that still expects it to mean the real one, so it's guarded here
// same as a true syntactic keyword.
const SCHEME_RESERVED = new Set([
    "define", "lambda", "let", "let*", "letrec", "letrec*", "if", "cond", "case",
    "and", "or", "not", "begin", "set!", "quote", "quasiquote", "unquote", "do",
    "delay", "values", "call-with-values", "else", "define-record-type",
    "sqrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan", "exp", "log",
    "expt", "floor", "ceiling", "round", "truncate", "min", "max",
]);

function checkReservedNames(names) {
    for (const name of names) {
        if (SCHEME_RESERVED.has(name)) {
            throw new Error(
                `emitter for .scm: "${name}" is a reserved Scheme special form/procedure name and can't be used ` +
                `as a function/variable/parameter name -- rename it (see SCHEME_RESERVED in emitters/scheme.js)`,
            );
        }
    }
}

class SchemeEmitter extends Emitter {
    emitExpr(node) {
        if (node.type === "bin") {
            // ast.js's op set (+ - * /) is already valid Scheme procedure-
            // position syntax verbatim -- no translation table needed,
            // just moving it from infix to prefix position.
            return `(${node.op} ${this.emitExpr(node.left)} ${this.emitExpr(node.right)})`;
        }
        return super.emitExpr(node);
    }
}

function fn1(name) {
    return ([x]) => `(${name} ${x})`;
}

function fn2(name) {
    return ([a, b]) => `(${name} ${a} ${b})`;
}

const emitter = new SchemeEmitter({
    ext: "scm",
    // Guile accepts JS-style numeric literal syntax directly, including
    // exponential notation ("1e-9") -- no conversion needed for the digits
    // themselves. But a bare integer literal like "2" is EXACT in Scheme's
    // reader syntax, and exact arithmetic that never happens to touch an
    // inexact (float) operand stays exact -- confirmed a real compiler
    // prints (/ 1 3) as the fraction "1/3", not "0.333...". Every literal
    // this project emits is meant to behave as an IEEE double like every
    // other target, so any literal with neither a decimal point nor an
    // exponent marker gets ".0" appended, forcing inexactness by literal
    // syntax alone -- not relying on some other operand in the same
    // expression happening to already be inexact.
    formatNumber: (v) => {
        const s = String(v);
        return /[.e]/i.test(s) ? s : `${s}.0`;
    },
    calls: {
        sqrt: fn1("sqrt"), abs: fn1("abs"), sin: fn1("sin"), cos: fn1("cos"), tan: fn1("tan"),
        asin: fn1("asin"), acos: fn1("acos"), atan: fn1("atan"), exp: fn1("exp"), log: fn1("log"),
        // expt is Scheme's exponentiation procedure -- there's no infix **.
        pow: fn2("expt"),
        // R7RS's 2-argument atan IS atan2 -- no separate name for it.
        atan2: fn2("atan"),
        // No log2/log10 procedure in R7RS or Guile's core -- derive both.
        log2: ([x]) => `(/ (log ${x}) (log 2.0))`,
        log10: ([x]) => `(/ (log ${x}) (log 10.0))`,
        floor: fn1("floor"), ceil: fn1("ceiling"),
        // Guile's round is round-half-to-even (banker's rounding), not the
        // round-half-away-from-zero most other targets here use -- same
        // already-documented, already-avoided-in-tests divergence as
        // Lua's/Julia's round(), not a new one (see
        // test/conformance.test.js's kitchen-sink comment).
        round: fn1("round"),
        trunc: fn1("truncate"),
        min: fn2("min"), max: fn2("max"),
        // No hypot procedure -- derive it directly.
        hypot: ([a, b]) => `(sqrt (+ (* ${a} ${a}) (* ${b} ${b})))`,
        // No sign procedure either -- build it directly. Zero-aware by
        // construction (see Go's/Rust's sign() history in this project for
        // what happens when it isn't).
        sign: ([x]) => `(if (> ${x} 0.0) 1.0 (if (< ${x} 0.0) -1.0 0.0))`,
    },
    // Scheme's `if` already IS an expression (no separate statement form),
    // so this is the most direct emitSelect override of any target here --
    // just prefix notation for the comparison, same as every "bin" node.
    // "!=" needs `(not (= ...))`: R7RS has no single-procedure not-equal.
    emitSelect: function (condNode, thenStr, elseStr) {
        const L = this.emitExpr(condNode.left);
        const R = this.emitExpr(condNode.right);
        const condExpr =
            condNode.op === "!=" ? `(not (= ${L} ${R}))` : `(${condNode.op === "==" ? "=" : condNode.op} ${L} ${R})`;
        return `(if ${condExpr} ${thenStr} ${elseStr})`;
    },
    formatFunction: (fn, body, letBindings = []) => {
        checkReservedNames([fn.name, ...fn.params, ...letBindings.map((b) => b.name)]);
        const params = fn.params.join(" ");
        // let* (not let): each binding can see every earlier one, matching
        // the dependency order collectLets already produced -- exactly
        // what our flat, ordered bindings list needs, no extra nesting.
        if (letBindings.length === 0) {
            return `;; AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
                   `(define (${fn.name} ${params})\n` +
                   `  ${body})\n`;
        }
        const lets = letBindings.map(({ name, valueStr }) => `         (${name} ${valueStr})`).join("\n");
        return `;; AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `(define (${fn.name} ${params})\n` +
               `  (let* (${lets.trimStart()})\n` +
               `    ${body}))\n`;
    },
    // Multiple named outputs from one call: Scheme's native (values ...)
    // -- same idea as Lua's native multiple return, positional rather than
    // named, so a leading comment documents field order (matching Lua's
    // convention here) since Scheme's values have no names at the call
    // site.
    formatSuite: (fn, outputStrs, letBindings = []) => {
        const outputNames = Object.keys(outputStrs);
        checkReservedNames([fn.name, ...fn.params, ...outputNames, ...letBindings.map((b) => b.name)]);
        const params = fn.params.join(" ");
        const returnExpr = `(values ${outputNames.map((n) => outputStrs[n]).join(" ")})`;
        const header =
            `;; AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
            `;; Returns (values ${outputNames.join(" ")}).\n`;
        if (letBindings.length === 0) {
            return header + `(define (${fn.name} ${params})\n` + `  ${returnExpr})\n`;
        }
        const lets = letBindings.map(({ name, valueStr }) => `         (${name} ${valueStr})`).join("\n");
        return header +
               `(define (${fn.name} ${params})\n` +
               `  (let* (${lets.trimStart()})\n` +
               `    ${returnExpr}))\n`;
    },
});

module.exports = emitter;
