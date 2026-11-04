// exprforge/emitters/ruby.js
const Emitter = require("./base.js");

function fn1(name) {
    return ([x]) => `Math.${name}(${x})`;
}

function fn2(name) {
    return ([a, b]) => `Math.${name}(${a}, ${b})`;
}

// A Ruby local variable must start with a lowercase letter or underscore
// (an uppercase first letter makes it a constant, which cannot be a formal
// argument or be assigned inside a method), and a reserved word cannot be
// a variable name. Such names get a leading underscore.
const RESERVED = new Set([
    "BEGIN", "END", "alias", "and", "begin", "break", "case", "class", "def", "defined?",
    "do", "else", "elsif", "end", "ensure", "false", "for", "if", "in", "module", "next",
    "nil", "not", "or", "redo", "rescue", "retry", "return", "self", "super", "then",
    "true", "undef", "unless", "until", "when", "while", "yield", "__FILE__", "__LINE__",
    "__ENCODING__",
]);

function rb(name) {
    return /^[A-Z]/.test(name) || RESERVED.has(name) ? `_${name}` : name;
}

class RubyEmitter extends Emitter {
    emitExpr(node) {
        if (node.type === "var") return rb(node.name);
        return super.emitExpr(node);
    }
}

function scalarCoercions(fn) {
    return fn.params
        .filter((p) => fn.paramTypes?.[p] !== "number[]")
        .map((p) => `    ${rb(p)} = Float(${rb(p)})`)
        .join("\n");
}

function bodyPrelude(fn, letBindings, guardLines) {
    const guards = guardLines.map((l) => `    ${l}`).join("\n");
    const coercions = scalarCoercions(fn);
    const lets = letBindings.map(({ name, valueStr }) => `    ${rb(name)} = ${valueStr}`).join("\n");
    return [guards, coercions, lets].filter(Boolean).map((s) => s + "\n").join("");
}

const emitter = new RubyEmitter({
    ext: "rb",
    // Ruby's Integer / 0 raises ZeroDivisionError while Float / 0.0 is
    // IEEE 754 (Infinity or NaN), and Integer / Integer truncates. Every
    // numeric literal is therefore emitted as a Float, and scalar
    // parameters are coerced with Float() on entry (see bodyPrelude), so
    // every "/" and "%" the AST can produce is a Float operation. See
    // docs/adr/0004-division-by-zero.md.
    formatNumber: (v) => {
        if (Number.isNaN(v)) return "Float::NAN";
        if (v === Infinity) return "Float::INFINITY";
        if (v === -Infinity) return "(-Float::INFINITY)";
        const s = String(v);
        return /^-?\d+$/.test(s) ? `${s}.0` : s;
    },
    calls: {
        // Math.sqrt/log/log2/log10/asin/acos raise Math::DomainError for an
        // out-of-domain argument (unlike JS/C, which return NaN). Guarded
        // inline so the unified domain-error behavior holds: NaN, or
        // -Infinity for log of zero. See docs/adr/0002-domain-error-handling.md.
        sqrt: ([x]) => `(${x} >= 0 ? Math.sqrt(${x}) : Float::NAN)`,
        abs: ([x]) => `(${x}).abs`, sin: fn1("sin"), cos: fn1("cos"), tan: fn1("tan"),
        asin: ([x]) => `((${x} >= -1 && ${x} <= 1) ? Math.asin(${x}) : Float::NAN)`,
        acos: ([x]) => `((${x} >= -1 && ${x} <= 1) ? Math.acos(${x}) : Float::NAN)`,
        atan: fn1("atan"), atan2: fn2("atan2"),
        log: ([x]) => `(${x} > 0 ? Math.log(${x}) : (${x} == 0 ? -Float::INFINITY : Float::NAN))`,
        log2: ([x]) => `(${x} > 0 ? Math.log2(${x}) : (${x} == 0 ? -Float::INFINITY : Float::NAN))`,
        log10: ([x]) => `(${x} > 0 ? Math.log10(${x}) : (${x} == 0 ? -Float::INFINITY : Float::NAN))`,
        exp: fn1("exp"),
        // Float ** Float with a negative base and a non-integer exponent
        // returns a Complex in Ruby, not NaN. Guarded; an infinite
        // exponent is integer-valued for this purpose, as in JS.
        pow: ([b, e]) =>
            `((${b} < 0 && (${e}).finite? && (${e}) % 1 != 0) ? Float::NAN : ((${b}) ** (${e})))`,
        // Not [a, b].min / .max: a comparison against NaN is false, so the
        // result would depend on argument position. NaN propagates instead.
        // See docs/adr/0003-min-max-nan-propagation.md.
        min: ([a, b]) => `((${a} != ${a} || ${b} != ${b}) ? Float::NAN : (${a} < ${b} ? ${a} : ${b}))`,
        max: ([a, b]) => `((${a} != ${a} || ${b} != ${b}) ? Float::NAN : (${a} > ${b} ? ${a} : ${b}))`,
        hypot: fn2("hypot"),
        // Float#floor/ceil/truncate/round return Integer and raise
        // FloatDomainError for NaN and +-Infinity; non-finite values pass
        // through unchanged and finite results are converted back to Float.
        floor: ([x]) => `((${x}).finite? ? (${x}).floor.to_f : (${x}))`,
        ceil: ([x]) => `((${x}).finite? ? (${x}).ceil.to_f : (${x}))`,
        trunc: ([x]) => `((${x}).finite? ? (${x}).truncate.to_f : (${x}))`,
        // Float#round(half: :up) rounds ties away from zero, matching
        // docs/adr/0001-round-tie-breaking.md.
        round: ([x]) => `((${x}).finite? ? (${x}).round(half: :up).to_f : (${x}))`,
        sign: ([x]) => `(${x} > 0 ? 1.0 : (${x} < 0 ? -1.0 : 0.0))`,
        // Ruby's % is floor-mod (result takes the sign of the divisor), but
        // Float % 0.0 raises ZeroDivisionError instead of returning NaN
        // (confirmed on Ruby 3.3), so a zero modulus is guarded.
        wrapIndex: ([i, m]) => `(${m} == 0 ? Float::NAN : (${i} % ${m}))`,
        clampIndex: ([i, lo, hi]) =>
            `(${i} < ${lo} ? ${lo} : (${i} > ${hi} ? ${hi} : ${i}))`,
    },
    // Array#[] with an out-of-range index returns nil, which .to_f would
    // silently turn into 0.0; Float() raises TypeError for nil instead,
    // and also normalizes Integer elements to Float so a later "/" by an
    // element equal to zero stays IEEE.
    emitIndex: function (targetNode, atNode) {
        return `Float(${this.emitExpr(targetNode)}[${this.emitExpr(atNode)}.to_i])`;
    },
    // Ruby's ?: is exactly base.js's default ternary, and every cmp()
    // operator (> < >= <= == !=) is spelled the same as in JS.
    typeGuard: (p, fnName) =>
        `raise TypeError, ${JSON.stringify(`${fnName}: "${p}" must be an array`)} unless ${rb(p)}.is_a?(Array)`,
    lengthGuard: (p, lenP, fnName) =>
        `raise ArgumentError, ${JSON.stringify(`${fnName}: ${p}.length must equal "${lenP}"`)} if ${rb(p)}.length != ${rb(lenP)}`,
    formatFunction: (fn, body, letBindings = [], guardLines = []) => {
        return `# AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `def ${fn.name}(${fn.params.map(rb).join(", ")})\n` +
               bodyPrelude(fn, letBindings, guardLines) +
               `    ${body}\n` +
               `end\n`;
    },
    // Multiple named outputs from one call: a Hash with Symbol keys
    // (result[:rx]).
    formatSuite: (fn, outputStrs, letBindings = [], guardLines = []) => {
        const outputNames = Object.keys(outputStrs);
        const fields = outputNames.map((n) => `        ${n}: ${outputStrs[n]},`).join("\n");
        return `# AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `def ${fn.name}(${fn.params.map(rb).join(", ")})\n` +
               bodyPrelude(fn, letBindings, guardLines) +
               `    {\n` +
               fields + "\n" +
               `    }\n` +
               `end\n`;
    },
});

module.exports = emitter;
