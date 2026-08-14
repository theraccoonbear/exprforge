// exprforge/load-expr.js
//
// Parses the .expr round-trip text format (see emitters/exprsyntax.js and
// test/conformance.test.js's assertExprSyntaxRoundTrips) as zero or more
// function definitions, using the exact same grammar/engine fn`...`
// already uses (see fn.js's parseProgram), just applied repeatedly
// instead of once, in fn.js's stricter requireExportKeyword mode (see
// its own header comment for the full rationale). Two entry points:
// loadExprSource(text) parses text directly (no filesystem involved --
// usable anywhere source text comes from, including a browser);
// loadExpr(path) reads a real file first and delegates to it.
//
// Every definition MUST have a "fn name(params):" or "macro name(params):"
// signature line -- no bare "name(params):" (fn.js's own requireExportKeyword
// mode rejects it outright), and no signature-less bare-Node definition
// either (which would have no name for a later definition, or the
// caller, to refer to it by anyway). "fn" and "macro" are otherwise
// identical -- both get registered into this source's own local macro
// registry below, so BOTH are available to whatever's defined later in
// the same source as an inline macro (the exact same "inline expansion,
// not runtime calls" model loadMacro() itself uses, see macros.js's own
// header comment, and for the same reasons: no call graph, no linking
// problem, no runtime coupling). The ONLY difference: a "macro"
// definition is never copied into the object this returns -- it exists
// purely to be inlined into something else in this same source, the
// same role a helper registered via loadMacro(name, fn`...`) directly
// already plays; a "fn" definition is both registered AND returned, so
// it's directly usable on its own (evaluate()/emit()/emitMany()) too.
// There's no default: every definition states which one it is, so a
// definition meant only as an internal building block for another one
// (e.g. cross3, when only crossLength's fully-inlined result actually
// gets used) can never accidentally show up in what this call hands
// back just because nothing said otherwise.
//
// And, structurally, no recursion, for either kind: a definition is only
// added to this source's own local registry AFTER it's been fully parsed
// and expanded (see the loop below), so it's never resolvable through
// its own name while its own body is being expanded, whether directly or
// transitively through another not-yet-defined function.
const fs = require("node:fs");
const { Parser, tokenizeSegment } = require("./expr.js");
const { parseProgram } = require("./fn.js");
const { expandMacros, toMacro } = require("./macros.js");

// Tokenizes the WHOLE file as one segment -- unlike fn()/expr() there's
// no tagged-template interpolation to splice HOLE tokens between (a .expr
// file is plain text, not JS source with ${...} holes), so this is
// simpler than fn.js's own tokenizeSegment loop, not a fork of it.
function tokenizeFile(source, label) {
    const tokens = [];
    tokenizeSegment(source, 0, tokens, { inComment: false }, label);
    tokens.push({ type: "EOF", value: null, pos: source.length });
    return tokens;
}

/**
 * Parses `source` (plain text, not a file path -- see loadExpr below for
 * the file-reading variant) as zero or more "fn name(params): let ...;
 * return ...;" / "macro name(params): let ...; return ...;" definitions
 * back-to-back, in the same grammar fn`...` uses for one (fn.js's
 * requireExportKeyword mode -- see its own header comment). Returns an
 * object keyed by the name of every "fn"-marked definition ONLY, each
 * value the fully-expanded {name, params, body} -- ready to pass
 * straight into evaluate()/emit()/emitMany(). A "macro"-marked
 * definition is registered for inlining into later definitions in the
 * same source (see this file's own header comment) but never appears in
 * the returned object. `label` identifies the source in error messages
 * (e.g. a file path, or just "playground" for an in-browser text buffer
 * that was never written to disk at all -- this is the one entry point
 * here that has no `fs` dependency, so it's the one usable from a
 * browser).
 *
 * Throws if any definition doesn't start with "fn"/"macro" (a bare
 * "name(params):" signature, or no signature at all, are both
 * rejected), or if two definitions share a name -- regardless of
 * whether either or both are "fn" vs "macro"; the two share one
 * namespace, same as loadMacro()/loadExtern() already do for the
 * process-wide registry.
 *
 * `registry` (see macros.js's createRegistry()) defaults to the
 * process-wide default when omitted -- pass a session's own (see
 * index.js's createSession()) to resolve macros/externs defined in that
 * session, alongside whatever's defined earlier in this same source.
 */
function loadExprSource(source, label = "loadExprSource()", registry = undefined) {
    const parser = new Parser(tokenizeFile(source, label), source, label);

    const fileRegistry = new Map(); // name -> {arity, fn, alreadyExpanded} -- see toMacro in macros.js
    const defs = {};
    // Tracked independently of `defs` -- a "macro"-marked definition
    // never lands in `defs` at all (see above), so `defs` alone can't
    // catch two macro-marked definitions (or a macro and a fn) sharing a
    // name; every parsed name, exported or not, goes through this Set.
    const seenNames = new Set();

    while (parser.peek().type !== "EOF") {
        // requireExportKeyword: true -- see fn.js's own header comment.
        // Throws its own clear error if this definition doesn't start
        // with "fn"/"macro"; there's no longer a "no signature at all"
        // case to separately detect here the way there used to be.
        const raw = parseProgram(parser, { requireExportKeyword: true });
        if (seenNames.has(raw.name)) {
            throw new Error(`${label}: duplicate function name "${raw.name}" -- names must be unique in one file`);
        }
        seenNames.add(raw.name);

        // Expanded against whatever's already in fileRegistry (earlier
        // definitions in this same source) PLUS every macro/extern
        // registered in `registry` (expandMacros merges both -- see
        // macros.js). `raw` carries an extra `exported` field (see
        // fn.js's parseProgram) that expandMacros' own fn-def branch
        // ignores -- it only ever reads/returns name/params/body, so
        // `expanded` below comes back with exactly those three keys
        // regardless.
        const expanded = expandMacros(raw, fileRegistry, registry);
        if (raw.exported) {
            defs[raw.name] = expanded;
        }

        // Available to whatever's defined AFTER this point in the source
        // -- never to itself (expanded above, against fileRegistry
        // BEFORE this line adds it) or to anything defined earlier. Both
        // "fn" and "macro" definitions are registered here identically
        // -- see this file's own header comment for why "exported" only
        // ever affects `defs` above, nothing about inlining eligibility.
        // `expanded` has nothing left to resolve (macro calls/field
        // access are already gone), so no extraRegistry/registry needs
        // passing here.
        fileRegistry.set(raw.name, toMacro(expanded));
    }

    return defs;
}

/**
 * Reads `path` from disk and parses it via loadExprSource() above -- see
 * that function's own doc comment for the actual grammar/semantics
 * (including `registry`); this is purely the file-reading convenience
 * wrapper around it. Node-only (fs.readFileSync); use loadExprSource(text)
 * directly wherever the source text comes from somewhere else (e.g. a
 * browser text buffer, an HTTP response) instead of a real file on disk.
 */
function loadExpr(path, registry = undefined) {
    return loadExprSource(fs.readFileSync(path, "utf8"), `loadExpr(${path})`, registry);
}

module.exports = { loadExpr, loadExprSource };
