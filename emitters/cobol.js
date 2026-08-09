// exprforge/emitters/cobol.js
//
// Targets GnuCOBOL (free-format source, USAGE COMP-2 for double precision)
// -- see test/conformance.test.js for the exact `cobc` invocation this is
// verified against.
//
// select()/cmp() needed a genuinely different emission strategy than every
// other target here, because of one real, confirmed-by-compiling
// structural limit: GnuCOBOL has no expression-level conditional at all --
// no ternary, no Fortran-style MERGE(). A user-defined `FUNCTION-ID`
// module CAN be called from inside an expression (`FUNCTION name(...)`),
// which looks like a way to build one (a tiny "pick a branch" helper
// function) -- but confirmed against a real compile+run that GnuCOBOL 3.2
// silently miscomputes (no error, just a wrong/garbage numeric result)
// when such a call receives a COMPLEX argument, i.e. one containing its
// own nested FUNCTION call, rather than a bare variable or literal. Every
// real select() usage has exactly that shape (see
// samples/spline-frame.js, math/index.js's safeDiv/clamp/normalize3).
//
// The fix: six small helper FUNCTION-ID modules (one per comparator, EF_CMP
// below), always prepended to the emitted source, PLUS forcing every
// argument passed to them through its own COMPUTE into a fresh temp
// variable first -- confirmed safe, since a bare-variable-argument call to
// a user-defined FUNCTION-ID was the one case that worked correctly in
// testing. That turns emitSelect from a pure "node -> expression string"
// function (every other emitter's shape, including this file's own calls
// table) into a STATEFUL one that also spills COMPUTE statements -- see
// the CobolEmitter class below, which is the one thing in this file that
// isn't just config passed to `new Emitter(...)` like every other target.
//
// No FUNCTION ATAN2 exists in GnuCOBOL either (FUNCTION ATAN is
// 1-argument only), and the standard quadrant-corrected formula needs
// exactly this same branching -- built from the same select-hoisting
// machinery as select() itself, not a separate mechanism.
const Emitter = require("./base.js");

// COBOL reserved words plus every intrinsic-function name this emitter's
// calls table depends on -- same role as QB64_RESERVED in emitters/qb64.js.
// COBOL is case-insensitive, so names are checked lowercased. Not
// exhaustive (COBOL's real reserved-word list runs into the hundreds), but
// covers the words a generated variable/parameter/function name could
// plausibly collide with in practice.
const COBOL_RESERVED = new Set([
    "identification", "division", "program-id", "function-id", "environment",
    "configuration", "repository", "data", "working-storage", "linkage", "section",
    "procedure", "using", "returning", "intent", "usage", "comp-2", "value", "by",
    "reference", "content", "if", "else", "end-if", "compute", "move", "to", "call",
    "goback", "stop", "run", "display", "perform", "until", "end-perform", "and",
    "or", "not", "true", "false", "zero", "zeros", "zeroes", "spaces", "high-value",
    "low-value", "function", "sqrt", "abs", "sin", "cos", "tan", "asin", "acos",
    "atan", "exp", "log", "log10", "integer", "integer-part", "sign", "min", "max", "mod",
]);

function checkReservedNames(names) {
    for (const name of names) {
        if (COBOL_RESERVED.has(name.toLowerCase())) {
            throw new Error(
                `emitter for .cob: "${name}" is a reserved COBOL word/intrinsic and can't be used as a ` +
                `function/variable/parameter name -- rename it (see COBOL_RESERVED in emitters/cobol.js)`,
            );
        }
    }
}

// Separate from COBOL_RESERVED above (general keywords/intrinsics, safe
// to forbid everywhere including internal let-bindings) and checked only
// against names that end up in a CALL/PROCEDURE DIVISION USING clause
// (fn.name, params, output fields) -- NOT let-bindings. A bare "c"
// (case-insensitive) breaks specifically in a USING identifier list --
// confirmed against a real compiler ("syntax error, unexpected C"),
// reproducible in isolation, and not shared by neighboring single letters
// (b/d/e/... all compile fine in the identical position; likely GnuCOBOL
// misparsing it as an attempted abbreviation of BY CONTENT). Deliberately
// NOT added to COBOL_RESERVED: a plain WORKING-STORAGE item named "c"
// referenced only in COMPUTE statements compiles fine (confirmed too),
// and samples/spline-frame.js already has a working "c" let-binding (for
// cos(rad)) that would break for no real reason if this were checked
// there as well.
const COBOL_USING_RESERVED = new Set(["c"]);

function checkUsingClauseNames(names) {
    for (const name of names) {
        if (COBOL_USING_RESERVED.has(name.toLowerCase())) {
            throw new Error(
                `emitter for .cob: "${name}" can't be a function/parameter/output name -- it breaks ` +
                `GnuCOBOL's CALL ... USING clause specifically (confirmed against a real compiler), ` +
                `even though it's fine as an internal let-binding name (see COBOL_USING_RESERVED in ` +
                `emitters/cobol.js) -- rename it`,
            );
        }
    }
}

function fn1(name) {
    return ([x]) => `FUNCTION ${name}(${x})`;
}

function fn2(name) {
    return ([a, b]) => `FUNCTION ${name}(${a}, ${b})`;
}

// Only touches a bare (possibly negative) integer-literal operand string
// -- never a variable name, function call, or already-decimal literal, so
// this can't corrupt anything but the exact case it targets. Exists for
// "**" specifically: confirmed against real CI (not reproducible against
// this project's own dev machine's older GnuCOBOL) that some GnuCOBOL 4.x
// builds route "COMP-2 ** <bare integer literal>" through an internal
// arbitrary-precision decimal codegen path (cob_decimal_*) that a broken
// package build fails to declare a header for ("unknown type name
// 'cob_decimal'") -- variable**variable (see kitchen-sink's pow(x, y),
// which compiles fine there) doesn't hit it. Forcing the exponent to look
// like a real/decimal literal instead of an integer one avoids whichever
// codegen path that specific heuristic keys off.
function ensureDecimalLiteral(s) {
    return /^-?\d+$/.test(s) ? `${s}.0` : s;
}

// One helper FUNCTION-ID per comparator, each named ef-cmp-<suffix> --
// hyphenated, never underscored (confirmed against a real compiler that a
// user-defined FUNCTION call breaks on an underscored name -- see
// samples/spline-frame.js's "wy_wire" param for why that's not just a
// theoretical concern). "ne" uses NOT = rather than the symbolic <>,
// simply because NOT = is unambiguously standard COBOL and <> wasn't worth
// separately confirming for a helper this narrow.
const CMP_HELPERS = {
    ">": { suffix: "gt", test: "L > R" },
    "<": { suffix: "lt", test: "L < R" },
    ">=": { suffix: "ge", test: "L >= R" },
    "<=": { suffix: "le", test: "L <= R" },
    "==": { suffix: "eq", test: "L = R" },
    "!=": { suffix: "ne", test: "L NOT = R" },
};

// The REPOSITORY paragraph every caller of an ef-cmp-* helper needs --
// shared between formatFunction/formatSuite below, and terminated with a
// period only after the LAST entry (REPOSITORY is one sentence, not one
// statement per line -- confirmed against a real compiler that a missing
// trailing period here breaks the DATA DIVISION that follows).
const CMP_REPOSITORY =
    `       REPOSITORY.\n` +
    Object.values(CMP_HELPERS)
        .map(({ suffix }, i, arr) => `           FUNCTION ef-cmp-${suffix}${i === arr.length - 1 ? "." : ""}`)
        .join("\n") +
    "\n";

const CMP_HELPER_SOURCE = Object.values(CMP_HELPERS)
    .map(
        ({ suffix, test }) => `       IDENTIFICATION DIVISION.
       FUNCTION-ID. ef-cmp-${suffix}.
       DATA DIVISION.
       LINKAGE SECTION.
       01 L USAGE COMP-2.
       01 R USAGE COMP-2.
       01 THEN-VAL USAGE COMP-2.
       01 ELSE-VAL USAGE COMP-2.
       01 RESULT USAGE COMP-2.
       PROCEDURE DIVISION USING L R THEN-VAL ELSE-VAL RETURNING RESULT.
           IF ${test}
               MOVE THEN-VAL TO RESULT
           ELSE
               MOVE ELSE-VAL TO RESULT
           END-IF
           GOBACK.
       END FUNCTION ef-cmp-${suffix}.
`,
    )
    .join("\n");

// GnuCOBOL caps physical source line length (confirmed against a real
// compiler: "source text exceeds 512 bytes, will be truncated", on
// samples/kitchen-sink.js's single expression summing all 22 Math
// functions -- the one AST big enough to ever hit this). Free-format
// COBOL allows a statement to simply continue on the next line with no
// continuation marker (confirmed against a real compiler), so a long line
// just gets broken at word boundaries, well under the real limit.
function wrapLine(line, maxWidth = 100) {
    if (line.length <= maxWidth) return line;
    const words = line.split(" ");
    const wrapped = [];
    let current = "";
    for (const word of words) {
        if (current && current.length + 1 + word.length > maxWidth) {
            wrapped.push(current);
            current = `               ${word}`;
        } else {
            current = current ? `${current} ${word}` : word;
        }
    }
    if (current) wrapped.push(current);
    return wrapped.join("\n");
}

// A small stateful pool that emitSelect below uses to hoist arguments into
// fresh temp variables before ever calling an ef-cmp-* helper -- see the
// file header for why that's required, not optional. Reset once per
// top-level emitExpr call (one per let-binding, one per output field, one
// for a select-free body) so temp declarations only need to cover what
// that one statement actually produced -- but the NAME counter itself is
// shared (passed in, not owned) across every pool created in one
// emitFunction call. Confirmed the hard way: an earlier version gave each
// pool its own counter starting at 0, so two different let-bindings could
// each mint an "ef-tmp-0", and GnuCOBOL correctly rejected the resulting
// duplicate WORKING-STORAGE declaration as "ambiguous; needs
// qualification".
class TempPool {
    constructor(counter) {
        this.counter = counter;
        this.lines = [];
        this.decls = [];
    }

    // Spills `valueStr` into a freshly named temp, recording both the
    // COMPUTE that sets it and the 01-level declaration it'll need, and
    // returns the bare name -- always safe to pass to a user-defined
    // FUNCTION-ID call, unlike valueStr itself.
    spill(valueStr) {
        const name = `ef-tmp-${this.counter.next++}`;
        this.decls.push(name);
        this.lines.push(wrapLine(`           COMPUTE ${name} = ${valueStr}`));
        return name;
    }
}

class CobolEmitter extends Emitter {
    emitFunction(fn) {
        const { collectLets } = require("../ast.js");
        const { bindings, body } = collectLets(fn.body);
        const counter = { next: 0 };

        const letLines = [];
        const letDecls = [];
        for (const { name, node } of bindings) {
            checkReservedNames([name]);
            this._pool = new TempPool(counter);
            const valueStr = this.emitExpr(node);
            letLines.push(...this._pool.lines);
            letDecls.push(...this._pool.decls, name);
            letLines.push(wrapLine(`           COMPUTE ${name} = ${valueStr}`));
        }

        if (body.type === "outputs") {
            if (!this.formatSuiteImpl) {
                throw new Error(`emitter for .${this.ext}: no formatSuite configured -- multi-output suites aren't supported for this target yet`);
            }
            const outputStrs = {};
            const outputLines = [];
            for (const [name, node] of Object.entries(body.fields)) {
                this._pool = new TempPool(counter);
                outputStrs[name] = this.emitExpr(node);
                outputLines.push(...this._pool.lines);
                letDecls.push(...this._pool.decls);
            }
            return this.formatSuiteImpl(fn, outputStrs, letLines, letDecls, outputLines);
        }

        this._pool = new TempPool(counter);
        const bodyStr = this.emitExpr(body);
        const bodyLines = this._pool.lines;
        letDecls.push(...this._pool.decls);
        return this.formatFunctionImpl(fn, bodyStr, letLines, letDecls, bodyLines);
    }
}

// JS renders very small/large magnitudes in exponential notation
// (String(1e-9) === "1e-9"), and COBOL numeric literals don't accept that
// syntax at all -- confirmed against a real compiler ("'1e-9' is not
// defined"). Expanded to plain decimal digit-by-digit instead of via
// toFixed(): toFixed(20) reveals a binary float's true (imprecise) decimal
// expansion for values like 4.2 ("4.20000000000000017764"), where this
// instead shifts the SAME shortest-round-trip digits String(v) already
// picked, so e.g. 1e-9 becomes exactly "0.000000001", nothing more.
function expandExponential(s) {
    const m = s.match(/^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i);
    if (!m) return s;
    const [, sign, intPart, fracPart = "", expStr] = m;
    const digits = intPart + fracPart;
    const pointPos = intPart.length + Number(expStr);
    let result;
    if (pointPos <= 0) {
        result = `0.${"0".repeat(-pointPos)}${digits}`;
    } else if (pointPos >= digits.length) {
        result = `${digits}${"0".repeat(pointPos - digits.length)}`;
    } else {
        result = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
    }
    return sign + result;
}

const emitter = new CobolEmitter({
    ext: "cob",
    formatNumber: (v) => {
        const s = String(v);
        return /e/i.test(s) ? expandExponential(s) : s;
    },
    calls: {
        sqrt: fn1("SQRT"), abs: fn1("ABS"), sin: fn1("SIN"), cos: fn1("COS"), tan: fn1("TAN"),
        asin: fn1("ASIN"), acos: fn1("ACOS"), atan: fn1("ATAN"),
        exp: fn1("EXP"), log: fn1("LOG"), log10: fn1("LOG10"),
        min: fn2("MIN"), max: fn2("MAX"),
        pow: ([x, y]) => `(${ensureDecimalLiteral(x)} ** ${ensureDecimalLiteral(y)})`,
        // No LOG2 intrinsic -- derive it (nesting two intrinsics is fine;
        // only nesting a call inside a USER-DEFINED function's argument
        // was the confirmed problem -- see the file header).
        log2: ([x]) => `(FUNCTION LOG(${x}) / FUNCTION LOG(2.0))`,
        // No HYPOT intrinsic -- derive it the same way.
        hypot: ([a, b]) => `FUNCTION SQRT((${a}) ** 2 + (${b}) ** 2)`,
        // FUNCTION INTEGER is floor (greatest integer <= x, confirmed
        // against a real compiler, including for negatives). COMPUTE's
        // automatic numeric conversion hands it back as COMP-2 with no
        // explicit cast needed, unlike Fortran's REAL(..., 8) wrap.
        floor: fn1("INTEGER"),
        // No CEILING intrinsic -- negate, floor, negate back. Confirmed:
        // ceil(2.2)=3, ceil(-2.2)=-2.
        ceil: ([x]) => `(0 - FUNCTION INTEGER(0 - (${x})))`,
        // FUNCTION INTEGER-PART truncates toward zero directly -- confirmed
        // against a real compiler (2.7->2, -2.7->-2), no derivation needed.
        trunc: fn1("INTEGER-PART"),
        // No ROUND-as-an-expression intrinsic (COBOL's ROUNDED is a
        // COMPUTE/ADD statement modifier, not composable inline). Built
        // from FUNCTION SIGN and FUNCTION INTEGER instead -- both purely
        // intrinsic, so unlike select() this doesn't need the hoisting
        // machinery at all. GnuCOBOL's FUNCTION SIGN is 1-argument
        // (SIGN(x) -> -1/0/1), NOT Fortran's 2-argument SIGN(A,B)
        // "magnitude of A, sign of B" -- confirmed the hard way (a first
        // version of this formula copied Fortran's 2-arg convention here
        // by mistake and got "FUNCTION 'SIGN' has wrong number of
        // arguments" from a real compiler). Also unlike Fortran's SIGN,
        // confirmed zero-safe (SIGN(0.0) == 0.0 for real, not just by
        // accident of a multiplied-away wrong case), so this needs no
        // separate correction the way Fortran's round() does. Rounds ties
        // away from zero, matching every other target here.
        round: ([x]) => `(FUNCTION SIGN(${x}) * FUNCTION INTEGER(FUNCTION ABS(${x}) + 0.5))`,
        // Confirmed zero-safe against a real compiler (SIGN(0.0) == 0.0,
        // unlike Fortran's identically-named but 2-argument intrinsic --
        // see round() above) -- no hoisting/spilling machinery needed,
        // unlike every other emitter here that has to hand-build this.
        sign: fn1("SIGN"),
        // No FUNCTION ATAN2 -- the standard quadrant-corrected formula,
        // built from ef-cmp-* the same way select() itself composes them
        // (see emitSelect below). EVERY argument to EVERY ef-cmp-* call
        // must be a bare, already-spilled name -- including ones built
        // from ANOTHER ef-cmp-* call's result -- since a nested
        // `FUNCTION ef-cmp-x(...)` used directly as an argument to another
        // `FUNCTION ef-cmp-y(...)` hits the exact same confirmed bug as a
        // nested intrinsic call would (see the file header); the first
        // version of this formula got that wrong (nested an ef-cmp-lt
        // call straight into ef-cmp-gt's argument list) and silently
        // computed garbage, caught only by actually compiling and running
        // it. So: absolutely nothing here is inlined -- every intermediate
        // result, including literals, gets its own spill() first.
        //
        // Arrow function, not a plain one: base.js's emitExpr calls
        // `this.calls[node.name](args)` unbound (unlike emitSelectImpl,
        // which the Emitter constructor explicitly .bind(this)s) -- an
        // arrow here closes over the `emitter` const below by reference
        // instead, which is fully assigned by the time this ever actually
        // runs (during some later emitFunction call), even though it's
        // referenced before that `const` is declared in this same object
        // literal.
        atan2: (args) => {
            const [yRaw, xRaw] = args;
            const pool = emitter._pool;
            const y = pool.spill(yRaw);
            const x = pool.spill(xRaw);
            const atanYX = pool.spill(`FUNCTION ATAN(${y} / ${x})`);
            const zero = pool.spill("0.0");
            const piOver2 = pool.spill("1.5707963267948966");
            const negPiOver2 = pool.spill("-1.5707963267948966");
            const atanPlusPi = pool.spill(`(${atanYX} + 3.141592653589793)`);
            const atanMinusPi = pool.spill(`(${atanYX} - 3.141592653589793)`);
            // x == 0 case: sign of y (0 conventionally maps to 0.0, same
            // convention JS's/Python's atan2(0,0) use).
            const yNegSubcase = pool.spill(`FUNCTION ef-cmp-lt(${y}, ${zero}, ${negPiOver2}, ${zero})`);
            const xZeroCase = pool.spill(`FUNCTION ef-cmp-gt(${y}, ${zero}, ${piOver2}, ${yNegSubcase})`);
            // x < 0 case: quadrant-corrected by the sign of y.
            const xNegCase = pool.spill(`FUNCTION ef-cmp-ge(${y}, ${zero}, ${atanPlusPi}, ${atanMinusPi})`);
            const xNegOrZeroCase = pool.spill(`FUNCTION ef-cmp-lt(${x}, ${zero}, ${xNegCase}, ${xZeroCase})`);
            return `FUNCTION ef-cmp-gt(${x}, ${zero}, ${atanYX}, ${xNegOrZeroCase})`;
        },
    },
    // See the file header and TempPool above for why this spills into
    // temps instead of nesting inline: a user-defined FUNCTION-ID call
    // (ef-cmp-*) confirmed miscomputes when given a complex argument, so
    // every one of L/R/then/else gets its own COMPUTE into a fresh temp
    // first, and the picker call itself only ever receives bare names.
    emitSelect: function (condNode, thenStr, elseStr) {
        const { suffix } = CMP_HELPERS[condNode.op];
        const L = this._pool.spill(this.emitExpr(condNode.left));
        const R = this._pool.spill(this.emitExpr(condNode.right));
        const thenTmp = this._pool.spill(thenStr);
        const elseTmp = this._pool.spill(elseStr);
        return `FUNCTION ef-cmp-${suffix}(${L}, ${R}, ${thenTmp}, ${elseTmp})`;
    },
    // Both the scalar and suite cases use the SAME convention: a callable
    // PROGRAM-ID with every output (the single return value, or every
    // outputs() field) as a trailing BY REFERENCE parameter -- COBOL's
    // default parameter-passing mode, confirmed reliable (BY VALUE is
    // explicitly flagged "unfinished" by a real GnuCOBOL compile). This
    // also sidesteps a second confirmed rough edge: calling a FUNCTION-ID
    // module by name (`FUNCTION word(...)`) breaks if that name contains
    // an underscore (confirmed against a real compiler -- see e.g.
    // samples/spline-frame.js's "wy_wire" param), while CALL "name" takes
    // the program name as a plain string literal, immune to that.
    formatFunction: (fn, body, letLines, letDecls, bodyLines) => {
        checkReservedNames([fn.name, ...fn.params]);
        checkUsingClauseNames([fn.name, ...fn.params]);
        const linkageParams = [...fn.params, "ef-result"];
        const paramDecls = linkageParams.map((p) => `       01 ${p} USAGE COMP-2.`).join("\n");
        const wsDecls = letDecls.map((n) => `       01 ${n} USAGE COMP-2.`).join("\n");
        return `       >>SOURCE FORMAT FREE\n` +
               `      *> AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               CMP_HELPER_SOURCE + "\n" +
               `       IDENTIFICATION DIVISION.\n` +
               `       PROGRAM-ID. ${fn.name}.\n` +
               `       ENVIRONMENT DIVISION.\n` +
               `       CONFIGURATION SECTION.\n` +
               CMP_REPOSITORY +
               `       DATA DIVISION.\n` +
               (wsDecls ? `       WORKING-STORAGE SECTION.\n${wsDecls}\n` : "") +
               `       LINKAGE SECTION.\n` +
               paramDecls + "\n" +
               `       PROCEDURE DIVISION USING ${linkageParams.join(" ")}.\n` +
               [...letLines, ...bodyLines].join("\n") + (letLines.length || bodyLines.length ? "\n" : "") +
               wrapLine(`           COMPUTE ef-result = ${body}`) + "\n" +
               `           GOBACK.\n` +
               `       END PROGRAM ${fn.name}.\n`;
    },
    formatSuite: (fn, outputStrs, letLines, letDecls, outputLines) => {
        const outputNames = Object.keys(outputStrs);
        checkReservedNames([fn.name, ...fn.params, ...outputNames]);
        checkUsingClauseNames([fn.name, ...fn.params, ...outputNames]);
        const linkageParams = [...fn.params, ...outputNames];
        const paramDecls = linkageParams.map((p) => `       01 ${p} USAGE COMP-2.`).join("\n");
        const wsDecls = letDecls.map((n) => `       01 ${n} USAGE COMP-2.`).join("\n");
        const assigns = outputNames.map((n) => wrapLine(`           COMPUTE ${n} = ${outputStrs[n]}`)).join("\n");
        return `       >>SOURCE FORMAT FREE\n` +
               `      *> AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               CMP_HELPER_SOURCE + "\n" +
               `       IDENTIFICATION DIVISION.\n` +
               `       PROGRAM-ID. ${fn.name}.\n` +
               `       ENVIRONMENT DIVISION.\n` +
               `       CONFIGURATION SECTION.\n` +
               CMP_REPOSITORY +
               `       DATA DIVISION.\n` +
               (wsDecls ? `       WORKING-STORAGE SECTION.\n${wsDecls}\n` : "") +
               `       LINKAGE SECTION.\n` +
               paramDecls + "\n" +
               `       PROCEDURE DIVISION USING ${linkageParams.join(" ")}.\n` +
               (letLines.length ? letLines.join("\n") + "\n" : "") +
               (outputLines.length ? outputLines.join("\n") + "\n" : "") +
               assigns + "\n" +
               `           GOBACK.\n` +
               `       END PROGRAM ${fn.name}.\n`;
    },
});

module.exports = emitter;
