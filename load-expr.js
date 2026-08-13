// exprforge/load-expr.js
//
// Parses the .expr round-trip text format (see emitters/exprsyntax.js and
// test/conformance.test.js's assertExprSyntaxRoundTrips) as zero or more
// function definitions, using the exact same grammar/engine fn`...`
// already uses (see fn.js's parseProgram), just applied repeatedly
// instead of once. Two entry points: loadExprSource(text) parses text
// directly (no filesystem involved -- usable anywhere source text comes
// from, including a browser); loadExpr(path) reads a real file first and
// delegates to it.
//
// Functions defined earlier are available to functions defined LATER (in
// the same source) as inline macros -- the exact same "inline expansion,
// not runtime calls" model loadMacro() itself uses (see macros.js's own
// header comment), and for the same reasons: no call graph, no linking
// problem, no runtime coupling. And, structurally, no recursion: a
// definition is only added to this source's own local registry AFTER
// it's been fully parsed and expanded (see the loop below), so it's
// never resolvable through its own name while its own body is being
// expanded, whether directly or transitively through another
// not-yet-defined function.
//
// Each definition MUST have a "name(params):" signature line -- a
// bare-Node definition with no signature has no name for a later
// definition (or the caller) to refer to it by, so it can't usefully
// appear alongside others.
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
 * the file-reading variant) as zero or more "name(params): let ...;
 * return ...;" definitions back-to-back, in the same grammar fn`...`
 * uses for one. Returns an object keyed by function name, each value the
 * fully-expanded {name, params, body} -- ready to pass straight into
 * evaluate()/emit()/emitMany(), with every reference to an earlier
 * definition in the same source already inlined (see this file's own
 * header comment). `label` identifies the source in error messages (e.g.
 * a file path, or just "playground" for an in-browser text buffer that
 * was never written to disk at all -- this is the one entry point here
 * that has no `fs` dependency, so it's the one usable from a browser).
 *
 * Throws if any definition has no "name(params):" signature line, or if
 * two definitions share a name.
 */
function loadExprSource(source, label = "loadExprSource()") {
    const parser = new Parser(tokenizeFile(source, label), source, label);

    const fileRegistry = new Map(); // name -> {arity, fn, alreadyExpanded} -- see toMacro in macros.js
    const defs = {};

    while (parser.peek().type !== "EOF") {
        const raw = parseProgram(parser);
        if (!raw || typeof raw.name !== "string") {
            throw new Error(
                `${label}: every definition needs a "name(params):" signature line -- found one with no signature`,
            );
        }
        if (defs[raw.name]) {
            throw new Error(`${label}: duplicate function name "${raw.name}" -- names must be unique in one file`);
        }

        // Expanded against whatever's already in fileRegistry (earlier
        // definitions in this same source) PLUS every globally loaded
        // macro (expandMacros merges both -- see macros.js).
        const expanded = expandMacros(raw, fileRegistry);
        defs[raw.name] = expanded;

        // Available to whatever's defined AFTER this point in the source
        // -- never to itself (expanded above, against fileRegistry
        // BEFORE this line adds it) or to anything defined earlier.
        // `expanded` has nothing left to resolve (macro calls/field
        // access are already gone), so no extraRegistry needs passing
        // here.
        fileRegistry.set(raw.name, toMacro(expanded));
    }

    return defs;
}

/**
 * Reads `path` from disk and parses it via loadExprSource() above -- see
 * that function's own doc comment for the actual grammar/semantics; this
 * is purely the file-reading convenience wrapper around it. Node-only
 * (fs.readFileSync); use loadExprSource(text) directly wherever the
 * source text comes from somewhere else (e.g. a browser text buffer, an
 * HTTP response) instead of a real file on disk.
 */
function loadExpr(path) {
    return loadExprSource(fs.readFileSync(path, "utf8"), `loadExpr(${path})`);
}

module.exports = { loadExpr, loadExprSource };
