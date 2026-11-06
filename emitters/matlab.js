// exprforge/emitters/matlab.js
//
// MATLAB / GNU Octave target. The emitted source deliberately stays inside
// the subset that behaves identically in both: end-terminated functions,
// `~=` for inequality, `||` / `if` on scalars, no ternary, no `endfunction`
// / `printf`-only / `!=` Octave extensions. CI exercises it with Octave only
// (test/conformance.test.js, .github/workflows/test-octave.yml); MATLAB
// itself is not available there, so MATLAB compatibility rests on keeping to
// that shared subset and is not machine-verified.
const Emitter = require("./base.js");

// MATLAB keywords plus every builtin / helper name this emitter's own calls
// table emits as a bare call. A parameter or let-binding with one of these
// names would shadow the function and turn `abs(x)` into an index
// expression, so a collision fails at emission time instead.
const MATLAB_RESERVED = new Set([
    "break", "case", "catch", "classdef", "continue", "else", "elseif", "end",
    "for", "function", "global", "if", "otherwise", "parfor", "persistent",
    "return", "spmd", "switch", "try", "while",
    "abs", "sin", "cos", "tan", "atan", "atan2", "exp", "floor", "ceil",
    "round", "fix", "mod", "hypot", "sign", "log", "log2", "log10",
    "sqrt", "asin", "acos", "min", "max", "nan", "inf",
]);

function checkReservedNames(names) {
    for (const name of names) {
        if (MATLAB_RESERVED.has(name.toLowerCase()) || /^ef_/.test(name)) {
            throw new Error(
                `emitter for .m: "${name}" is a reserved MATLAB/Octave keyword, builtin or ExprForge helper ` +
                `name and can't be used as a function/variable/parameter name -- rename it ` +
                `(see MATLAB_RESERVED in emitters/matlab.js)`,
            );
        }
    }
}

// Shared helpers, emitted as local functions AFTER the main function (the
// first function in a MATLAB function file is the file's public entry
// point, so the helpers must never come first). Why each exists:
//
// - sqrt/log/log2/log10/asin/acos/pow: MATLAB and Octave return a COMPLEX
//   number for an out-of-domain real argument (sqrt(-1) is 0+1i), which
//   this project's domain-error convention forbids (NaN / -Infinity, see
//   docs/adr/0002-domain-error-handling.md). Real `if` statements guard
//   them, so the native call never runs on an out-of-domain value.
// - min/max: MATLAB and Octave IGNORE a NaN operand (min(NaN, 5) is 5),
//   unlike this project's NaN-propagating convention (see
//   docs/adr/0003-min-max-nan-propagation.md).
// - select: MATLAB has no conditional expression. A function with a real
//   `if` statement picks one of the already-computed values exactly, so an
//   Inf/NaN in the untaken branch cannot leak into the result (arithmetic
//   emulation like c*a + (1-c)*b turns 0*Inf into NaN). Both branches are
//   still evaluated as arguments, like every other target (see select()'s
//   doc comment in ast.js). `[b, a](1 + c)` would avoid a helper but
//   indexing a literal directly is a syntax error in MATLAB.
//
// Names are all prefixed ef_ so they can't collide with a user parameter
// (checkReservedNames rejects that prefix).
const HELPERS = {
    ef_sqrt:
        `function ef_r = ef_sqrt(ef_x)\n` +
        `    if ef_x < 0\n` +
        `        ef_r = NaN;\n` +
        `    else\n` +
        `        ef_r = sqrt(ef_x);\n` +
        `    end\n` +
        `end\n`,
    ef_sign:
        `function ef_r = ef_sign(ef_x)\n` +
        `    if ef_x == 0\n` +
        `        ef_r = ef_x;\n` +
        `    else\n` +
        `        ef_r = sign(ef_x);\n` +
        `    end\n` +
        `end\n`,
    ef_pow:
        `function ef_r = ef_pow(ef_x, ef_y)\n` +
        `    if ef_x < 0 && ef_y ~= fix(ef_y)\n` +
        `        ef_r = NaN;\n` +
        `    elseif ef_x < 0\n` +
        `        ef_r = (-ef_x) ^ ef_y;\n` +
        `        if mod(ef_y, 2) == 1\n` +
        `            ef_r = -ef_r;\n` +
        `        end\n` +
        `    else\n` +
        `        ef_r = ef_x ^ ef_y;\n` +
        `    end\n` +
        `end\n`,
    ef_select:
        `function ef_r = ef_select(ef_c, ef_a, ef_b)\n` +
        `    if ef_c\n` +
        `        ef_r = ef_a;\n` +
        `    else\n` +
        `        ef_r = ef_b;\n` +
        `    end\n` +
        `end\n`,
};
for (const f of ["log", "log2", "log10"]) {
    HELPERS[`ef_${f}`] =
        `function ef_r = ef_${f}(ef_x)\n` +
        `    if ef_x > 0\n` +
        `        ef_r = ${f}(ef_x);\n` +
        `    elseif ef_x == 0\n` +
        `        ef_r = -Inf;\n` +
        `    else\n` +
        `        ef_r = NaN;\n` +
        `    end\n` +
        `end\n`;
}
for (const f of ["asin", "acos"]) {
    HELPERS[`ef_${f}`] =
        `function ef_r = ef_${f}(ef_x)\n` +
        `    if ef_x >= -1 && ef_x <= 1\n` +
        `        ef_r = ${f}(ef_x);\n` +
        `    else\n` +
        `        ef_r = NaN;\n` +
        `    end\n` +
        `end\n`;
}
for (const f of ["min", "max"]) {
    HELPERS[`ef_${f}`] =
        `function ef_r = ef_${f}(ef_a, ef_b)\n` +
        `    if ef_a ~= ef_a || ef_b ~= ef_b\n` +
        `        ef_r = NaN;\n` +
        `    else\n` +
        `        ef_r = ${f}(ef_a, ef_b);\n` +
        `    end\n` +
        `end\n`;
}

const HELPER_ORDER = [
    "ef_sqrt", "ef_log", "ef_log2", "ef_log10", "ef_asin", "ef_acos",
    "ef_pow", "ef_sign", "ef_min", "ef_max", "ef_select",
];

function indentLets(letBindings) {
    const lets = letBindings.map(({ name, valueStr }) => `    ${name} = ${valueStr};`).join("\n");
    return lets ? lets + "\n" : "";
}

const emitter = new Emitter({
    ext: "m",
    header: "% AUTO-GENERATED by ExprForge -- do not hand-edit.\n",
    // A file of several functions is an Octave script file (a leading `1;`
    // lets source() run the later functions); MATLAB exposes only the first
    // function of a file, so MATLAB callers emit one function per file.
    // Support helpers are local functions at the end of the file.
    frame: ({ header, helpers, bodies, file }) =>
        header + (file && bodies.length > 1 ? "1;\n" : "") + bodies.join("\n") + helpers.map((h) => "\n" + h.source).join(""),
    helpers: Object.fromEntries(HELPER_ORDER.map((name) => [name, { source: HELPERS[name], deps: [] }])),
    // JS's shortest round-trip rendering is valid MATLAB/Octave literal
    // syntax, including exponent forms ("1e-9", "1e+21"), and keeps the full
    // double value; no suffix is needed (every numeric literal is double).
    formatNumber: (v) => String(v),
    calls: {
        sqrt: ([x]) => `ef_sqrt(${x})`,
        abs: ([x]) => `abs(${x})`,
        sin: ([x]) => `sin(${x})`,
        cos: ([x]) => `cos(${x})`,
        tan: ([x]) => `tan(${x})`,
        asin: ([x]) => `ef_asin(${x})`,
        acos: ([x]) => `ef_acos(${x})`,
        atan: ([x]) => `atan(${x})`,
        atan2: ([y, x]) => `atan2(${y}, ${x})`,
        log: ([x]) => `ef_log(${x})`,
        log2: ([x]) => `ef_log2(${x})`,
        log10: ([x]) => `ef_log10(${x})`,
        exp: ([x]) => `exp(${x})`,
        pow: ([x, y]) => `ef_pow(${x}, ${y})`,
        floor: ([x]) => `floor(${x})`,
        ceil: ([x]) => `ceil(${x})`,
        // round() is native round-half-away-from-zero in both MATLAB and
        // Octave -- exactly this project's convention, no derivation needed.
        round: ([x]) => `round(${x})`,
        // fix() is truncation toward zero.
        trunc: ([x]) => `fix(${x})`,
        // Native sign(-0) is +0; ef_sign returns the zero itself so -0
        // stays -0, matching Math.sign. sign(NaN) is NaN natively.
        sign: ([x]) => `ef_sign(${x})`,
        min: ([a, b]) => `ef_min(${a}, ${b})`,
        max: ([a, b]) => `ef_max(${a}, ${b})`,
        hypot: ([a, b]) => `hypot(${a}, ${b})`,
        // ((i % m) + m) % m with the truncated remainder rem(), exactly as
        // the interpreter computes it. mod() is not used: mod(i, 0) is i,
        // where the interpreter (and rem(i, 0)) yields NaN.
        wrapIndex: ([i, m]) => `rem(rem(${i}, ${m}) + ${m}, ${m})`,
        clampIndex: ([i, lo, hi]) => `ef_max(${lo}, ef_min(${hi}, ${i}))`,
    },
    // MATLAB subscripts are 1-based and must be integer-valued; round()
    // absorbs floating imprecision (same approach as Julia's emitter).
    emitIndex: function (targetNode, atNode) {
        return `${this.emitExpr(targetNode)}(round(${this.emitExpr(atNode)}) + 1)`;
    },
    // cmp()'s op is one of ">" "<" ">=" "<=" "==" "!=" (ast.js). MATLAB
    // spells inequality "~=" (Octave also accepts "!=", MATLAB does not);
    // the other five are identical.
    emitSelect: function (condNode, thenStr, elseStr) {
        const L = this.emitExpr(condNode.left);
        const R = this.emitExpr(condNode.right);
        const op = condNode.op === "!=" ? "~=" : condNode.op;
        return `ef_select((${L} ${op} ${R}), ${thenStr}, ${elseStr})`;
    },
    typeGuard: (p, fnName) =>
        `if ~isnumeric(${p}) || ~isvector(${p}); error('${fnName}: "${p}" must be an array'); end`,
    lengthGuard: (p, lenP, fnName) =>
        `if numel(${p}) ~= ${lenP}; error('${fnName}: length("${p}") must equal "${lenP}"'); end`,
    formatFunction: (fn, body, letBindings = [], guardLines = [], opts = {}) => {
        checkReservedNames([fn.name, ...fn.params, ...letBindings.map((b) => b.name)]);
        const guards = guardLines.map((l) => `    ${l}`).join("\n");
        const source = `function ef_result = ${fn.name}(${fn.params.join(", ")})\n` +
               (guards ? guards + "\n" : "") +
               indentLets(letBindings) +
               `    ef_result = ${body};\n` +
               `end\n`;
        return source;
    },
    // Multiple named outputs from one call: MATLAB's native multiple return
    // values, `function [a, b] = f(...)`, called as `[a, b] = f(...)`.
    formatSuite: (fn, outputStrs, letBindings = [], guardLines = [], opts = {}) => {
        const outputNames = Object.keys(outputStrs);
        checkReservedNames([fn.name, ...fn.params, ...outputNames, ...letBindings.map((b) => b.name)]);
        const guards = guardLines.map((l) => `    ${l}`).join("\n");
        const assigns = outputNames.map((n) => `    ${n} = ${outputStrs[n]};`).join("\n");
        const source = `function [${outputNames.join(", ")}] = ${fn.name}(${fn.params.join(", ")})\n` +
               (guards ? guards + "\n" : "") +
               indentLets(letBindings) +
               `${assigns}\n` +
               `end\n`;
        return source;
    },
});

module.exports = emitter;
