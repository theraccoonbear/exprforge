// exprforge/emitters/julia.js
const Emitter = require("./base.js");

function fn1(name) {
    return ([x]) => `${name}(${x})`;
}

function fn2(name) {
    return ([a, b]) => `${name}(${a}, ${b})`;
}

const emitter = new Emitter({
    ext: "jl",
    // Julia accepts JS-style numeric literal syntax directly, including
    // exponential notation ("1e-9") -- no suffix or conversion needed.
    formatNumber: (v) => String(v),
    calls: {
        // All 22 are Julia Base functions -- no import, no derivation, no
        // wrapping needed for any of them, unlike every other target here.
        // Julia's own sqrt/log/log2/log10/asin/acos/^ all RAISE
        // DomainError for an out-of-domain real argument (confirmed
        // directly -- except log(0), which returns -Inf natively, no
        // guard needed there) -- unlike every other target here (JS/C/
        // Rust/Go/Java/Lua/PHP/Zig/C#), which return NaN/Infinity
        // cleanly. Julia's own ternary (`cond ? a : b`) is
        // short-circuiting (standard, same family as every C-like
        // ternary), and Julia has real NaN/Inf constants built in --
        // no synthesis trick needed the way QB64/Perl/Scheme's fixes
        // needed one (see emitters/qb64.js's own SAFE_MATH_HELPERS
        // comment for that side of this same fix).
        sqrt: ([x]) => `(${x} >= 0 ? sqrt(${x}) : NaN)`,
        abs: fn1("abs"), sin: fn1("sin"), cos: fn1("cos"), tan: fn1("tan"),
        asin: ([x]) => `(-1 <= ${x} <= 1 ? asin(${x}) : NaN)`,
        acos: ([x]) => `(-1 <= ${x} <= 1 ? acos(${x}) : NaN)`,
        atan: fn1("atan"), atan2: fn2("atan"),
        log: ([x]) => `(${x} > 0 ? log(${x}) : (${x} == 0 ? -Inf : NaN))`,
        log2: ([x]) => `(${x} > 0 ? log2(${x}) : (${x} == 0 ? -Inf : NaN))`,
        log10: ([x]) => `(${x} > 0 ? log10(${x}) : (${x} == 0 ? -Inf : NaN))`,
        exp: fn1("exp"),
        pow: ([x, y]) => `(${x} < 0 && ${y} != trunc(${y}) ? NaN : ${x} ^ ${y})`,
        floor: fn1("floor"), ceil: fn1("ceil"), trunc: fn1("trunc"),
        min: fn2("min"), max: fn2("max"), hypot: fn2("hypot"),
        // Julia's round() defaults to round-half-to-even (banker's
        // rounding), not the round-half-away-from-zero every other target
        // here uses -- RoundNearestTiesAway asks for that explicitly.
        // Doesn't affect the conformance suite either way (it deliberately
        // avoids exact .5 boundaries, see test/conformance.test.js), but
        // this is the genuinely-matching behavior, not just the
        // untested-so-it-doesn't-matter one.
        round: ([x]) => `round(${x}, RoundNearestTiesAway)`,
        // Julia does have sign(), and sign(0.0) == 0.0 -- matches every
        // other target's zero-aware convention already, so no need to
        // build this one by hand (unlike most other emitters here).
        sign: fn1("sign"),
        // mod() is Julia's floor-mod function (documented: result has the
        // same sign as the second argument) -- the right one for this,
        // unlike Julia's `%`/rem() which follows the dividend's sign
        // instead. clamp() is a direct built-in match for clampIndex.
        // (Julia arrays are 1-indexed -- that's handled where an "index"
        // node actually subscripts an array, not here; wrapIndex/
        // clampIndex stay 0-based and portable like every other target.)
        wrapIndex: fn2("mod"),
        clampIndex: ([i, lo, hi]) => `clamp(${i}, ${lo}, ${hi})`,
    },
    // Julia arrays are 1-indexed -- +1 at the one point it actually
    // matters (see wrapIndex's own comment). Indices must be Int, not
    // Float64 (a float index is a MethodError) -- round(Int, ...) guards
    // against floating imprecision the same way Scheme's does. No
    // formatFunction change needed: Julia params carry no type
    // annotation regardless.
    emitIndex: function (targetNode, atNode) {
        return `${this.emitExpr(targetNode)}[round(Int, ${this.emitExpr(atNode)}) + 1]`;
    },
    // Julia's ?: is exactly base.js's default ternary -- no override needed.
    // Opt-in only (see emitFunction's `addTypeGuards` and
    // docs/runtime-type-guards.md). Julia's array-typed param is a bare
    // AbstractVector (see emitIndex above) -- `;`-joined statements keep
    // this one physical line, same as every other target's guard
    // template.
    typeGuard: (p, fnName) =>
        `if !(${p} isa AbstractVector); throw(ArgumentError(${JSON.stringify(`${fnName}: "${p}" must be an array`)})); end`,
    // Opt-in on top of typeGuard's own opt-in (see emitFunction's
    // `fn.arrayLengths` doc comment in base.js) -- runs after the type
    // guard above, so length(...) is always safe to call here.
    lengthGuard: (p, lenP, fnName) =>
        `if length(${p}) != ${lenP}; throw(ArgumentError(${JSON.stringify(`${fnName}: length("${p}") must equal "${lenP}"`)})); end`,
    formatFunction: (fn, body, letBindings = [], guardLines = []) => {
        const params = fn.params.join(", ");
        const guards = guardLines.map((l) => `    ${l}`).join("\n");
        const guardsBlock = guards ? guards + "\n" : "";
        const lets = letBindings.map(({ name, valueStr }) => `    ${name} = ${valueStr}`).join("\n");
        const letsBlock = lets ? lets + "\n" : "";
        return `# AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `function ${fn.name}(${params})\n` +
               guardsBlock +
               letsBlock +
               `    return ${body}\n` +
               `end\n`;
    },
    // Multiple named outputs from one call: Julia's native named tuple
    // (`(rx=..., ry=...)`, dot access at the call site) -- the same idiom
    // C#'s emitter uses, and needs no wrapper type declared up front.
    formatSuite: (fn, outputStrs, letBindings = [], guardLines = []) => {
        const params = fn.params.join(", ");
        const guards = guardLines.map((l) => `    ${l}`).join("\n");
        const guardsBlock = guards ? guards + "\n" : "";
        const lets = letBindings.map(({ name, valueStr }) => `    ${name} = ${valueStr}`).join("\n");
        const letsBlock = lets ? lets + "\n" : "";
        const outputNames = Object.keys(outputStrs);
        const returnExpr = outputNames.map((n) => `${n}=${outputStrs[n]}`).join(", ");
        return `# AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `function ${fn.name}(${params})\n` +
               guardsBlock +
               letsBlock +
               `    return (${returnExpr})\n` +
               `end\n`;
    },
});

module.exports = emitter;
