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

// Fortran free-form source has a real, standards-mandated 132-character
// line limit -- confirmed the hard way (a real compiler, "Line truncated
// ... [-Werror=line-truncation]") on samples/catmull-rom.js's one-line
// polynomial, which a different gfortran build/version apparently let
// through as a non-fatal warning during development, masking this until a
// stricter compiler caught it for real. A trailing `&` continues a
// statement onto the next line (confirmed against a real compiler) -- long
// lines get broken at word boundaries well under the actual limit.
function wrapLine(line, maxWidth = 100) {
    if (line.length <= maxWidth) return line;
    const words = line.split(" ");
    const wrapped = [];
    let current = "";
    for (const word of words) {
        if (current && current.length + 1 + word.length > maxWidth) {
            wrapped.push(`${current} &`);
            current = `        ${word}`;
        } else {
            current = current ? `${current} ${word}` : word;
        }
    }
    if (current) wrapped.push(current);
    return wrapped.join("\n");
}

// Array-typed params (see ast.js's paramTypes) get their own declaration
// line with `dimension(0:*)` -- an assumed-size, EXPLICITLY 0-based dummy
// array. Verified directly against a real compile (gfortran) that this
// reads the caller's first element as index 0 regardless of how the
// caller's own array was actually dimensioned (1-based, custom bounds,
// whatever) -- Fortran's argument-association rules only require the
// caller's array to have enough elements, never matching bounds. No
// count parameter needs to be referenced in the bounds expression at all
// (`*` needs no size), unlike a fixed-shape `dimension(0:n-1)` would.
// Scalar params stay grouped in one `real(8), intent(in) :: a, b, c` line
// exactly as before; array params get their own line per param, since
// each needs the `dimension` attribute the scalar line doesn't.
function paramDecls(params, paramTypes) {
    const scalars = params.filter((p) => paramTypes?.[p] !== "number[]");
    const arrays = params.filter((p) => paramTypes?.[p] === "number[]");
    const lines = [];
    if (scalars.length) lines.push(wrapLine(`    real(8), intent(in) :: ${scalars.join(", ")}`));
    for (const p of arrays) lines.push(wrapLine(`    real(8), dimension(0:*), intent(in) :: ${p}`));
    return lines.length ? lines.join("\n") + "\n" : "";
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
        // MODULO (not MOD -- that one follows the dividend's sign, like
        // C) is the Fortran standard's floor-mod intrinsic, result takes
        // the sign of the second argument -- the right one for this.
        // (Fortran arrays are 1-indexed by default -- handled where an
        // "index" node actually subscripts one, not here.)
        wrapIndex: fn2("MODULO"),
        clampIndex: ([i, lo, hi]) => `MAX(${lo}, MIN(${hi}, ${i}))`,
    },
    // Fortran array subscripts require INTEGER type -- REAL(8) isn't
    // accepted, unlike QB64's numeric-expression subscripts.
    emitIndex: function (targetNode, atNode) {
        return `${this.emitExpr(targetNode)}(INT(${this.emitExpr(atNode)}))`;
    },
    // Fortran has no ternary operator, but MERGE(TSOURCE, FSOURCE, MASK) is
    // exactly an expression-level conditional value-select -- confirmed
    // against a real compiler to behave like this project's select(), down
    // to evaluating both TSOURCE and FSOURCE regardless of MASK (elemental
    // intrinsics don't short-circuit), which matches select()'s own
    // "both branches always evaluated" contract (see ast.js) instead of
    // fighting it.
    // cmp()'s op is one of ">" "<" ">=" "<=" "==" "!=" (ast.js) -- modern
    // (F90+) Fortran's relational operators are spelled the same for
    // every one of those EXCEPT "!=", which isn't valid Fortran at all
    // (confirmed against a real gfortran compile -- "Syntax error in
    // argument list"); Fortran's own not-equal is "/=". "==" needs no
    // translation, unlike QB64's equivalent gap just above. This was
    // unguarded for as long as select()/cmp() have existed -- every
    // sample that ever exercised this target's MERGE() emulation only
    // ever used ">" (see spline-frame.js), so "!=" never actually
    // compiled through a real Fortran compiler before this fix.
    emitSelect: function (condNode, thenStr, elseStr) {
        const L = this.emitExpr(condNode.left);
        const R = this.emitExpr(condNode.right);
        const op = condNode.op === "!=" ? "/=" : condNode.op;
        return `MERGE(${thenStr}, ${elseStr}, (${L}) ${op} (${R}))`;
    },
    formatFunction: (fn, body, letBindings = []) => {
        checkReservedNames([fn.name, ...fn.params, ...letBindings.map((b) => b.name)]);
        const params = fn.params.join(", ");
        const paramDecl = paramDecls(fn.params, fn.paramTypes);
        const letDecl = letBindings.length
            ? wrapLine(`    real(8) :: ${letBindings.map((b) => b.name).join(", ")}`) + "\n"
            : "";
        const letsBlock = letBindings.map(({ name, valueStr }) => wrapLine(`    ${name} = ${valueStr}`)).join("\n");
        return `! AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               wrapLine(`real(8) function ${fn.name}(${params})`) + "\n" +
               `    implicit none\n` +
               paramDecl +
               letDecl +
               (letsBlock ? letsBlock + "\n" : "") +
               wrapLine(`    ${fn.name} = ${body}`) + "\n" +
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
        const paramDecl = paramDecls(fn.params, fn.paramTypes);
        const outDecl = wrapLine(`    real(8), intent(out) :: ${outputNames.join(", ")}`) + "\n";
        const letDecl = letBindings.length
            ? wrapLine(`    real(8) :: ${letBindings.map((b) => b.name).join(", ")}`) + "\n"
            : "";
        const letsBlock = letBindings.map(({ name, valueStr }) => wrapLine(`    ${name} = ${valueStr}`)).join("\n");
        const assigns = outputNames.map((n) => wrapLine(`    ${n} = ${outputStrs[n]}`)).join("\n");
        return `! AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               wrapLine(`subroutine ${fn.name}(${allParams})`) + "\n" +
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
