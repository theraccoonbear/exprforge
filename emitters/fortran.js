// exprforge/emitters/fortran.js
const Emitter = require("./base.js");

// Fortran keywords/statement words plus every intrinsic this emitter's own
// calls table uses -- same role as QB64_RESERVED in emitters/qb64.js.
// Fortran is case-insensitive, so names are checked lowercased. Not
// exhaustive (Fortran has no fixed reserved-word list at all -- context
// determines meaning), but covers the words a generated variable/parameter/
// function name could plausibly collide with in practice.
const FORTRAN_RESERVED = new Set([
    "program", "subroutine", "function", "end", "implicit", "none",
    "real", "integer", "double", "precision", "complex", "logical", "character",
    "dimension", "intent", "in", "out", "inout", "result", "kind",
    "if", "then", "else", "elseif", "endif", "do", "while", "continue", "exit", "cycle",
    "select", "case", "where", "forall", "goto", "stop", "return", "call",
    "contains", "module", "use", "interface", "type", "class",
    "print", "write", "read", "format", "data", "parameter", "common", "equivalence",
    "allocate", "deallocate", "pointer", "target", "public", "private",
    "elemental", "pure", "recursive", "merge",
    "sqrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
    "log", "log10", "exp", "floor", "ceiling", "anint", "aint", "nint",
    "min", "max", "hypot", "sign", "mod", "len", "len_trim", "trim", "index",
]);

function checkReservedNames(names) {
    for (const name of names) {
        if (FORTRAN_RESERVED.has(name.toLowerCase())) {
            throw new Error(
                `emitter for .f90: "${name}" is a reserved Fortran keyword/intrinsic and can't be used as a ` +
                `function/variable/parameter name -- rename it (see FORTRAN_RESERVED in emitters/fortran.js)`,
            );
        }
    }
}

function fn1(name) {
    return ([x]) => `${name}(${x})`;
}

function fn2(name) {
    return ([a, b]) => `${name}(${a}, ${b})`;
}

const emitter = new Emitter({
    ext: "f90",
    // Fortran's D exponent marker (not E) forces a literal to be
    // double-precision regardless of context -- same reasoning as QB64's #
    // suffix/D marker (see qb64.js). Without it, a plain "3.14159" literal
    // is parsed as single precision FIRST, then widened -- silently losing
    // precision before it ever reaches a real(8) variable. Every literal
    // gets this, not just ones already in scientific notation.
    formatNumber: (v) => {
        const s = String(v);
        if (/e/i.test(s)) return s.replace(/e/i, "D");
        return s.includes(".") ? `${s}D0` : `${s}.0D0`;
    },
    calls: {
        sqrt: fn1("SQRT"), abs: fn1("ABS"), sin: fn1("SIN"), cos: fn1("COS"), tan: fn1("TAN"),
        asin: fn1("ASIN"), acos: fn1("ACOS"), atan: fn1("ATAN"), atan2: fn2("ATAN2"),
        log: fn1("LOG"), log10: fn1("LOG10"), exp: fn1("EXP"),
        pow: ([x, y]) => `(${x} ** ${y})`,
        min: fn2("MIN"), max: fn2("MAX"),
        // HYPOT is an F2008 intrinsic -- no need to derive it by hand.
        hypot: fn2("HYPOT"),
        // ANINT/AINT already return a REAL of the same kind as their
        // argument (confirmed: real(8) in, real(8) out) -- unlike
        // FLOOR/CEILING below, no conversion needed. ANINT rounds ties
        // away from zero, matching every other target here.
        round: fn1("ANINT"),
        trunc: fn1("AINT"),
        // FLOOR/CEILING return the default INTEGER kind, not REAL --
        // REAL(..., 8) converts back to double, matching this project's
        // float64-only model everywhere else (same reasoning as Python's
        // float(math.floor(...))).
        floor: ([x]) => `REAL(FLOOR(${x}), 8)`,
        ceil: ([x]) => `REAL(CEILING(${x}), 8)`,
        // No LOG2 intrinsic -- derive it.
        log2: ([x]) => `(LOG(${x}) / LOG(2.0D0))`,
        // The native SIGN(A, B) intrinsic ("magnitude of A, sign of B") is
        // NOT this project's sign(x) -- confirmed against a real compiler
        // that SIGN(1.0D0, 0.0D0) returns 1.0D0, not 0.0D0 (IEEE 754
        // treats +0.0 as positive-signed). Built from MERGE instead, same
        // zero-aware construction as every other emitter here that can't
        // trust its language's native sign function at exactly zero (see
        // Go's/Rust's sign() history in this project).
        sign: ([x]) => `MERGE(1.0D0, MERGE(-1.0D0, 0.0D0, (${x}) < 0.0D0), (${x}) > 0.0D0)`,
    },
    // Fortran has no ternary operator, but MERGE(TSOURCE, FSOURCE, MASK) is
    // exactly an expression-level conditional value-select -- confirmed
    // against a real compiler to behave like this project's select(), down
    // to evaluating both TSOURCE and FSOURCE regardless of MASK (elemental
    // intrinsics don't short-circuit), which matches select()'s own
    // "both branches always evaluated" contract (see ast.js) instead of
    // fighting it.
    emitSelect: function (condNode, thenStr, elseStr) {
        const L = this.emitExpr(condNode.left);
        const R = this.emitExpr(condNode.right);
        return `MERGE(${thenStr}, ${elseStr}, (${L}) ${condNode.op} (${R}))`;
    },
    formatFunction: (fn, body, letBindings = []) => {
        checkReservedNames([fn.name, ...fn.params, ...letBindings.map((b) => b.name)]);
        const params = fn.params.join(", ");
        const paramDecl = fn.params.length ? `    real(8), intent(in) :: ${fn.params.join(", ")}\n` : "";
        const letDecl = letBindings.length ? `    real(8) :: ${letBindings.map((b) => b.name).join(", ")}\n` : "";
        const letsBlock = letBindings.map(({ name, valueStr }) => `    ${name} = ${valueStr}`).join("\n");
        return `! AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `real(8) function ${fn.name}(${params})\n` +
               `    implicit none\n` +
               paramDecl +
               letDecl +
               (letsBlock ? letsBlock + "\n" : "") +
               `    ${fn.name} = ${body}\n` +
               `end function ${fn.name}\n`;
    },
    // Multiple named outputs from one call: a subroutine with the outputs
    // as trailing intent(out) parameters -- the same by-reference idiom
    // QB64's SUB uses (see qb64.js), Fortran's closest equivalent since it
    // has no native struct/tuple return either.
    formatSuite: (fn, outputStrs, letBindings = []) => {
        const outputNames = Object.keys(outputStrs);
        checkReservedNames([fn.name, ...fn.params, ...outputNames, ...letBindings.map((b) => b.name)]);
        const allParams = [...fn.params, ...outputNames].join(", ");
        const paramDecl = fn.params.length ? `    real(8), intent(in) :: ${fn.params.join(", ")}\n` : "";
        const outDecl = `    real(8), intent(out) :: ${outputNames.join(", ")}\n`;
        const letDecl = letBindings.length ? `    real(8) :: ${letBindings.map((b) => b.name).join(", ")}\n` : "";
        const letsBlock = letBindings.map(({ name, valueStr }) => `    ${name} = ${valueStr}`).join("\n");
        const assigns = outputNames.map((n) => `    ${n} = ${outputStrs[n]}`).join("\n");
        return `! AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `subroutine ${fn.name}(${allParams})\n` +
               `    implicit none\n` +
               paramDecl +
               outDecl +
               letDecl +
               (letsBlock ? letsBlock + "\n" : "") +
               `${assigns}\n` +
               `end subroutine ${fn.name}\n`;
    },
});

module.exports = emitter;
