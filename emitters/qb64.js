// exprforge/emitters/qb64.js
const Emitter = require("./base.js");

const HALF_PI = "1.5707963267948966#";

// QB64/BASIC builtins that silently conflict with a variable or parameter
// of the same name (case-insensitive) -- confirmed painful in practice
// (see this project's QB64 gotchas memory, from a sibling game project).
// Checked below so a collision fails loudly at emission time with a
// specific name to fix, instead of as a cryptic QB64 compiler error later.
const QB64_RESERVED = new Set([
    "len", "val", "str", "int", "abs", "sqr", "sgn", "fix", "rnd", "log", "exp",
    "sin", "cos", "tan", "atn",
    "left", "right", "mid", "asc", "chr", "instr", "ltrim", "rtrim", "ucase", "lcase",
    "space", "string", "hex", "oct",
    "peek", "inp", "out", "timer", "date", "time", "tab", "spc", "pos",
]);

function checkReservedNames(names) {
    for (const name of names) {
        if (QB64_RESERVED.has(name.toLowerCase())) {
            throw new Error(
                `emitter for .bas: "${name}" is a reserved QB64 builtin and can't be used as a ` +
                `variable/parameter name -- rename it (see QB64_RESERVED in emitters/qb64.js)`,
            );
        }
    }
}

// Classic BASIC SQR/LOG/^ don't return NaN for an out-of-domain argument
// the way every other target's math library does -- they HALT THE PROGRAM
// with "Illegal function call" and, in any non-interactive context (a
// real compiled game/tool, or this project's own test harness), hang
// forever on an interactive "Continue?" prompt. Confirmed directly
// against a real compile+run, not assumed: SQR(-4#), LOG(0#), LOG(-1#),
// and (-8#) ^ (1#/3#) all crash this way; (-8#) ^ 2# (an INTEGER
// exponent on a negative base) does not -- only a genuinely fractional
// exponent on a negative base is unsafe. QB64's own newer _ASIN/_ACOS
// don't have this problem (confirmed: they return NaN cleanly), but this
// emitter's asin/acos were never built from those -- they're an ATN+SQR
// identity (see the calls table below), so they inherited SQR's crash
// for |x| > 1 the whole time, independently of anything to do with
// _ASIN/_ACOS at all.
//
// select()'s own arithmetic-emulation trick (see emitSelect below)
// CAN'T guard this: it computes both "branches" as values unconditionally
// before combining them arithmetically, so a select() around a crashing
// SQR call would still evaluate that SQR call and still crash -- the
// exact same reason this project's docs already warn select() can't
// guard division by zero (see ast.js's own select() comment). A real
// QB64 IF/THEN/ELSE *statement*, unlike that expression-level trick,
// does genuinely short-circuit -- confirmed directly -- so these are
// real FUNCTIONs with a real IF inside, not expression tricks.
//
// ef_zero is always a fresh local DOUBLE VARIABLE, never a literal 0 --
// dividing two DOUBLE variables both holding exactly 0 is confirmed to
// produce NaN cleanly (no crash); QB64's compile-time constant-folder
// might treat a literal 0/0 differently (this project doesn't rely on
// that at all, for exactly this reason).
//
// Only the helpers a function actually calls are emitted (see
// selectHelpers in base.js), each one a separate entry here.
const SAFE_MATH_HELPERS = {
    ef_safe_sqr:
    `FUNCTION ef_safe_sqr# (x AS DOUBLE)\n` +
    `    DIM ef_zero AS DOUBLE\n` +
    `    IF x < 0# THEN\n` +
    `        ef_zero = 0#\n` +
    `        ef_safe_sqr# = ef_zero / ef_zero\n` +
    `    ELSE\n` +
    `        ef_safe_sqr# = SQR(x)\n` +
    `    END IF\n` +
    `END FUNCTION\n`,
    ef_safe_log:
    `FUNCTION ef_safe_log# (x AS DOUBLE)\n` +
    `    DIM ef_zero AS DOUBLE\n` +
    `    IF x < 0# THEN\n` +
    `        ef_zero = 0#\n` +
    `        ef_safe_log# = ef_zero / ef_zero\n` +
    `    ELSEIF x = 0# THEN\n` +
    `        ef_zero = 0#\n` +
    `        ef_safe_log# = -1# / ef_zero\n` +
    `    ELSE\n` +
    `        ef_safe_log# = LOG(x)\n` +
    `    END IF\n` +
    `END FUNCTION\n`,
    ef_safe_pow:
    `FUNCTION ef_safe_pow# (ef_base AS DOUBLE, ef_expo AS DOUBLE)\n` +
    `    DIM ef_zero AS DOUBLE\n` +
    `    IF ef_base < 0# AND ef_expo <> INT(ef_expo) THEN\n` +
    `        ef_zero = 0#\n` +
    `        ef_safe_pow# = ef_zero / ef_zero\n` +
    `    ELSE\n` +
    `        ef_safe_pow# = ef_base ^ ef_expo\n` +
    `    END IF\n` +
    `END FUNCTION\n`,
    ef_safe_floor:
    `FUNCTION ef_safe_floor# (x AS DOUBLE)\n` +
    `    IF x <> x THEN\n` +
    `        ef_safe_floor# = x\n` +
    `    ELSEIF ABS(x) >= 4503599627370496# THEN\n` +
    `        ef_safe_floor# = x\n` +
    `    ELSE\n` +
    `        ef_safe_floor# = INT(x)\n` +
    `    END IF\n` +
    `END FUNCTION\n`,
    ef_safe_trunc:
    `FUNCTION ef_safe_trunc# (x AS DOUBLE)\n` +
    `    IF x < 0# THEN\n` +
    `        ef_safe_trunc# = -ef_safe_floor#(-x)\n` +
    `    ELSE\n` +
    `        ef_safe_trunc# = ef_safe_floor#(x)\n` +
    `    END IF\n` +
    `END FUNCTION\n`,
    ef_safe_round:
    `FUNCTION ef_safe_round# (x AS DOUBLE)\n` +
    `    DIM ef_m AS DOUBLE, ef_f AS DOUBLE\n` +
    `    IF x <> x THEN\n` +
    `        ef_safe_round# = x\n` +
    `    ELSEIF ABS(x) >= 4503599627370496# THEN\n` +
    `        ef_safe_round# = x\n` +
    `    ELSEIF x = 0# THEN\n` +
    `        ef_safe_round# = x\n` +
    `    ELSE\n` +
    `        ef_m = ABS(x)\n` +
    `        ef_f = INT(ef_m)\n` +
    `        IF ef_m - ef_f >= 0.5# THEN ef_f = ef_f + 1#\n` +
    `        IF ef_f = 0# THEN\n` +
    `            ef_safe_round# = x * 0#\n` +
    `        ELSEIF x < 0# THEN\n` +
    `            ef_safe_round# = -ef_f\n` +
    `        ELSE\n` +
    `            ef_safe_round# = ef_f\n` +
    `        END IF\n` +
    `    END IF\n` +
    `END FUNCTION\n`,
    ef_safe_sgn:
    `FUNCTION ef_safe_sgn# (x AS DOUBLE)\n` +
    `    IF x <> x THEN\n` +
    `        ef_safe_sgn# = x\n` +
    `    ELSEIF x = 0# THEN\n` +
    `        ef_safe_sgn# = x\n` +
    `    ELSE\n` +
    `        ef_safe_sgn# = SGN(x)\n` +
    `    END IF\n` +
    `END FUNCTION\n`,
    ef_safe_exp:
    `FUNCTION ef_safe_exp# (x AS DOUBLE)\n` +
    `    DIM ef_zero AS DOUBLE\n` +
    `    IF x <> x THEN\n` +
    `        ef_safe_exp# = x\n` +
    `    ELSEIF x > 709.782712893384# THEN\n` +
    `        ef_zero = 0#\n` +
    `        ef_safe_exp# = 1# / ef_zero\n` +
    `    ELSE\n` +
    `        ef_safe_exp# = EXP(x)\n` +
    `    END IF\n` +
    `END FUNCTION\n`,
    ef_safe_hypot:
    `FUNCTION ef_safe_hypot# (ef_a AS DOUBLE, ef_b AS DOUBLE)\n` +
    `    DIM ef_zero AS DOUBLE, ef_hi AS DOUBLE, ef_lo AS DOUBLE, ef_s AS DOUBLE, ef_r AS DOUBLE\n` +
    `    ef_zero = 0#\n` +
    `    ef_hi = ABS(ef_a)\n` +
    `    ef_lo = ABS(ef_b)\n` +
    `    ef_s = ef_hi * ef_hi + ef_lo * ef_lo\n` +
    `    IF ef_s < 1D300 AND ef_s > 1D-290 THEN\n` +
    `        ef_safe_hypot# = SQR(ef_s)\n` +
    `    ELSEIF ef_hi > 1.7976931348623157D308 OR ef_lo > 1.7976931348623157D308 THEN\n` +
    `        ef_safe_hypot# = 1# / ef_zero\n` +
    `    ELSEIF ef_hi <> ef_hi OR ef_lo <> ef_lo THEN\n` +
    `        ef_safe_hypot# = ef_zero / ef_zero\n` +
    `    ELSE\n` +
    `        IF ef_hi < ef_lo THEN SWAP ef_hi, ef_lo\n` +
    `        IF ef_hi = 0# THEN\n` +
    `            ef_safe_hypot# = 0#\n` +
    `        ELSE\n` +
    `            ef_r = ef_lo / ef_hi\n` +
    `            ef_safe_hypot# = ef_hi * SQR(1# + ef_r * ef_r)\n` +
    `        END IF\n` +
    `    END IF\n` +
    `END FUNCTION\n`,
    // _MIN/_MAX don't crash, but confirmed directly to be NaN-IGNORING
    // in a POSITION-DEPENDENT way, not a clean "always ignore" rule:
    // _MIN(nan,5#) returns NaN (first operand wins) while _MIN(5#,nan)
    // returns 5 -- same landmine class as Python's/Lua's builtins.
    // JS/Go/Java/C#/Julia/Scheme/Fortran instead propagate NaN through
    // min/max the way this project now standardizes on -- see
    // docs/adr/0003-min-max-nan-propagation.md. "a <> a" is the
    // self-inequality NaN test (an IEEE NaN never compares equal to
    // itself, and this project already confirmed QB64's own <>/=
    // translate correctly -- see emitSelect below), and the real
    // IF/THEN/ELSE *statement* genuinely short-circuits (see this
    // const's own header comment above) so there's no risk of _MIN/
    // _MAX itself ever running against a NaN it can't handle.
    ef_safe_min:
    `FUNCTION ef_safe_min# (ef_a AS DOUBLE, ef_b AS DOUBLE)\n` +
    `    DIM ef_zero AS DOUBLE\n` +
    `    IF ef_a <> ef_a OR ef_b <> ef_b THEN\n` +
    `        ef_zero = 0#\n` +
    `        ef_safe_min# = ef_zero / ef_zero\n` +
    `    ELSE\n` +
    `        ef_safe_min# = _MIN(ef_a, ef_b)\n` +
    `    END IF\n` +
    `END FUNCTION\n`,
    ef_safe_max:
    `FUNCTION ef_safe_max# (ef_a AS DOUBLE, ef_b AS DOUBLE)\n` +
    `    DIM ef_zero AS DOUBLE\n` +
    `    IF ef_a <> ef_a OR ef_b <> ef_b THEN\n` +
    `        ef_zero = 0#\n` +
    `        ef_safe_max# = ef_zero / ef_zero\n` +
    `    ELSE\n` +
    `        ef_safe_max# = _MAX(ef_a, ef_b)\n` +
    `    END IF\n` +
    `END FUNCTION\n`,
};

function helperBlock(used) {
    return used.map((h) => h.source + "\n").join("");
}

const emitter = new Emitter({
    ext: "bas",
    header: "' AUTO-GENERATED by ExprForge -- do not hand-edit.\n",
    frame: ({ header, helpers, bodies }) => header + helperBlock(helpers) + bodies.join("\n"),
    helpers: Object.fromEntries(
        Object.entries(SAFE_MATH_HELPERS).map(([name, source]) => [
            name,
            { source, deps: name === "ef_safe_trunc" ? ["ef_safe_floor"] : [] },
        ]),
    ),
    // JS renders very small/large magnitudes in exponential notation
    // (String(1e-9) === "1e-9"), and QB64 doesn't accept that combined
    // with a # suffix ("Invalid expression", confirmed against a real
    // compiler). Classic BASIC's own exponential form uses D (not E) as
    // the marker for a double-precision literal -- and needs no separate
    // # suffix, since D already says "double".
    formatNumber: (v) => {
        const s = String(v);
        return /e/i.test(s) ? s.replace(/e/i, "D") : `${s}#`;
    },
    calls: {
        // See SAFE_MATH_HELPERS' own comment above for exactly why these
        // three (plus asin/acos and log2/log10 below, which are built
        // from sqrt/log) route through a helper FUNCTION instead of the
        // classic keyword directly.
        sqrt: ([x]) => `ef_safe_sqr#(${x})`,
        abs: ([x]) => `ABS(${x})`,
        sin: ([x]) => `SIN(${x})`,
        cos: ([x]) => `COS(${x})`,
        tan: ([x]) => `TAN(${x})`,
        atan: ([x]) => `ATN(${x})`,
        exp: ([x]) => `ef_safe_exp#(${x})`,
        log: ([x]) => `ef_safe_log#(${x})`,
        sign: ([x]) => `ef_safe_sgn#(${x})`,
        min: ([a, b]) => `ef_safe_min#(${a}, ${b})`,
        max: ([a, b]) => `ef_safe_max#(${a}, ${b})`,
        // _ROUND ties to EVEN ("banker's rounding" -- confirmed against a
        // real compile: _ROUND(-0.5#) is 0, _ROUND(-1.5#) is -2), NOT
        // this project's standardized round-half-AWAY-from-zero
        // convention -- see js.js's own comment and the root README's
        // "round() at exact .5 boundaries" section. SGN/ABS/INT are the
        // same primitives this file's own sign:/abs:/floor: entries
        // already use.
        round: ([x]) => `ef_safe_round#(${x})`,
        pow: ([base, exp]) => `ef_safe_pow#(${base}, ${exp})`,
        asin: ([x]) => `ATN(${x} / ef_safe_sqr#(-(${x}) * (${x}) + 1#))`,
        acos: ([x]) => `(${HALF_PI} - ATN(${x} / ef_safe_sqr#(-(${x}) * (${x}) + 1#)))`,
        atan2: ([y, x]) => `_ATAN2(${y}, ${x})`,
        // The divisor (LOG(2#)/LOG(10#)) is a fixed positive constant,
        // always safe -- only the numerator (the actual argument) needs
        // the domain guard.
        log2: ([x]) => `(ef_safe_log#(${x}) / LOG(2#))`,
        log10: ([x]) => `(ef_safe_log#(${x}) / LOG(10#))`,
        floor: ([x]) => `ef_safe_floor#(${x})`,
        ceil: ([x]) => `(-ef_safe_floor#(-(${x})))`,
        trunc: ([x]) => `ef_safe_trunc#(${x})`,
        hypot: ([a, b]) => `ef_safe_hypot#(${a}, ${b})`,
        // QB64's MOD operator truncates both operands to LONG first --
        // wrong for a general modulo, so this is built from INT (already
        // confirmed to mean floor(), see the floor: template above) as a
        // real floating floor-mod instead of relying on MOD's integer
        // semantics/sign convention at all.
        wrapIndex: ([i, m]) => `((${i}) - (${m}) * INT((${i}) / (${m})))`,
        clampIndex: ([i, lo, hi]) => `_MAX(${lo}, _MIN(${hi}, ${i}))`,
    },
    // QB64 has no ternary operator. Comparison operators return -1 (true)
    // or 0 (false), so the algebraically equivalent expression is:
    //   (-1 * then) * cond + else * (1 + cond)
    // cond=-1 (true):  (-1*then)*-1 + else*0 = then
    // cond= 0 (false): (-1*then)* 0 + else*1 = else
    // Both `then` and `else` are always evaluated here (see select()'s
    // doc comment in ast.js) — same as every other target.
    //
    // cmp()'s op is one of ">" "<" ">=" "<=" "==" "!=" (ast.js) -- JS/C
    // spelling, which QB64/classic BASIC does NOT share for equality:
    // "==" and "!=" are both syntax errors there (confirmed against a
    // real qb64pe compile -- "Syntax error in argument list"), never
    // silently accepted or reinterpreted as something else. BASIC spells
    // these "=" and "<>" instead; ">" "<" ">=" "<=" are the same symbols
    // in both, so only the (in)equality pair needs translating. This was
    // unguarded for as long as select()/cmp() have existed -- every
    // sample that ever exercised this target's ternary emulation only
    // ever used ">" (see spline-frame.js), so nothing ever compiled a
    // "==)"/"!=" through a real QB64 compiler before this fix.
    emitSelect: function (condNode, thenStr, elseStr) {
        const L = this.emitExpr(condNode.left);
        const R = this.emitExpr(condNode.right);
        const op = condNode.op === "==" ? "=" : condNode.op === "!=" ? "<>" : condNode.op;
        const cond = `(${L} ${op} ${R})`;
        return `((-1# * ${thenStr}) * ${cond} + ${elseStr} * (1# + ${cond}))`;
    },
    // Array subscripts accept a numeric expression directly (QB64 rounds
    // to the nearest integer), so no explicit cast is needed here the
    // way most other targets need one -- but see the "index origin" note
    // on array parameters below, which is the real risk for this target.
    emitIndex: function (targetNode, atNode) {
        return `${this.emitExpr(targetNode)}(${this.emitExpr(atNode)})`;
    },
    formatFunction: (fn, body, letBindings = [], guardLines = [], opts = {}) => {
        checkReservedNames([fn.name, ...fn.params, ...letBindings.map((b) => b.name)]);
        // Array param: bare `()` -- QB64's dynamic-array-parameter syntax,
        // passed by reference, matching what spline_path.bi already does
        // by hand (`seaWps() As E3D_Coord`). Deliberately NOT reading
        // LBOUND/UBOUND anywhere in this emitter -- see
        // docs/array-index-primitives.md's "Index origin is a real,
        // unresolved risk" note: this project could not confirm LBOUND is
        // reliable at this call boundary, so generated code assumes the
        // caller passes an explicitly 0-based array
        // (DIM arr(0 TO n-1) AS DOUBLE) regardless of any OPTION BASE in
        // effect elsewhere in the caller's program. That's a documented
        // calling-convention requirement, not something this emitter can
        // verify or enforce.
        const params = fn.params.map((p) => `${p}${fn.paramTypes?.[p] === "number[]" ? "()" : ""} AS DOUBLE`).join(", ");
        // NOT `Dim name# AS DOUBLE`: combining the # sigil with an AS
        // DOUBLE clause on the same DIM is a syntax error in QB64
        // ("DIM: Expected ,") -- confirmed against a real compiler. Every
        // reference elsewhere is already the bare (unsuffixed) name (see
        // emitExpr's "var" case in base.js), so the fix is just dropping
        // the sigil here too, not adding it anywhere else.
        const lets = letBindings
            .map(({ name, valueStr }) => `    Dim ${name} AS DOUBLE : ${name} = ${valueStr}`)
            .join("\n");
        const letsBlock = lets ? lets + "\n" : "";
        const code = `FUNCTION ${fn.name}# (${params})\n` +
               letsBlock +
               `    ${fn.name}# = ${body}\n` +
               `END FUNCTION\n`;
        return code;
    },
    // Multiple named outputs from one call: QB64 has no struct/tuple return,
    // so this emits a SUB instead of a FUNCTION, with the outputs as
    // trailing parameters — SUB params are by reference by default in
    // QB64/BASIC, so assigning to them writes back to the caller's
    // variables. This is the classic BASIC multi-output idiom.
    formatSuite: (fn, outputStrs, letBindings = [], guardLines = [], opts = {}) => {
        const outputNames = Object.keys(outputStrs);
        checkReservedNames([fn.name, ...fn.params, ...outputNames, ...letBindings.map((b) => b.name)]);
        const inParams = fn.params.map((p) => `${p}${fn.paramTypes?.[p] === "number[]" ? "()" : ""} AS DOUBLE`);
        const outParams = outputNames.map((n) => `${n} AS DOUBLE`);
        // NOT `Dim name# AS DOUBLE`: combining the # sigil with an AS
        // DOUBLE clause on the same DIM is a syntax error in QB64
        // ("DIM: Expected ,") -- confirmed against a real compiler. Every
        // reference elsewhere is already the bare (unsuffixed) name (see
        // emitExpr's "var" case in base.js), so the fix is just dropping
        // the sigil here too, not adding it anywhere else.
        const lets = letBindings
            .map(({ name, valueStr }) => `    Dim ${name} AS DOUBLE : ${name} = ${valueStr}`)
            .join("\n");
        const letsBlock = lets ? lets + "\n" : "";
        const assigns = outputNames.map((n) => `    ${n} = ${outputStrs[n]}`).join("\n");
        const code = `SUB ${fn.name} (${[...inParams, ...outParams].join(", ")})\n` +
               letsBlock +
               `${assigns}\n` +
               `END SUB\n`;
        return code;
    },
});

// Per-target facts that registry-wide docs and tests read; field reference
// in emitters/meta.js.
emitter.meta = {
    displayName: "QB64",
    kind: "executable",
    testTarget: "QB64",
    ci: { workflow: "test-qb64.yml", badge: "QB64" },
    toolchain: {
        probes: [{ candidates: ["qb64pe"], args: null }],
        docs: {
            minimum: "QB64-PE (tested release)",
            tested: "v4.7.0-GLFW (exact tag)",
            notes: "Built from the release source bundle in CI.",
        },
    },
    guards: null,
    division: "(x / y)",
    cmp: { eq: "=", ne: "<>", forbidEq: "==", forbidNe: "!=" },
    roundTies: "even",
    selectShortCircuits: false,
    minMaxNaN: "positional",
};

emitter.lang = "qb64";
module.exports = emitter;
