// exprforge/emitters/rust.js
//
// Rust's f64 math is method-call syntax (x.sqrt()), not free functions
// (sqrt(x)) like every other target here. The base Emitter's `calls` table
// just holds string templates, so this needs no special-casing in base.js —
// it's the reason `calls` was designed as arbitrary templates instead of a
// plain "language function name" lookup.
const Emitter = require("./base.js");

function method0(name) {
    return ([x]) => `(${x}).${name}()`;
}

function method1(name) {
    return ([recv, arg]) => `(${recv}).${name}(${arg})`;
}

const emitter = new Emitter({
    ext: "rs",
    // Explicit f64 suffix: a bare literal like `5.0` is only usable as a
    // method-call receiver (`5.0.sqrt()`) once its type is unambiguous, and
    // rustc won't always infer it from context (E0689).
    // Same real bug class as c.js's formatNumber (see its comment): once
    // JS's own String() renders an integer-valued number in exponential
    // form (huge magnitudes, e.g. 1e250), unconditionally appending
    // ".0f64" produces "1e+250.0f64" -- not valid Rust (confirmed against
    // a real rustc compile: a decimal point can't follow the exponent
    // part of a Rust float literal; the fraction has to come BEFORE it,
    // e.g. "1.0e250f64"). An already-exponential string just needs the
    // f64 suffix, no ".0" -- it's already an unambiguous float literal.
    formatNumber: (v) => {
        const s = String(v);
        if (/e/i.test(s)) return `${s}f64`;
        return Number.isInteger(v) ? `${s}.0f64` : `${s}f64`;
    },
    calls: {
        sqrt: method0("sqrt"), abs: method0("abs"), sin: method0("sin"), cos: method0("cos"),
        tan: method0("tan"), asin: method0("asin"), acos: method0("acos"), atan: method0("atan"),
        ln: method0("ln"), log2: method0("log2"), log10: method0("log10"), exp: method0("exp"),
        floor: method0("floor"), ceil: method0("ceil"), round: method0("round"), trunc: method0("trunc"),
        log: method0("ln"),   // Math.log is natural log; Rust spells it ln()
        // NOT .signum(): Rust's docs specify 1.0 at positive zero (it only
        // reads the sign bit), unlike JS's Math.sign(0) === 0 (and C's/
        // Java's sign, which both special-case zero). Found by the
        // kitchen-sink conformance test at exactly x - y == 0.
        sign: ([x]) => `(if ${x} > 0.0 { 1.0f64 } else if ${x} < 0.0 { -1.0f64 } else { 0.0f64 })`,
        pow: method1("powf"), atan2: method1("atan2"), hypot: method1("hypot"),
        // NOT bare .min()/.max(): Rust's f64::min/f64::max are documented
        // NaN-IGNORING -- if exactly one operand is NaN, the OTHER (real)
        // value is returned, confirmed directly against rustc (both
        // orders return 5.0, never NaN). Every other target here that
        // does this natively (C, Zig) shares the same divergence;
        // JS/Go/Java/C#/Julia/Scheme/Fortran instead propagate NaN
        // through min/max the way this project now standardizes on --
        // see docs/adr/0003-min-max-nan-propagation.md.
        min: ([a, b]) => `(if (${a}).is_nan() || (${b}).is_nan() { f64::NAN } else { (${a}).min(${b}) })`,
        max: ([a, b]) => `(if (${a}).is_nan() || (${b}).is_nan() { f64::NAN } else { (${a}).max(${b}) })`,
        // f64::rem_euclid is Rust's own stdlib method for exactly this --
        // always non-negative for a positive divisor, no hand-built
        // sign-correction needed. f64::clamp is likewise a direct stdlib
        // match for clampIndex's semantics.
        wrapIndex: ([i, m]) => `(${i}).rem_euclid(${m})`,
        clampIndex: ([i, lo, hi]) => `(${i}).clamp(${lo}, ${hi})`,
    },
    // Rust slice indexing requires a usize index -- no implicit float
    // conversion.
    emitIndex: function (targetNode, atNode) {
        return `${this.emitExpr(targetNode)}[(${this.emitExpr(atNode)}) as usize]`;
    },
    // Rust has no C-style ?: ternary; `if` is itself an expression instead
    // (`if cond { a } else { b }`), and it's just as short-circuiting.
    emitSelect: function (condNode, thenStr, elseStr) {
        const L = this.emitExpr(condNode.left);
        const R = this.emitExpr(condNode.right);
        return `(if ${L} ${condNode.op} ${R} { ${thenStr} } else { ${elseStr} })`;
    },
    formatFunction: (fn, body, letBindings = []) => {
        const params = fn.params.map((p) => `${p}: ${fn.paramTypes?.[p] === "number[]" ? "&[f64]" : "f64"}`).join(", ");
        const lets = letBindings.map(({ name, valueStr }) => `    let ${name}: f64 = ${valueStr};`).join("\n");
        const letsBlock = lets ? lets + "\n" : "";
        // Param/function names come from the AST author (may not be snake_case,
        // e.g. "P0"), every bin node keeps explicit parens by design (see
        // header), and a shared let-chain can bind more names than one
        // function's body reads (e.g. ux/uy/uz computed for three sibling
        // single-component functions) — all trip default rustc lints
        // without being bugs, so silence them rather than let a
        // `-D warnings` build choke on them.
        return `// AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `#[allow(non_snake_case, unused_parens, unused_variables)]\n` +
               `pub fn ${fn.name}(${params}) -> f64 {\n` +
               letsBlock +
               `    ${body}\n` +
               `}\n`;
    },
    // Multiple named outputs from one call: Rust has no native multi-return
    // with names (tuples are positional and easy to mix up for 6 fields),
    // so this emits a small struct alongside the function and constructs it
    // directly — the idiomatic Rust shape for "several named values out."
    formatSuite: (fn, outputStrs, letBindings = []) => {
        const params = fn.params.map((p) => `${p}: ${fn.paramTypes?.[p] === "number[]" ? "&[f64]" : "f64"}`).join(", ");
        const lets = letBindings.map(({ name, valueStr }) => `    let ${name}: f64 = ${valueStr};`).join("\n");
        const letsBlock = lets ? lets + "\n" : "";
        const outputNames = Object.keys(outputStrs);
        const structName = `${capitalize(fn.name)}Result`;
        const structFields = outputNames.map((n) => `    pub ${n}: f64,`).join("\n");
        const initFields = outputNames.map((n) => `${n}: ${outputStrs[n]}`).join(", ");
        return `// AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `#[allow(non_snake_case)]\n` +
               `pub struct ${structName} {\n${structFields}\n}\n\n` +
               `#[allow(non_snake_case, unused_parens, unused_variables)]\n` +
               `pub fn ${fn.name}(${params}) -> ${structName} {\n` +
               letsBlock +
               `    ${structName} { ${initFields} }\n` +
               `}\n`;
    },
});

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = emitter;
