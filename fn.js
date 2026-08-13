// exprforge/fn.js
//
// Full function-body syntax on top of expr.js's expression grammar: adds
// `let` bindings and a `return` statement, so a whole function body
// (let-chain + a single or multi-output result) can be authored as text
// instead of nested letChain()/outputs() calls. Every individual
// expression inside a `fn` template -- each let's value, the returned
// expression(s) -- is parsed by the *same* Parser class expr.js uses,
// via its parseExpression() entry point. fn's own grammar is a thin
// statement-sequence wrapper around that, lowering to the real ast.js
// builders (letChain, outputs), never a new node shape:
//
//   program    := signature? stmt* returnStmt
//   signature  := IDENT "(" (IDENT ("," IDENT)*)? ")" ":"
//   stmt       := "let" IDENT "=" expression ";"
//   returnStmt := "return" expression ";"
//               | "return" "{" field ("," field)* "}" ";"
//   field      := IDENT (":" expression)?
//
// A field with no ":" is shorthand for "name: name" (return { rx, ry, rz };
// means return { rx: rx, ry: ry, rz: rz };) -- same convention JS object
// literals use for a property whose value is a same-named variable, and
// fields can freely mix shorthand and explicit form in one return.
//
// "let"/"return" are recognized contextually -- an IDENT token whose
// value happens to be "let"/"return" at statement-start position. They
// are NOT reserved words in expr.js's own grammar, so nothing about
// expr()'s behavior changes: `` expr`let * 2` `` still means
// v("let") * 2 today, same as before this file existed.
//
// Duplicate let-names are deliberately NOT checked here -- letChain()
// doesn't check either (ast.js); collectLets() already does, at
// emission time. Same "defer semantic validation to emission" precedent
// expr.js itself follows for function/call names. Duplicate param names
// go unchecked for the same reason, and because nothing else in this
// project validates that today either -- {name, params, body} objects
// were always hand-built plain JS before this, with no infrastructure
// for it.
//
// The signature line is entirely optional, which makes fn's return type
// conditional on what you actually wrote: no signature -> a bare Node,
// exactly as before this was added (fully backward compatible -- every
// fn`...` template written before this feature existed still parses
// identically); a signature present -> the full {name, params, body}
// shape, usable directly in emitAll()/evaluate() with no wrapping. This
// was a deliberate API choice, not an oversight -- see the GitHub issue
// this shipped from for the alternative considered (a separate,
// always-full-definition tag) and why this was preferred.
const { letChain, outputs, v } = require("./ast.js");
const { Parser, tokenizeSegment } = require("./expr.js");

function isKeyword(parser, word) {
    const t = parser.peek();
    return t.type === "IDENT" && t.value === word;
}

function expectIdent(parser, context) {
    const t = parser.peek();
    if (t.type !== "IDENT") {
        parser.error(`expected an identifier ${context}`);
    }
    parser.next();
    return t.value;
}

function parseLetStatement(parser) {
    parser.next(); // consume "let", already confirmed present by the caller
    const name = expectIdent(parser, 'after "let"');
    parser.expectOp("=");
    const value = parser.parseExpression();
    parser.expectOp(";");
    return [name, value];
}

function parseReturnStatement(parser) {
    parser.next(); // consume "return", already confirmed present by the caller
    if (parser.isOp("{")) {
        parser.next();
        const fields = {};
        const readField = () => {
            const name = expectIdent(parser, 'as an output name inside "return { ... }"');
            // No ":" -- shorthand for "name: name" (return { rx, ry, rz };
            // means return { rx: rx, ry: ry, rz: rz };), matching JS object
            // literal shorthand. Explicit ":" still works, and either form
            // can appear anywhere in the same field list.
            if (!parser.isOp(":")) {
                fields[name] = v(name);
                return;
            }
            parser.next(); // consume ":"
            fields[name] = parser.parseExpression();
        };
        if (!parser.isOp("}")) {
            readField();
            while (parser.isOp(",")) {
                parser.next();
                readField();
            }
        }
        parser.expectOp("}");
        parser.expectOp(";");
        return outputs(fields);
    }
    const node = parser.parseExpression();
    parser.expectOp(";");
    return node;
}

// Signature lookahead needs 2 tokens, not 1: an IDENT that isn't "let"/
// "return" (those always start a statement instead), immediately
// followed by "(". That's a complete, unambiguous rule given the
// grammar above -- a fn`...` program only ever starts with a signature,
// a "let", or a "return", so there's no fourth case this could be
// confused with. (A malformed body missing its "let"/"return" entirely
// -- e.g. a bare `` fn`sqrt(x)` `` someone forgot the "return" on --
// still ends up an error either way, just reported as a missing ":"
// rather than a missing "return"; not worth deeper lookahead to improve
// one malformed-input error message.)
function looksLikeSignature(parser) {
    const t = parser.peek();
    if (t.type !== "IDENT" || t.value === "let" || t.value === "return") return false;
    const next = parser.peekNext();
    return next.type === "OP" && next.value === "(";
}

function parseSignature(parser) {
    const name = expectIdent(parser, "as the function name starting a fn`...` signature");
    parser.expectOp("(");
    const params = [];
    if (!parser.isOp(")")) {
        params.push(expectIdent(parser, "as a parameter name in a fn`...` signature"));
        while (parser.isOp(",")) {
            parser.next();
            params.push(expectIdent(parser, "as a parameter name in a fn`...` signature"));
        }
    }
    parser.expectOp(")");
    parser.expectOp(":");
    return { name, params };
}

function parseProgram(parser) {
    const signature = looksLikeSignature(parser) ? parseSignature(parser) : null;

    const bindings = [];
    while (isKeyword(parser, "let")) {
        bindings.push(parseLetStatement(parser));
    }
    if (!isKeyword(parser, "return")) {
        parser.error('expected "return" (a fn`...` body is zero or more "let" statements followed by a "return")');
    }
    const body = parseReturnStatement(parser);
    const result = bindings.length > 0 ? letChain(bindings, body) : body;

    return signature ? { name: signature.name, params: signature.params, body: result } : result;
}

// Same token-splicing loop expr() uses in expr.js -- see that file's
// header comment for why there's no "${" text syntax to lex separately;
// the only difference here is the entry point (parseProgram instead of
// parser.parseExpression()).
function fn(strings, ...values) {
    const tokens = [];
    const state = { inComment: false };
    let source = "";
    for (let i = 0; i < strings.length; i++) {
        tokenizeSegment(strings[i], source.length, tokens, state, "fn()");
        source += strings[i];
        if (i < values.length) {
            source += "${...}";
            // See expr.js's tokenizeSegment/expr() for why this is
            // silently dropped rather than pushed -- same rule, same
            // reasoning, shared state object.
            if (!state.inComment) {
                tokens.push({ type: "HOLE", value: values[i], pos: source.length });
            }
        }
    }
    tokens.push({ type: "EOF", value: null, pos: source.length });

    const parser = new Parser(tokens, source, "fn()");
    const node = parseProgram(parser);
    if (parser.peek().type !== "EOF") {
        parser.error("unexpected trailing input");
    }
    return node;
}

// parseProgram is also exported for load-expr.js: loading a .expr file
// means parsing zero or more of these back-to-back over one shared token
// stream (see load-expr.js's own header comment), which needs the same
// "signature? stmt* returnStmt" grammar this file already implements --
// reused directly, not forked.
module.exports = { fn, parseProgram };
