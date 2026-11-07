// exprforge/emitters/meta.js
//
// Helpers over the per-emitter `meta` objects. Every emitters/<lang>.js
// attaches one as `emitter.meta`; this module is the one place that turns
// the registry plus those objects into:
//   - the facts the generated doc regions state (counts, lists, tables;
//     see scripts/sync-docs.js), so no document hand-maintains a target
//     count or a per-language list;
//   - the validation that keeps a new emitter's metadata complete.
//
// Registry-wide tests (test/*.test.js) read their per-target expectations
// from the same objects, so a new language is one emitter file plus one
// registry line.
//
// meta field reference
//   displayName          Human-readable name ("Python", "MATLAB/Octave").
//   dialect              Optional toolchain flavor shown in prose ("Guile").
//   kind                 "executable" (runs on a real toolchain),
//                        "typeset" (LaTeX) or "syntax" (the expr printer).
//   testTarget           Label used by EXPRFORGE_TEST_TARGETS and in
//                        conformance test names; null when the target has no
//                        conformance run of its own (JS is the baseline).
//   ci                   { workflow, badge? } for .github/workflows/<file>,
//                        or null. `badge` is the README badge label.
//   toolchain            null, or { probes, docs }.
//     probes             null, or a list of { candidates, args }: every probe
//                        must find one of its candidate commands on PATH
//                        (run with args) for the target to count as available.
//                        `args: null` only locates the command on PATH
//                        without running it (QB64-PE: an invocation is itself
//                        a compiler run against the shared install).
//     label              Optional table label when it differs from displayName.
//     docs               { minimum, tested, notes } -- one row of the README
//                        "Supported toolchain versions" table.
//   guards               Substring addTypeGuards output must contain for an
//                        array parameter named `arr`; null when the target
//                        ignores the option.
//   arrayParams          false when the target rejects array parameters
//                        outright (COBOL); default true.
//   division             Text div(x, y) must contain for a variable
//                        denominator (parameters x and y).
//   divisionGuard        Optional { plain, helperCall }: the target guards
//                        division by a possibly-zero denominator with a
//                        helper, but a nonzero literal stays `plain`.
//   cmp                  Optional overrides for the comparison operators:
//                        { eq, ne, forbidEq, forbidNe, shared } where eq/ne
//                        are the substrings expected for `==` / `!=`
//                        (defaults "==" / "!="), forbid* are tokens that
//                        must not leak through, and shared maps the four
//                        shared operators to a different spelling.
//   roundTies            Native round() tie behavior of the target language
//                        ("away", "even", "posInf"); ExprForge's emitted
//                        round() ties away from zero regardless.
//   selectShortCircuits  true when the emitted select() only evaluates the
//                        taken branch; false when both are always evaluated.
//   minMaxNaN            Native min/max behavior with a NaN operand:
//                        "propagate", "ignore", "positional", "erratic" or
//                        "raises" (the native call throws; Ruby).
//
// kind "typeset"/"syntax" targets leave roundTies, selectShortCircuits and
// minMaxNaN null: they print the formula rather than compute it.

const registry = require("./registry.js");
const { PRIMITIVE_ARITY } = require("../primitives.js");

const KINDS = ["executable", "typeset", "syntax"];
const ROUND_TIES = ["away", "even", "posInf"];
const MIN_MAX_NAN = ["propagate", "ignore", "positional", "erratic", "raises"];

function targets() {
    return Object.entries(registry).map(([lang, emitter]) => ({ lang, emitter, meta: emitter.meta }));
}

function executable() {
    return targets().filter((t) => t.meta.kind === "executable");
}

function validateMeta(lang, meta) {
    const problems = [];
    const bad = (msg) => problems.push(`${lang}: ${msg}`);
    if (!meta || typeof meta !== "object") return [`${lang}: emitter.meta is missing`];
    if (typeof meta.displayName !== "string" || !meta.displayName) bad("displayName must be a non-empty string");
    if (!KINDS.includes(meta.kind)) bad(`kind must be one of ${KINDS.join(", ")}`);
    if (typeof meta.division !== "string" || !meta.division) bad("division must be a non-empty string");
    if (meta.guards !== null && typeof meta.guards !== "string") bad("guards must be a string or null");
    if (meta.testTarget !== null && typeof meta.testTarget !== "string") bad("testTarget must be a string or null");
    if (meta.ci !== null && !(meta.ci && typeof meta.ci.workflow === "string")) bad("ci must be null or { workflow }");
    if (meta.toolchain !== null) {
        const tc = meta.toolchain;
        if (!tc || typeof tc !== "object") bad("toolchain must be null or an object");
        else {
            if (tc.probes !== null && !Array.isArray(tc.probes)) bad("toolchain.probes must be null or an array");
            for (const p of tc.probes || []) {
                if (!Array.isArray(p.candidates) || !p.candidates.length || !(Array.isArray(p.args) || p.args === null)) {
                    bad("each toolchain probe needs candidates[] and args[] (or args: null to only locate the command)");
                }
            }
            const d = tc.docs;
            if (!d || ["minimum", "tested", "notes"].some((k) => typeof d[k] !== "string")) {
                bad("toolchain.docs needs string minimum, tested and notes");
            }
        }
    }
    if (meta.kind === "executable") {
        if (!ROUND_TIES.includes(meta.roundTies)) bad(`roundTies must be one of ${ROUND_TIES.join(", ")}`);
        if (typeof meta.selectShortCircuits !== "boolean") bad("selectShortCircuits must be a boolean");
        if (!MIN_MAX_NAN.includes(meta.minMaxNaN)) bad(`minMaxNaN must be one of ${MIN_MAX_NAN.join(", ")}`);
        if (!meta.ci) bad("an executable target needs a ci workflow");
        if (!meta.toolchain) bad("an executable target needs toolchain docs");
    } else {
        for (const k of ["roundTies", "selectShortCircuits", "minMaxNaN"]) {
            if (meta[k] !== null) bad(`${k} must be null for kind "${meta.kind}"`);
        }
    }
    return problems;
}

const names = (list) => list.map((t) => t.meta.displayName);
const nameWithDialect = (t) => (t.meta.dialect ? `${t.meta.displayName} (${t.meta.dialect})` : t.meta.displayName);

function oxford(items) {
    if (items.length <= 2) return items.join(" and ");
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function toolchainTable() {
    const rows = targets().filter((t) => t.meta.toolchain && t.meta.toolchain.docs);
    const out = ["| Target | Minimum | Tested in CI | Notes |", "|---|---|---|---|"];
    for (const { meta } of rows) {
        const { minimum, tested, notes } = meta.toolchain.docs;
        const label = meta.toolchain.label || meta.displayName;
        out.push(`| ${label} | ${minimum} | ${tested} | ${notes} |`);
    }
    return out.join("\n");
}

function badges() {
    return targets()
        .filter((t) => t.meta.ci && t.meta.ci.badge)
        .map(({ meta }) => {
            const wf = meta.ci.workflow;
            return `[![${meta.ci.badge}](https://github.com/theraccoonbear/exprforge/actions/workflows/${wf}/badge.svg)](https://github.com/theraccoonbear/exprforge/actions/workflows/${wf})`;
        })
        .join("\n");
}

// Display names of the executable targets whose select() evaluates both
// branches, as one phrase ("QB64, Fortran, COBOL, and MATLAB/Octave").
function eagerSelectTargets() {
    return oxford(names(executable().filter((t) => t.meta.selectShortCircuits === false)));
}

// The single source of every generated doc region: marker key -> text.
// Keys ending in "table" or equal to "badges" are block regions (the
// generator puts them on their own lines); the rest are inline.
function docFacts() {
    const all = targets();
    const exec = all.filter((t) => t.meta.kind === "executable");
    const away = exec.filter((t) => t.meta.roundTies === "away");
    const notAway = exec.filter((t) => t.meta.roundTies !== "away");
    const eager = exec.filter((t) => t.meta.selectShortCircuits === false);
    const lazy = exec.filter((t) => t.meta.selectShortCircuits === true);
    const guarded = all.filter((t) => t.meta.guards !== null);
    const unguarded = exec.filter((t) => t.meta.guards === null);
    // Whole-file framing has one source of truth: an emitter that
    // configures `frame` (emitters/base.js) assembles its own file in
    // emitFile; the rest are header + functions concatenated.
    const framed = exec.filter((t) => t.emitter.frameImpl);
    const unframed = exec.filter((t) => !t.emitter.frameImpl);
    const facts = {
        "count:executable": String(exec.length),
        "count:outputs": String(all.length),
        "count:primitives": String(Object.keys(PRIMITIVE_ARITY).length),
        "list:executable": oxford(names(exec)),
        "list:executable-dialects": oxford(exec.map(nameWithDialect)),
        "count:round-away": String(away.length),
        "list:round-away": names(away).join(", "),
        "count:round-other": String(notAway.length),
        "list:round-other": names(notAway).join(", "),
        "count:select-eager": String(eager.length),
        "list:select-eager": oxford(names(eager)),
        "count:select-lazy": String(lazy.length),
        "count:type-guards": String(guarded.length),
        "list:type-guards": oxford(names(guarded)),
        "count:no-type-guards": String(unguarded.length),
        "list:no-type-guards": oxford(names(unguarded)),
        "list:file-framed": oxford(names(framed)),
        "list:file-unframed": oxford(names(unframed)),
        "list:toolchain-commands": [...new Set(exec.flatMap((t) => ((t.meta.toolchain && t.meta.toolchain.probes) || []).map((p) => p.candidates[0])))].map((c) => "`" + c + "`").join("/"),
        "table:toolchains": toolchainTable(),
        badges: badges(),
    };
    return facts;
}

// The package.json "description": built from the registry for the same
// reason the doc regions are.
function packageDescription() {
    const exec = executable();
    return (
        "Author a math expression once as an AST (or readable infix text via expr/fn), emit identical-behavior " +
        `implementations in ${exec.length} programming languages (${oxford(names(exec))}), ` +
        "plus a native evaluator, typeset LaTeX output, and a printer for its own readable syntax."
    );
}

module.exports = { targets, executable, validateMeta, docFacts, packageDescription, oxford, eagerSelectTargets };
