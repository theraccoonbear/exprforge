// exprforge/emitters/python.js
const Emitter = require("./base.js");

function fn1(name) {
    return ([x]) => `math.${name}(${x})`;
}

function fn2(name) {
    return ([a, b]) => `math.${name}(${a}, ${b})`;
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// Python's "/" raises ZeroDivisionError for a zero denominator, unlike the
// IEEE 754 +-Infinity/NaN every other target's "/" produces. A helper
// function (rather than an inline conditional) keeps each operand
// evaluated exactly once. The try/except costs nothing on the normal
// path. The sign of a zero denominator is read with copysign, so -0.0 is
// honored. See docs/adr/0004-division-by-zero.md.
const DIV_HELPER = `def _exprforge_div(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        if a != a or a == 0:
            return math.nan
        return math.copysign(math.inf, a) * math.copysign(1.0, b)
`;

// Domain-guarded primitives as one-line helpers, emitted once per file in
// the same block as _exprforge_div (same includeHelpers gate). Python's
// math.sqrt/log/log2/log10/asin/acos raise ValueError out of domain, and
// math.floor/ceil/trunc raise OverflowError (inf) or ValueError (nan);
// builtin min/max are NaN-order-dependent; "%" by zero raises. An inline
// guard would repeat its operand (evaluating it several times, with
// nesting multiplying the text); a helper takes each operand once. The
// _ef_ prefix is reserved in ast.js's identifier check. pow and exp are
// deliberately not here: they live in the boundary-conformance work
// (_ef_pow, _ef_exp) so the two changes do not collide.
const EF_HELPERS = [
    `def _ef_sqrt(x): return math.sqrt(x) if x >= 0 else math.nan`,
    `def _ef_asin(x): return math.asin(x) if -1 <= x <= 1 else math.nan`,
    `def _ef_acos(x): return math.acos(x) if -1 <= x <= 1 else math.nan`,
    `def _ef_log(x): return math.log(x) if x > 0 else (-math.inf if x == 0 else math.nan)`,
    `def _ef_log2(x): return math.log2(x) if x > 0 else (-math.inf if x == 0 else math.nan)`,
    `def _ef_log10(x): return math.log10(x) if x > 0 else (-math.inf if x == 0 else math.nan)`,
    `def _ef_min(a, b): return math.nan if (a != a or b != b) else min(a, b)`,
    `def _ef_max(a, b): return math.nan if (a != a or b != b) else max(a, b)`,
    `def _ef_floor(x): return math.copysign(math.floor(x), x) if math.isfinite(x) else x`,
    `def _ef_ceil(x): return math.copysign(math.ceil(x), x) if math.isfinite(x) else x`,
    `def _ef_trunc(x): return math.copysign(math.trunc(x), x) if math.isfinite(x) else x`,
    `def _ef_round(x):\n` +
    `    if not math.isfinite(x): return x\n` +
    `    f = math.floor(abs(x))\n` +
    `    return math.copysign(f + (1.0 if abs(x) - f >= 0.5 else 0.0), x)`,
    `def _ef_sign(x): return 1.0 if x > 0 else (-1.0 if x < 0 else x)`,
    `def _ef_wrap_index(i, m): return i % m if m != 0 else math.nan`,
].join("\n") + "\n";

const HELPER_BLOCK = DIV_HELPER + EF_HELPERS;

const emitter = new Emitter({
    ext: "py",
    emitDiv: (l, r) => `_exprforge_div(${l}, ${r})`,
    // Python accepts JS-style numeric literal syntax directly, including
    // exponential notation ("1e-9"), unlike QB64/C# -- no conversion or
    // suffix needed. Integer-valued literals stay Python ints, but that's
    // safe here: every bin op comes from ast.js's own +-*/ set, and
    // Python 3's `/` is always true (float) division regardless of
    // operand types, unlike C#'s int/int trap.
    formatNumber: (v) => String(v),
    calls: {
        // Python's math.sqrt/log/log2/log10/asin/acos/pow all RAISE
        // ValueError for an out-of-domain argument -- confirmed directly,
        // not assumed -- unlike every other target here (JS/C/Rust/Go/
        // Java/Lua/PHP/Zig/C#), which return NaN/Infinity cleanly. Each
        // guarded primitive is a one-line _ef_ helper (see EF_HELPERS)
        // rather than an inline conditional, so its operand is written
        // and evaluated once instead of two or three times.
        sqrt: ([x]) => `_ef_sqrt(${x})`,
        abs: ([x]) => `abs(${x})`, sin: fn1("sin"), cos: fn1("cos"), tan: fn1("tan"),
        asin: ([x]) => `_ef_asin(${x})`,
        acos: ([x]) => `_ef_acos(${x})`,
        atan: fn1("atan"), atan2: fn2("atan2"),
        log: ([x]) => `_ef_log(${x})`,
        log2: ([x]) => `_ef_log2(${x})`,
        log10: ([x]) => `_ef_log10(${x})`,
        exp: fn1("exp"),
        pow: ([base, exp]) =>
            `(math.pow(${base}, ${exp}) if not (${base} < 0 and ${exp} != int(${exp})) else float('nan'))`,
        // NOT bare min()/max(): Python's builtins are comparison-based,
        // and a comparison against NaN is always False -- so whichever
        // argument comes FIRST silently wins whenever either is NaN,
        // confirmed directly (min(nan,5)==nan but min(5,nan)==5, same
        // for max). Position-dependent, not a real "ignore" or
        // "propagate" rule. JS/Go/Java/C#/Julia/Scheme/Fortran instead
        // propagate NaN through min/max the way this project now
        // standardizes on -- see docs/adr/0003-min-max-nan-propagation.md.
        min: ([a, b]) => `_ef_min(${a}, ${b})`,
        max: ([a, b]) => `_ef_max(${a}, ${b})`,
        hypot: fn2("hypot"),
        // math.floor/ceil/trunc and builtin round() all return int in
        // Python 3, not float -- wrap to stay float64 throughout, matching
        // every other target here, rather than silently switching types.
        floor: ([x]) => `_ef_floor(${x})`,
        ceil: ([x]) => `_ef_ceil(${x})`,
        trunc: ([x]) => `_ef_trunc(${x})`,
        // Python's builtin round() ties to EVEN ("banker's rounding"),
        // NOT this project's standardized round-half-AWAY-from-zero
        // convention -- see js.js's own comment and the root README's
        // "round() at exact .5 boundaries" section. math.copysign copies
        // the sign of its 2nd argument onto the magnitude of its 1st --
        // a cleaner fit here than a separate sign*floor(abs+0.5) ternary,
        // and correctly handles x == 0 too (floor(0 + 0.5) == 0, and
        // copysign(0, 0) == 0.0).
        round: ([x]) => `_ef_round(${x})`,
        // No math.sign in Python's stdlib -- build it directly. Zero-aware
        // by construction (see Go's/Rust's sign() history in this project
        // for what happens when it isn't).
        sign: ([x]) => `_ef_sign(${x})`,
        // Python's % is documented, unambiguous floor-mod (result takes
        // the sign of the divisor) -- unlike most other targets here, no
        // sign-correction wrapper is needed; the helper only guards a
        // zero modulus, which raises ZeroDivisionError.
        wrapIndex: ([i, m]) => `_ef_wrap_index(${i}, ${m})`,
        clampIndex: ([i, lo, hi]) => `max(${lo}, min(${hi}, ${i}))`,
    },
    // Python list subscripts must be int, not float -- a float index
    // raises TypeError at runtime. No formatFunction change needed:
    // Python params here carry no type annotation regardless.
    emitIndex: function (targetNode, atNode) {
        return `${this.emitExpr(targetNode)}[int(${this.emitExpr(atNode)})]`;
    },
    // Python has no ?: ternary; `a if cond else b` is its conditional
    // expression instead, and it's just as short-circuiting.
    emitSelect: function (condNode, thenStr, elseStr) {
        const L = this.emitExpr(condNode.left);
        const R = this.emitExpr(condNode.right);
        return `(${thenStr} if (${L} ${condNode.op} ${R}) else ${elseStr})`;
    },
    // Opt-in only (see emitFunction's `addTypeGuards` and
    // docs/runtime-type-guards.md). Python allows a simple statement on
    // the same line as its "if:" (no separate indented block needed),
    // so this stays one physical line, same as every other target's
    // guard template -- `if not isinstance(arr, list): raise ...`.
    typeGuard: (p, fnName) =>
        `if not isinstance(${p}, list): raise TypeError(${JSON.stringify(`${fnName}: "${p}" must be an array`)})`,
    // Opt-in on top of typeGuard's own opt-in (see emitFunction's
    // `fn.arrayLengths` doc comment in base.js) -- runs after the type
    // guard above, so len(...) is always safe to call here.
    lengthGuard: (p, lenP, fnName) =>
        `if len(${p}) != ${lenP}: raise ValueError(${JSON.stringify(`${fnName}: len("${p}") must equal "${lenP}"`)})`,
    formatFunction: (fn, body, letBindings = [], guardLines = [], opts = {}) => {
        const params = fn.params.join(", ");
        const guards = guardLines.map((l) => `    ${l}`).join("\n");
        const guardsBlock = guards ? guards + "\n" : "";
        const lets = letBindings.map(({ name, valueStr }) => `    ${name} = ${valueStr}`).join("\n");
        const letsBlock = lets ? lets + "\n" : "";
        const helper = opts.includeHelpers === false ? "" : HELPER_BLOCK + "\n\n";
        return `# AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `import math\n\n\n` +
               helper +
               `def ${fn.name}(${params}):\n` +
               guardsBlock +
               letsBlock +
               `    return ${body}\n`;
    },
    // Multiple named outputs from one call: a small local class (dot
    // access, result.rx) rather than a plain dict -- consistent with
    // every other target here (C/Rust's struct, C#/Go's tuple, Java's
    // nested Result class), and a fixed, self-documenting field set
    // instead of an untyped mapping.
    formatSuite: (fn, outputStrs, letBindings = [], guardLines = [], opts = {}) => {
        const params = fn.params.join(", ");
        const guards = guardLines.map((l) => `    ${l}`).join("\n");
        const guardsBlock = guards ? guards + "\n" : "";
        const lets = letBindings.map(({ name, valueStr }) => `    ${name} = ${valueStr}`).join("\n");
        const letsBlock = lets ? lets + "\n" : "";
        const outputNames = Object.keys(outputStrs);
        const className = `${capitalize(fn.name)}Result`;
        const ctorParams = outputNames.join(", ");
        const ctorAssigns = outputNames.map((n) => `        self.${n} = ${n}`).join("\n");
        const ctorArgs = outputNames.map((n) => outputStrs[n]).join(", ");
        const helper = opts.includeHelpers === false ? "" : HELPER_BLOCK + "\n\n";
        return `# AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `import math\n\n\n` +
               helper +
               `class ${className}:\n` +
               `    def __init__(self, ${ctorParams}):\n` +
               `${ctorAssigns}\n\n\n` +
               `def ${fn.name}(${params}):\n` +
               guardsBlock +
               letsBlock +
               `    return ${className}(${ctorArgs})\n`;
    },
});

module.exports = emitter;
