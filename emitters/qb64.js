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

const emitter = new Emitter({
    ext: "bas",
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
        sqrt: ([x]) => `SQR(${x})`,
        abs: ([x]) => `ABS(${x})`,
        sin: ([x]) => `SIN(${x})`,
        cos: ([x]) => `COS(${x})`,
        tan: ([x]) => `TAN(${x})`,
        atan: ([x]) => `ATN(${x})`,
        exp: ([x]) => `EXP(${x})`,
        log: ([x]) => `LOG(${x})`,
        sign: ([x]) => `SGN(${x})`,
        min: ([a, b]) => `_MIN(${a}, ${b})`,
        max: ([a, b]) => `_MAX(${a}, ${b})`,
        // _ROUND ties to EVEN ("banker's rounding" -- confirmed against a
        // real compile: _ROUND(-0.5#) is 0, _ROUND(-1.5#) is -2), NOT
        // this project's standardized round-half-AWAY-from-zero
        // convention -- see js.js's own comment and the root README's
        // "round() at exact .5 boundaries" section. SGN/ABS/INT are the
        // same primitives this file's own sign:/abs:/floor: entries
        // already use.
        round: ([x]) => `(SGN(${x}) * INT(ABS(${x}) + 0.5))`,
        pow: ([base, exp]) => `(${base} ^ ${exp})`,
        asin: ([x]) => `ATN(${x} / SQR(-(${x}) * (${x}) + 1#))`,
        acos: ([x]) => `(${HALF_PI} - ATN(${x} / SQR(-(${x}) * (${x}) + 1#)))`,
        atan2: ([y, x]) => `_ATAN2(${y}, ${x})`,
        log2: ([x]) => `(LOG(${x}) / LOG(2#))`,
        log10: ([x]) => `(LOG(${x}) / LOG(10#))`,
        floor: ([x]) => `INT(${x})`,
        ceil: ([x]) => `(-INT(-(${x})))`,
        trunc: ([x]) => `(SGN(${x}) * INT(ABS(${x})))`,
        hypot: ([a, b]) => `SQR((${a}) * (${a}) + (${b}) * (${b}))`,
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
    formatFunction: (fn, body, letBindings = []) => {
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
        return `' AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `FUNCTION ${fn.name}# (${params})\n` +
               letsBlock +
               `    ${fn.name}# = ${body}\n` +
               `END FUNCTION\n`;
    },
    // Multiple named outputs from one call: QB64 has no struct/tuple return,
    // so this emits a SUB instead of a FUNCTION, with the outputs as
    // trailing parameters — SUB params are by reference by default in
    // QB64/BASIC, so assigning to them writes back to the caller's
    // variables. This is the classic BASIC multi-output idiom.
    formatSuite: (fn, outputStrs, letBindings = []) => {
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
        return `' AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `SUB ${fn.name} (${[...inParams, ...outParams].join(", ")})\n` +
               letsBlock +
               `${assigns}\n` +
               `END SUB\n`;
    },
});

module.exports = emitter;
