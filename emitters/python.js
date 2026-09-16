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

const emitter = new Emitter({
    ext: "py",
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
        // Java/Lua/PHP/Zig/C#), which return NaN/Infinity cleanly. Python's
        // own ternary (`a if cond else b`) is short-circuiting (confirmed
        // separately this session -- it's what already made normalizeX's
        // QB64-only divergence possible in the first place), so a simple
        // inline conditional expression is enough here, unlike QB64's
        // arithmetic-only select() which needed real helper FUNCTIONs
        // instead (see emitters/qb64.js's own SAFE_MATH_HELPERS comment
        // for the full story this fix is the Python half of).
        sqrt: ([x]) => `(math.sqrt(${x}) if ${x} >= 0 else float('nan'))`,
        abs: ([x]) => `abs(${x})`, sin: fn1("sin"), cos: fn1("cos"), tan: fn1("tan"),
        asin: ([x]) => `(math.asin(${x}) if -1 <= ${x} <= 1 else float('nan'))`,
        acos: ([x]) => `(math.acos(${x}) if -1 <= ${x} <= 1 else float('nan'))`,
        atan: fn1("atan"), atan2: fn2("atan2"),
        log: ([x]) => `(math.log(${x}) if ${x} > 0 else (float('-inf') if ${x} == 0 else float('nan')))`,
        log2: ([x]) => `(math.log2(${x}) if ${x} > 0 else (float('-inf') if ${x} == 0 else float('nan')))`,
        log10: ([x]) => `(math.log10(${x}) if ${x} > 0 else (float('-inf') if ${x} == 0 else float('nan')))`,
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
        min: ([a, b]) => `(float('nan') if (math.isnan(${a}) or math.isnan(${b})) else min(${a}, ${b}))`,
        max: ([a, b]) => `(float('nan') if (math.isnan(${a}) or math.isnan(${b})) else max(${a}, ${b}))`,
        hypot: fn2("hypot"),
        // math.floor/ceil/trunc and builtin round() all return int in
        // Python 3, not float -- wrap to stay float64 throughout, matching
        // every other target here, rather than silently switching types.
        floor: ([x]) => `float(math.floor(${x}))`,
        ceil: ([x]) => `float(math.ceil(${x}))`,
        trunc: ([x]) => `float(math.trunc(${x}))`,
        // Python's builtin round() ties to EVEN ("banker's rounding"),
        // NOT this project's standardized round-half-AWAY-from-zero
        // convention -- see js.js's own comment and the root README's
        // "round() at exact .5 boundaries" section. math.copysign copies
        // the sign of its 2nd argument onto the magnitude of its 1st --
        // a cleaner fit here than a separate sign*floor(abs+0.5) ternary,
        // and correctly handles x == 0 too (floor(0 + 0.5) == 0, and
        // copysign(0, 0) == 0.0).
        round: ([x]) => `math.copysign(math.floor(abs(${x}) + 0.5), ${x})`,
        // No math.sign in Python's stdlib -- build it directly. Zero-aware
        // by construction (see Go's/Rust's sign() history in this project
        // for what happens when it isn't).
        sign: ([x]) => `(1.0 if ${x} > 0 else (-1.0 if ${x} < 0 else 0.0))`,
        // Python's % is documented, unambiguous floor-mod (result takes
        // the sign of the divisor) -- unlike most other targets here, no
        // sign-correction wrapper is needed.
        wrapIndex: ([i, m]) => `(${i} % ${m})`,
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
    formatFunction: (fn, body, letBindings = [], guardLines = []) => {
        const params = fn.params.join(", ");
        const guards = guardLines.map((l) => `    ${l}`).join("\n");
        const guardsBlock = guards ? guards + "\n" : "";
        const lets = letBindings.map(({ name, valueStr }) => `    ${name} = ${valueStr}`).join("\n");
        const letsBlock = lets ? lets + "\n" : "";
        return `# AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `import math\n\n\n` +
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
    formatSuite: (fn, outputStrs, letBindings = [], guardLines = []) => {
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
        return `# AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `import math\n\n\n` +
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
