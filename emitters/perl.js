// exprforge/emitters/perl.js
const Emitter = require("./base.js");

function fn1(name) {
    return ([x]) => `${name}(${x})`;
}

function posix1(name) {
    return ([x]) => `POSIX::${name}(${x})`;
}

// Every scalar variable reference in Perl needs a leading `$` -- unlike
// every other emitter here, base.js's default "var" case (bare
// `node.name`) is wrong for every single reference, not just declarations.
// Emitter is a real class (see base.js), so this overrides just the one
// case and defers to the base class for everything else, instead of
// needing a new config hook shared by every other emitter.
class PerlEmitter extends Emitter {
    emitExpr(node) {
        if (node.type === "var") return `$${node.name}`;
        return super.emitExpr(node);
    }
}

const emitter = new PerlEmitter({
    ext: "pl",
    // Perl accepts JS-style numeric literal syntax directly, including
    // exponential notation ("1e-9") -- no suffix or conversion needed.
    formatNumber: (v) => String(v),
    calls: {
        // Core builtins -- no module needed.
        // Perl's OWN builtin sqrt/log (unlike asin/acos below, which go
        // through POSIX, and pow/`**`) RAISE a fatal error for an
        // out-of-domain argument -- confirmed directly: "Can't take sqrt
        // of -1", "Can't take log of 0" -- even POSIX::sqrt/POSIX::log
        // hit the identical error (confirmed: they're not a separate
        // direct libm call, just the same builtin under another name).
        // Perl's ternary IS short-circuiting (standard C-like ?:), so a
        // simple inline guard is enough -- "9**9**9 - 9**9**9" and
        // "9**9**9" are confirmed-safe, non-crashing ways to synthesize a
        // real NaN/Infinity in Perl (Inf - Inf and Inf respectively; the
        // NaN one confirmed to correctly fail self-equality, i.e. a real
        // IEEE NaN, not a string).
        sqrt: ([x]) => `(${x} >= 0 ? sqrt(${x}) : 9**9**9 - 9**9**9)`,
        abs: fn1("abs"), sin: fn1("sin"), cos: fn1("cos"),
        exp: fn1("exp"),
        log: ([x]) => `(${x} > 0 ? log(${x}) : (${x} == 0 ? -(9**9**9) : 9**9**9 - 9**9**9))`,
        atan2: ([a, b]) => `atan2(${a}, ${b})`,
        pow: ([x, y]) => `(${x} ** ${y})`,
        // Everything else Perl core doesn't have is in the POSIX module --
        // called fully-qualified (POSIX::name) rather than imported, so
        // there's no import list to keep in sync with this table and no
        // risk of a POSIX symbol shadowing a core builtin of the same name.
        tan: posix1("tan"), asin: posix1("asin"), acos: posix1("acos"), atan: posix1("atan"),
        // NOT posix1("log10") -- confirmed POSIX::log10 hits the exact
        // same "Can't take log of ..." fatal error as the bare builtin
        // (see the log: entry above for the full story); same safe-log
        // ternary as the numerator here, divided by a fixed safe
        // constant.
        log10: ([x]) => `((${x} > 0 ? log(${x}) : (${x} == 0 ? -(9**9**9) : 9**9**9 - 9**9**9)) / log(10))`,
        floor: posix1("floor"), ceil: posix1("ceil"),
        round: posix1("round"), trunc: posix1("trunc"),
        hypot: ([a, b]) => `POSIX::hypot(${a}, ${b})`,
        // No log2 anywhere in core or POSIX -- derive it.
        log2: ([x]) => `((${x} > 0 ? log(${x}) : (${x} == 0 ? -(9**9**9) : 9**9**9 - 9**9**9)) / log(2))`,
        // List::Util, same fully-qualified convention as POSIX above --
        // but NOT called bare: confirmed directly that List::Util's
        // min/max aren't even internally consistent with EACH OTHER
        // around NaN -- min(nan,5)==NaN but min(5,nan)==5 (first wins),
        // while max(nan,5)==5 but max(5,nan)==NaN (SECOND wins instead).
        // JS/Go/Java/C#/Julia/Scheme/Fortran instead propagate NaN
        // through min/max the way this project now standardizes on --
        // see docs/adr/0003-min-max-nan-propagation.md. Same self-
        // inequality NaN test and NaN-synthesis idiom as sqrt:/log:
        // above (an IEEE NaN never compares equal to itself).
        min: ([a, b]) => `(${a} != ${a} || ${b} != ${b} ? 9**9**9 - 9**9**9 : List::Util::min(${a}, ${b}))`,
        max: ([a, b]) => `(${a} != ${a} || ${b} != ${b} ? 9**9**9 - 9**9**9 : List::Util::max(${a}, ${b}))`,
        // No sign() anywhere in core, POSIX, or List::Util -- build it
        // directly. Zero-aware by construction (see Go's/Rust's sign()
        // history in this project for what happens when it isn't).
        sign: ([x]) => `(${x} > 0 ? 1.0 : (${x} < 0 ? -1.0 : 0.0))`,
        // Perl's % on non-integer operands has enough real-world edge-
        // case ambiguity (see perlop's own caveats) that this uses the
        // same self-correcting double-application wrap as the definitely-
        // sign-of-dividend languages, rather than trusting a specific
        // convention from memory alone.
        wrapIndex: ([i, m]) => `(((${i} % ${m}) + ${m}) % ${m})`,
        clampIndex: ([i, lo, hi]) => `List::Util::max(${lo}, List::Util::min(${hi}, ${i}))`,
    },
    // Perl subs flatten every argument into one flat @_ list, so a real
    // array positionally among other scalars would lose its boundary --
    // an array-typed param is passed as an ARRAYREF (\@caller_array) by
    // convention, same as any Perl sub taking an array needs to. No
    // formatFunction change needed: `my ($p) = @_;` already captures a
    // scalar value correctly whether that value is a plain number or a
    // reference -- Perl's dynamic typing doesn't distinguish here. Only
    // indexing needs to know: `$ref->[i]`, arrow-dereference syntax, not
    // plain `$ref[i]` (which would index a DIFFERENT, unrelated package
    // variable @ref).
    emitIndex: function (targetNode, atNode) {
        return `${this.emitExpr(targetNode)}->[int(${this.emitExpr(atNode)})]`;
    },
    // Perl's ?: is exactly base.js's default ternary -- no override needed.
    // Opt-in only (see emitFunction's `addTypeGuards` and
    // docs/runtime-type-guards.md). Perl's array-typed param convention
    // is an ARRAYREF (see emitIndex's own comment), so the guard checks
    // ref($arr) rather than anything about @arr -- a plain non-reference
    // scalar (what a caller mistakenly passing a bare number produces)
    // has ref() eq '' (empty string), never 'ARRAY'.
    typeGuard: (p, fnName) =>
        `unless (ref($${p}) eq 'ARRAY') { die ${JSON.stringify(`${fnName}: "${p}" must be an array reference`)}; }`,
    // Opt-in on top of typeGuard's own opt-in (see emitFunction's
    // `fn.arrayLengths` doc comment in base.js) -- runs after the type
    // guard above, so dereferencing $p as an arrayref is always safe
    // here. scalar(@$p) is Perl's own "count the elements of the array
    // this reference points to" idiom.
    lengthGuard: (p, lenP, fnName) =>
        `unless (scalar(@$${p}) == $${lenP}) { die ${JSON.stringify(`${fnName}: scalar(@{"${p}"}) must equal "${lenP}"`)}; }`,
    formatFunction: (fn, body, letBindings = [], guardLines = []) => {
        const params = fn.params.length ? `    my (${fn.params.map((p) => `$${p}`).join(", ")}) = @_;\n` : "";
        const guards = guardLines.map((l) => `    ${l}`).join("\n");
        const guardsBlock = guards ? guards + "\n" : "";
        const lets = letBindings.map(({ name, valueStr }) => `    my $${name} = ${valueStr};`).join("\n");
        const letsBlock = lets ? lets + "\n" : "";
        return `# AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `use strict;\n` +
               `use warnings;\n` +
               `use POSIX ();\n` +
               `use List::Util ();\n\n` +
               `sub ${fn.name} {\n` +
               params +
               guardsBlock +
               letsBlock +
               `    return ${body};\n` +
               `}\n\n` +
               `1;\n`;
    },
    // Multiple named outputs from one call: a plain hash ref (`{ rx => ...,
    // ry => ... }`), Perl's lightest-weight named-record idiom -- no
    // package/class needed just to carry a few doubles back to the caller.
    formatSuite: (fn, outputStrs, letBindings = [], guardLines = []) => {
        const params = fn.params.length ? `    my (${fn.params.map((p) => `$${p}`).join(", ")}) = @_;\n` : "";
        const guards = guardLines.map((l) => `    ${l}`).join("\n");
        const guardsBlock = guards ? guards + "\n" : "";
        const lets = letBindings.map(({ name, valueStr }) => `    my $${name} = ${valueStr};`).join("\n");
        const letsBlock = lets ? lets + "\n" : "";
        const outputNames = Object.keys(outputStrs);
        const fields = outputNames.map((n) => `        ${n} => ${outputStrs[n]},`).join("\n");
        return `# AUTO-GENERATED by ExprForge -- do not hand-edit.\n` +
               `use strict;\n` +
               `use warnings;\n` +
               `use POSIX ();\n` +
               `use List::Util ();\n\n` +
               `sub ${fn.name} {\n` +
               params +
               guardsBlock +
               letsBlock +
               `    return {\n` +
               fields + "\n" +
               `    };\n` +
               `}\n\n` +
               `1;\n`;
    },
});

module.exports = emitter;
