// exprforge/load-expr.js
//
// Loads a .expr file -- the exprsyntax emitter's own round-trip text
// format (see emitters/exprsyntax.js and test/conformance.test.js's
// assertExprSyntaxRoundTrips) -- as zero or more function definitions,
// parsed with the exact same grammar/engine fn`...` already uses (see
// fn.js's parseProgram), just applied repeatedly over one file instead
// of once over one template literal.
//
// Functions defined earlier in the file are available to functions
// defined LATER in the same file as inline macros -- the exact same
// "inline expansion, not runtime calls" model loadMacro() itself uses
// (see macros.js's own header comment), and for the same reasons: no
// call graph, no linking problem, no runtime coupling. And, structurally,
// no recursion: a definition is only added to this file's own local
// registry AFTER it's been fully parsed and expanded (see the loop
// below), so it's never resolvable through its own name while its own
// body is being expanded, whether directly or transitively through
// another not-yet-defined function.
//
// Each definition MUST have a "name(params):" signature line -- a
// bare-Node definition with no signature has no name for a later
// definition (or the caller) to refer to it by, so it can't usefully
// appear in a multi-definition file.
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
 * Parses `path` as zero or more "name(params): let ...; return ...;"
 * definitions back-to-back, in the same grammar fn`...` uses for one.
 * Returns an object keyed by function name, each value the fully-expanded
 * {name, params, body} -- ready to pass straight into
 * evaluate()/emit()/emitMany(), with every reference to an earlier
 * definition in the same file already inlined (see this file's own
 * header comment).
 *
 * Throws if any definition in the file has no "name(params):" signature
 * line, or if two definitions in the file share a name.
 */
function loadExpr(path) {
    const source = fs.readFileSync(path, "utf8");
    const label = `loadExpr(${path})`;
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
        // definitions in this same file) PLUS every globally loaded
        // macro (expandMacros merges both -- see macros.js).
        const expanded = expandMacros(raw, fileRegistry);
        defs[raw.name] = expanded;

        // Available to whatever's defined AFTER this point in the file --
        // never to itself (expanded above, against fileRegistry BEFORE
        // this line adds it) or to anything defined earlier. `expanded`
        // has nothing left to resolve (macro calls/field access are
        // already gone), so no extraRegistry needs passing here.
        fileRegistry.set(raw.name, toMacro(expanded));
    }

    return defs;
}

module.exports = { loadExpr };
