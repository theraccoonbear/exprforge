// exprforge/emitters/go.js
const Emitter = require("./base.js");

function fn1(name) {
    return ([x]) => `math.${name}(${x})`;
}

function fn2(name) {
    return ([a, b]) => `math.${name}(${a}, ${b})`;
}

const emitter = new Emitter({
    ext: "go",
    // Same real bug class as c.js's formatNumber (see its comment): once
    // JS's own String() renders an integer-valued number in exponential
    // form (huge magnitudes, e.g. 1e250), unconditionally appending ".0"
    // produces "1e+250.0" -- not valid Go (a decimal point can't follow
    // the exponent in Go's float-literal grammar; the fraction has to
    // come BEFORE it, e.g. "1.0e250"). An already-exponential string is
    // already an unambiguous Go float literal on its own.
    formatNumber: (v) => {
        const s = String(v);
        if (/e/i.test(s)) return s;
        return Number.isInteger(v) ? `${s}.0` : s;
    },
    calls: {
        sqrt: fn1("Sqrt"), abs: fn1("Abs"), sin: fn1("Sin"), cos: fn1("Cos"), tan: fn1("Tan"),
        asin: fn1("Asin"), acos: fn1("Acos"), atan: fn1("Atan"), log: fn1("Log"),
        log2: fn1("Log2"), log10: fn1("Log10"), exp: fn1("Exp"), floor: fn1("Floor"),
        ceil: fn1("Ceil"), round: fn1("Round"), trunc: fn1("Trunc"),
        pow: fn2("Pow"), atan2: fn2("Atan2"), min: fn2("Min"), max: fn2("Max"), hypot: fn2("Hypot"),
        // NOT math.Copysign(1, x): that only reads the sign bit, so it
        // returns ±1 at x == 0 too, unlike JS's Math.sign(0) === 0 (and
        // C's/Java's sign, which both special-case zero). Found by the
        // kitchen-sink conformance test at exactly x - y == 0.
        sign: ([x]) => `func() float64 { if ${x} > 0.0 { return 1.0 }; if ${x} < 0.0 { return -1.0 }; return 0.0 }()`,
        // Go's `%` doesn't work on float64 at all (compile error) --
        // math.Mod is the float-capable equivalent (sign-of-dividend per
        // its own docs), so the double-application wrap still applies.
        // "math." substring is already what formatFunction's mathImport
        // detection greps for, so no separate import-detection change
        // needed here.
        wrapIndex: ([i, m]) => `(math.Mod(math.Mod(${i}, ${m}) + (${m}), ${m}))`,
        clampIndex: ([i, lo, hi]) => `math.Max(${lo}, math.Min(${hi}, ${i}))`,
    },
    // Go slice indexing requires an integer index type -- no implicit
    // float64-to-int conversion.
    emitIndex: function (targetNode, atNode) {
        return `${this.emitExpr(targetNode)}[int(${this.emitExpr(atNode)})]`;
    },
    // Go has no ternary operator at all (a deliberate language design
    // choice) and `if` is a statement, not an expression — so there's no
    // C-style `cond ? a : b` to fall back on. The standard idiom for an
    // inline conditional *expression* is an immediately-invoked anonymous
    // function; it's still one short-circuiting expression, so no change
    // needed elsewhere.
    emitSelect: function (condNode, thenStr, elseStr) {
        const L = this.emitExpr(condNode.left);
        const R = this.emitExpr(condNode.right);
        return `func() float64 { if ${L} ${condNode.op} ${R} { return ${thenStr} }; return ${elseStr} }()`;
    },
    formatFunction: (fn, body, letBindings = [], guardLines = [], opts = {}) => {
        const params = fn.params.map((p) => `${p} ${fn.paramTypes?.[p] === "number[]" ? "[]float64" : "float64"}`).join(", ");
        const lets = letBindings.map(({ name, valueStr }) => `\tvar ${name} float64 = ${valueStr}`).join("\n");
        // A let-chain can bind more names than any one function's body
        // reads (e.g. a shared chain computes ux/uy/uz for three sibling
        // single-component functions, each returning only one) — harmless
        // everywhere else, but Go treats an unused local as a hard compile
        // error, not a warning. Blank-discard every binding unconditionally
        // rather than tracking which ones a given body actually reaches.
        const guards = letBindings.map(({ name }) => `\t_ = ${name}`).join("\n");
        const letsBlock = lets ? lets + "\n" + guards + "\n" : "";
        // Only every emitter template here calls math.*, so this substring
        // check is exact: omit the import when neither the body nor any let
        // binding has a math call, or Go's "imported and not used" fails
        // the build.
        // opts.includeHelpers (see emitFunction's own doc comment in
        // base.js) -- default true, so today's single-function output is
        // byte-for-byte unchanged unless a caller opts out. Confirmed
        // directly (a real go build) that "package exprforge" repeated
        // is a hard compile error ("non-declaration statement outside
        // function body") for the same reason QB64's own
        // SAFE_MATH_HELPERS was reported broken -- concatenating N
        // functions into one .go file.
        //
        // The import, unlike QB64/COBOL's self-contained helper blocks,
        // needs more care: Go requires EVERY import to appear before any
        // other top-level declaration in the file (confirmed directly --
        // a LATER function's own "import \"math\"\n\n" is a syntax error
        // regardless of whether it duplicates an earlier one), so only
        // the ONE call carrying the package clause (includeHelpers:
        // true) can ever contribute an import -- a later function's own
        // math usage can't retroactively add one. This function's own
        // usesMath only reflects ITS OWN body, which is exactly right
        // for the single-function case but necessarily blind to what
        // any OTHER function being concatenated into the same file
        // needs. opts.forceMathImport lets a consumer who already knows
        // (they authored/generated every one of the N functions) that
        // at least one of them uses a math primitive say so explicitly,
        // overriding this call's own incomplete view -- see
        // docs/multi-function-files.md.
        const includeHelpers = opts.includeHelpers !== false;
        const usesMath = (body + lets).includes("math.");
        const mathImport = includeHelpers && (usesMath || opts.forceMathImport) ? `import "math"\n\n` : "";
        const packageBlock = includeHelpers ? `package exprforge\n\n` : "";
        return `// AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               packageBlock +
               mathImport +
               `func ${capitalize(fn.name)}(${params}) float64 {\n` +
               letsBlock +
               `\treturn ${body}\n` +
               `}\n`;
    },
    // Multiple named outputs from one call: Go's native multiple return
    // values. NOT named return values (`(rx, ry float64)`) even though
    // that reads nicer in the signature: those are sugar for pre-declared
    // locals in the function's own scope, which collides — a real,
    // hit-on-the-first-real-sample bug — whenever an output name matches
    // a let-binding name (e.g. a "rx" output alongside an internal "rx"
    // intermediate). Plain unnamed return types sidestep that whole class
    // of collision regardless of what any AST author names things; a
    // leading doc comment documents the order instead.
    formatSuite: (fn, outputStrs, letBindings = [], guardLinesUnused = [], opts = {}) => {
        const params = fn.params.map((p) => `${p} ${fn.paramTypes?.[p] === "number[]" ? "[]float64" : "float64"}`).join(", ");
        const lets = letBindings.map(({ name, valueStr }) => `\tvar ${name} float64 = ${valueStr}`).join("\n");
        const guards = letBindings.map(({ name }) => `\t_ = ${name}`).join("\n");
        const letsBlock = lets ? lets + "\n" + guards + "\n" : "";
        const outputNames = Object.keys(outputStrs);
        const returnTypes = outputNames.map(() => "float64").join(", ");
        const returnStmt = outputNames.map((n) => outputStrs[n]).join(", ");
        // See formatFunction's own comment above -- same
        // opts.includeHelpers/opts.forceMathImport reasoning.
        const includeHelpers = opts.includeHelpers !== false;
        const usesMath = (lets + returnStmt).includes("math.");
        const mathImport = includeHelpers && (usesMath || opts.forceMathImport) ? `import "math"\n\n` : "";
        const packageBlock = includeHelpers ? `package exprforge\n\n` : "";
        return `// AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               packageBlock +
               mathImport +
               `// Returns (${outputNames.join(", ")}).\n` +
               `func ${capitalize(fn.name)}(${params}) (${returnTypes}) {\n` +
               letsBlock +
               `\treturn ${returnStmt}\n` +
               `}\n`;
    },
});

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = emitter;
