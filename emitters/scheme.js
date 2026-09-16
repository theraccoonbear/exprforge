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
    "expt", "floor", "ceiling", "round", "truncate", "min", "max", "modulo",
    "vector-ref", "vector-length",
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
        // R7RS/Guile's own sqrt/log/asin/acos/expt DON'T throw and DON'T
        // return NaN for an out-of-domain real argument -- confirmed
        // directly, and genuinely more dangerous than either: Scheme's
        // numeric tower silently PROMOTES to a COMPLEX number instead
        // (e.g. (sqrt -1.0) => 0.0+1.0i), a totally different result
        // shape than every other target here. `if` is a real
        // short-circuiting special form (confirmed: unlike select()'s
        // own arithmetic-emulation targets, e.g. QB64 -- see
        // emitters/qb64.js's own SAFE_MATH_HELPERS comment for that
        // side of this same fix), so a guard is a plain conditional, no
        // helper procedure needed. (/ 0.0 0.0), (/ 1.0 0.0), and
        // (/ -1.0 0.0) are confirmed-safe, non-crashing ways to
        // synthesize a real NaN/+inf.0/-inf.0 in Scheme.
        sqrt: ([x]) => `(if (>= ${x} 0.0) (sqrt ${x}) (/ 0.0 0.0))`,
        abs: fn1("abs"), sin: fn1("sin"), cos: fn1("cos"), tan: fn1("tan"),
        asin: ([x]) => `(if (and (>= ${x} -1.0) (<= ${x} 1.0)) (asin ${x}) (/ 0.0 0.0))`,
        acos: ([x]) => `(if (and (>= ${x} -1.0) (<= ${x} 1.0)) (acos ${x}) (/ 0.0 0.0))`,
        atan: fn1("atan"), exp: fn1("exp"),
        log: ([x]) => `(if (> ${x} 0.0) (log ${x}) (if (= ${x} 0.0) (/ -1.0 0.0) (/ 0.0 0.0)))`,
        // expt is Scheme's exponentiation procedure -- there's no infix
        // **. Same complex-promotion problem as sqrt/log/asin/acos above
        // for a negative base with a non-integer exponent (confirmed:
        // (expt -8.0 (/ 1.0 3.0)) => 1.0+1.732...i) -- guarded the same
        // way, `truncate` (a standard R7RS procedure) checks "is this
        // already a whole number".
        pow: ([base, exp]) =>
            `(if (and (< ${base} 0.0) (not (= ${exp} (truncate ${exp})))) (/ 0.0 0.0) (expt ${base} ${exp}))`,
        // R7RS's 2-argument atan IS atan2 -- no separate name for it.
        atan2: fn2("atan"),
        // No log2/log10 procedure in R7RS or Guile's core -- derive both
        // from the now-guarded log: entry above, not the raw procedure,
        // so they inherit the same domain safety for free.
        log2: ([x]) => `(/ (if (> ${x} 0.0) (log ${x}) (if (= ${x} 0.0) (/ -1.0 0.0) (/ 0.0 0.0))) (log 2.0))`,
        log10: ([x]) => `(/ (if (> ${x} 0.0) (log ${x}) (if (= ${x} 0.0) (/ -1.0 0.0) (/ 0.0 0.0))) (log 10.0))`,
        floor: fn1("floor"), ceil: fn1("ceiling"),
        // Guile's round is round-half-to-even (banker's rounding), not the
        // round-half-away-from-zero most other targets here use -- same
        // already-documented, already-avoided-in-tests divergence as
        // Lua's/Julia's round(), not a new one (see
        // test/conformance.test.js's kitchen-sink comment).
        // R7RS's round ties to EVEN ("banker's rounding"), NOT this
        // project's standardized round-half-AWAY-from-zero convention --
        // see js.js's own comment and the root README's "round() at
        // exact .5 boundaries" section. Sign built inline, same ternary
        // shape as this file's own sign: entry below.
        round: ([x]) => `(* (if (> ${x} 0.0) 1.0 (if (< ${x} 0.0) -1.0 0.0)) (floor (+ (abs ${x}) 0.5)))`,
        trunc: fn1("truncate"),
        min: fn2("min"), max: fn2("max"),
        // No hypot procedure -- derive it directly.
        hypot: ([a, b]) => `(sqrt (+ (* ${a} ${a}) (* ${b} ${b})))`,
        // No sign procedure either -- build it directly. Zero-aware by
        // construction (see Go's/Rust's sign() history in this project for
        // what happens when it isn't).
        sign: ([x]) => `(if (> ${x} 0.0) 1.0 (if (< ${x} 0.0) -1.0 0.0))`,
        // modulo is traditional Scheme's floor-mod procedure (result
        // takes the sign of the divisor), distinct from remainder
        // (dividend's sign) -- the right one here, no correction needed.
        wrapIndex: fn2("modulo"),
        clampIndex: ([i, lo, hi]) => `(max ${lo} (min ${hi} ${i}))`,
    },
    // vector-ref requires an exact non-negative integer index -- every
    // number in this AST is inexact by construction (see formatNumber
    // above), so the index needs an explicit exact-integer conversion
    // first. round (not truncate) guards against floating imprecision
    // landing just under an intended integer value. No formatFunction
    // change needed: Scheme params carry no type annotation regardless.
    emitIndex: function (targetNode, atNode) {
        return `(vector-ref ${this.emitExpr(targetNode)} (inexact->exact (round ${this.emitExpr(atNode)})))`;
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
    // Opt-in only (see emitFunction's `addTypeGuards` and
    // docs/runtime-type-guards.md). Scheme's array-typed param is a
    // vector (see emitIndex above) -- unlike every other target here,
    // Scheme's function body is a single EXPRESSION, not a sequence of
    // statements, so there's no room to just prepend an imperative check
    // -- formatFunction/formatSuite below wrap the body in `(begin
    // guard... realBody)` instead, only when guardLines is non-empty
    // (never changing the output at all otherwise).
    typeGuard: (p, fnName) =>
        `(unless (vector? ${p}) (error ${JSON.stringify(`${fnName}: "${p}" must be a vector (array)`)}))`,
    formatFunction: (fn, body, letBindings = [], guardLines = []) => {
        checkReservedNames([fn.name, ...fn.params, ...letBindings.map((b) => b.name)]);
        const params = fn.params.join(" ");
        const guards = guardLines.length ? guardLines.map((l) => `    ${l}`).join("\n") + "\n" : "";
        const wrap = (inner) => (guardLines.length ? `(begin\n${guards}    ${inner})` : inner);
        // let* (not let): each binding can see every earlier one, matching
        // the dependency order collectLets already produced -- exactly
        // what our flat, ordered bindings list needs, no extra nesting.
        if (letBindings.length === 0) {
            return `;; AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
                   `(define (${fn.name} ${params})\n` +
                   `  ${wrap(body)})\n`;
        }
        const lets = letBindings.map(({ name, valueStr }) => `         (${name} ${valueStr})`).join("\n");
        return `;; AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `(define (${fn.name} ${params})\n` +
               `  (let* (${lets.trimStart()})\n` +
               `    ${wrap(body)}))\n`;
    },
    // Multiple named outputs from one call: Scheme's native (values ...)
    // -- same idea as Lua's native multiple return, positional rather than
    // named, so a leading comment documents field order (matching Lua's
    // convention here) since Scheme's values have no names at the call
    // site.
    formatSuite: (fn, outputStrs, letBindings = [], guardLines = []) => {
        const outputNames = Object.keys(outputStrs);
        checkReservedNames([fn.name, ...fn.params, ...outputNames, ...letBindings.map((b) => b.name)]);
        const params = fn.params.join(" ");
        const returnExpr = `(values ${outputNames.map((n) => outputStrs[n]).join(" ")})`;
        const guards = guardLines.length ? guardLines.map((l) => `    ${l}`).join("\n") + "\n" : "";
        const wrap = (inner) => (guardLines.length ? `(begin\n${guards}    ${inner})` : inner);
        const header =
            `;; AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
            `;; Returns (values ${outputNames.join(" ")}).\n`;
        if (letBindings.length === 0) {
            return header + `(define (${fn.name} ${params})\n` + `  ${wrap(returnExpr)})\n`;
        }
        const lets = letBindings.map(({ name, valueStr }) => `         (${name} ${valueStr})`).join("\n");
        return header +
               `(define (${fn.name} ${params})\n` +
               `  (let* (${lets.trimStart()})\n` +
               `    ${wrap(returnExpr)}))\n`;
    },
});

module.exports = emitter;
