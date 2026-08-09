// exprforge/expr.js
//
// Infix syntax sugar over ast.js's own builders -- NOT a new node type or
// a new capability. `` expr`a * b + 1` `` builds exactly the same tree
// `add(mul(v("a"), v("b")), num(1))` would, by calling num/v/add/sub/mul/
// div/neg/call/cmp/select directly (never constructing a raw {type: ...}
// object by hand), so every guarantee those builders already have
// (collectLets round-tripping, emitter compatibility) carries over for
// free. Unlike util.js's forComponents, this DOES return a Node -- it's
// closer in spirit to letChain (also in ast.js): a different way to
// spell the same tree, not a different tree.
//
// A tagged template literal, not a plain string function: `expr` is
// called by JS itself as expr(strings, ...values) -- see the grammar
// comment below for why that's the whole interpolation mechanism, with
// no `${` text syntax of its own to parse.
//
// Grammar:
//
//   expression     := ternary
//   ternary        := additive ( compOp additive "?" expression ":" expression )?
//   compOp         := ">" | "<" | ">=" | "<=" | "==" | "!="
//   additive       := multiplicative ( ("+"|"-") multiplicative )*
//   multiplicative := unary ( ("*"|"/") unary )*
//   unary          := "-" unary | power
//   power          := primary ( "^" unary )?
//   primary        := NUMBER | IDENT ("(" args ")")? | "(" expression ")" | HOLE
//   args           := expression ("," expression)*
//
// Deliberately NOT supported (see the plan doc's "Scope decisions"):
//   - No let/outputs blocks -- this is a pure expression grammar, same
//     "expression AST, not a program AST" boundary as ast.js itself.
//     Wrap the result in letIn/letChain/outputs instead.
//   - No &&/|| -- the AST has no boolean-combinator node to lower them
//     to. A comparison is ONLY ever valid as a ternary's condition
//     (matching cmp()'s own documented constraint in ast.js), enforced
//     here at PARSE time with a clear error, not deferred to the
//     "cmp used outside select()" throw every emitter already has.
//   - "^" lowers to call("pow", left, right), never a bin node -- bin.op
//     is only ever "+"|"-"|"*"|"/" (see ast.js), and every emitter's
//     `calls` table keys "pow" by name, even for targets whose own
//     syntax has a native ^/** operator.
const { num, v, add, sub, mul, div, neg, call, cmp, select } = require("./ast.js");

const COMPARE_OPS = [">", "<", ">=", "<=", "==", "!="];

// Tokenizes one template-literal string segment, appending {type, value,
// pos} tokens to `tokens` (pos is an offset into the reconstructed full
// source string built in expr() below, used only for error messages).
// `label` is just which tag function's name shows up in error messages
// -- fn.js passes "fn()" here so a lex error inside `` fn`...` `` isn't
// misattributed to expr().
//
// `state.inComment` carries "# comment" status ACROSS segments -- these
// are tagged template literals, so a source like
// `` expr`a + b # comment ${x} more` `` tokenizes segment "a + b #
// comment " and segment " more" separately, with a HOLE for `x` spliced
// between them by expr()/fn() below. A comment open at the end of one
// segment has to stay open into the next, or "more" would wrongly
// become real tokens again. One `state` object is created once per
// top-level expr()/fn() call and threaded through every call here --
// never reset per segment.
function tokenizeSegment(str, offset, tokens, state = { inComment: false }, label = "expr()") {
    let i = 0;
    if (state.inComment) {
        const nl = str.indexOf("\n");
        if (nl === -1) {
            // The whole segment is still inside the comment -- nothing
            // to tokenize, and still in-comment for whatever's next.
            return;
        }
        i = nl + 1;
        state.inComment = false;
    }
    while (i < str.length) {
        const ch = str[i];
        const start = i;
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        // "#" comments run to the next newline (or off the end of this
        // segment, in which case state.inComment stays set for the next
        // one -- see above). Not part of the OP set below: this
        // produces no token at all, the same category as whitespace,
        // not an operator.
        if (ch === "#") {
            const nl = str.indexOf("\n", i);
            if (nl === -1) {
                state.inComment = true;
                return;
            }
            i = nl + 1;
            continue;
        }
        // NUMBER: 123, 123.45, .5, 1e-9, 1.5E+10
        if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(str[i + 1] || ""))) {
            i++;
            while (i < str.length && /[0-9]/.test(str[i])) i++;
            if (str[i] === ".") {
                i++;
                while (i < str.length && /[0-9]/.test(str[i])) i++;
            }
            if (str[i] === "e" || str[i] === "E") {
                let j = i + 1;
                if (str[j] === "+" || str[j] === "-") j++;
                if (/[0-9]/.test(str[j] || "")) {
                    i = j;
                    while (i < str.length && /[0-9]/.test(str[i])) i++;
                }
            }
            tokens.push({ type: "NUMBER", value: Number(str.slice(start, i)), pos: offset + start });
            continue;
        }
        // IDENT: variable names and function names, e.g. wy_wire, sqrt.
        if (/[A-Za-z_]/.test(ch)) {
            i++;
            while (i < str.length && /[A-Za-z0-9_]/.test(str[i])) i++;
            tokens.push({ type: "IDENT", value: str.slice(start, i), pos: offset + start });
            continue;
        }
        // Two-character comparison operators before their one-character
        // prefixes, so ">=" doesn't get lexed as ">" followed by "=".
        if ((ch === ">" || ch === "<" || ch === "=" || ch === "!") && str[i + 1] === "=") {
            tokens.push({ type: "OP", value: str.slice(i, i + 2), pos: offset + start });
            i += 2;
            continue;
        }
        // ";", "{", "}", "=" aren't used by expr()'s own grammar -- they're
        // here for fn.js's statement syntax (let name = ...; / return
        // {...};) to reuse this same tokenizer instead of forking it.
        // Inert for expr(): nothing that parses successfully today could
        // contain them anyway ("=" alone was always a lex error before,
        // since only "==" was recognized).
        if ("+-*/^(),?:><;{}=".includes(ch)) {
            tokens.push({ type: "OP", value: ch, pos: offset + start });
            i++;
            continue;
        }
        throw new Error(`${label}: unexpected character "${ch}" at position ${offset + start}`);
    }
}

// A HOLE's value is resolved to a Node right where it's produced (not
// deferred into the parser), so a bad interpolation fails immediately
// with a clear error rather than surfacing as a confusing parse error
// somewhere else in the tree. `label` -- see tokenizeSegment above.
function holeToNode(value, label = "expr()") {
    if (typeof value === "number") return num(value);
    if (value && typeof value === "object" && typeof value.type === "string") return value;
    const shown = typeof value === "string" ? `"${value}"` : JSON.stringify(value);
    throw new Error(
        `${label}: interpolated value must be an AST node or a plain number, got ${shown} -- ` +
        `a bare variable name doesn't need interpolation, just write it directly in the template text`,
    );
}

class Parser {
    // `label` -- see tokenizeSegment above; also threaded through to
    // holeToNode so a bad interpolation inside `` fn`...` `` reports
    // "fn():" too, not just lex/parse errors.
    constructor(tokens, source, label = "expr()") {
        this.tokens = tokens;
        this.source = source;
        this.i = 0;
        this.label = label;
    }

    peek() {
        return this.tokens[this.i];
    }

    // One token beyond peek() -- always safe, since `tokens` always ends
    // with an EOF token appended once by expr()/fn() before the parser
    // ever runs, so there's always something to look at even right at
    // the end of input. Added for fn.js's signature-line lookahead
    // ("IDENT followed by '(' -- is this a signature, or the start of a
    // statement?"), which expr()'s own single-token-lookahead grammar
    // never needed.
    peekNext() {
        return this.tokens[this.i + 1];
    }

    next() {
        return this.tokens[this.i++];
    }

    isOp(value) {
        const t = this.peek();
        return t.type === "OP" && t.value === value;
    }

    expectOp(value) {
        if (!this.isOp(value)) this.error(`expected "${value}"`);
        return this.next();
    }

    error(message) {
        const t = this.peek();
        const tokDesc = t.type === "EOF" ? "end of input" : `"${t.value}"`;
        throw new Error(`${this.label}: ${message} -- found ${tokDesc} at position ${t.pos} in \`${this.source}\``);
    }

    parseExpression() {
        return this.parseTernary();
    }

    // Only place a comparison is ever accepted -- matches cmp()'s own
    // documented constraint in ast.js exactly (only valid as select()'s
    // cond). A bare comparison with no trailing "?" is a parse error
    // here, not deferred to the "cmp used outside select()" throw every
    // emitter already has.
    parseTernary() {
        const left = this.parseAdditive();
        const t = this.peek();
        if (t.type === "OP" && COMPARE_OPS.includes(t.value)) {
            const op = this.next().value;
            const right = this.parseAdditive();
            if (!this.isOp("?")) {
                this.error(`comparison ("${op}") must be used as a ternary condition ("cond ${op} ... ? then : else")`);
            }
            this.next(); // consume "?"
            const thenNode = this.parseExpression();
            this.expectOp(":");
            const elseNode = this.parseExpression();
            return select(cmp(left, op, right), thenNode, elseNode);
        }
        if (this.isOp("?")) {
            this.error(`"?" needs an explicit comparison as its condition (e.g. "a > 0 ? x : y") -- a bare value can't be a select() condition`);
        }
        return left;
    }

    parseAdditive() {
        let node = this.parseMultiplicative();
        while (this.isOp("+") || this.isOp("-")) {
            const op = this.next().value;
            const right = this.parseMultiplicative();
            node = op === "+" ? add(node, right) : sub(node, right);
        }
        return node;
    }

    parseMultiplicative() {
        let node = this.parseUnary();
        while (this.isOp("*") || this.isOp("/")) {
            const op = this.next().value;
            const right = this.parseUnary();
            node = op === "*" ? mul(node, right) : div(node, right);
        }
        return node;
    }

    // Unary minus binds LOOSER than "^" (-2^2 = -4, not 4) -- standard
    // math convention, and the reason `power` sits below `unary` here
    // rather than the other way around.
    parseUnary() {
        if (this.isOp("-")) {
            this.next();
            return neg(this.parseUnary());
        }
        if (this.isOp("+")) {
            this.next(); // unary plus: no-op
            return this.parseUnary();
        }
        return this.parsePower();
    }

    // Right-associative (2^3^2 = 2^(3^2) = 512): the exponent recurses
    // into `unary`, not `power`, which is also what lets the exponent
    // itself carry a leading unary minus (2^-1 = 0.5).
    parsePower() {
        const base = this.parsePrimary();
        if (this.isOp("^")) {
            this.next();
            const exponent = this.parseUnary();
            return call("pow", base, exponent);
        }
        return base;
    }

    parsePrimary() {
        const t = this.peek();
        if (t.type === "NUMBER") {
            this.next();
            return num(t.value);
        }
        if (t.type === "HOLE") {
            this.next();
            return holeToNode(t.value, this.label);
        }
        if (t.type === "IDENT") {
            this.next();
            if (this.isOp("(")) {
                this.next();
                const args = [];
                if (!this.isOp(")")) {
                    args.push(this.parseExpression());
                    while (this.isOp(",")) {
                        this.next();
                        args.push(this.parseExpression());
                    }
                }
                this.expectOp(")");
                // Not validated against the 22 known Math functions here
                // -- deferred to the same "no mapping for Math function"
                // check every hand-built call() node already goes
                // through in emitters/base.js, so there's only one list
                // of known function names to keep in sync, not two.
                return call(t.value, ...args);
            }
            return v(t.value);
        }
        if (this.isOp("(")) {
            this.next();
            const node = this.parseExpression();
            this.expectOp(")");
            return node;
        }
        this.error("expected a number, identifier, function call, or parenthesized expression");
    }
}

// The tagged-template tag function itself: `` expr`a + b` `` is called by
// JS as expr(["a + b"], ) -- with interpolations, `` expr`${x} + b` ``
// is called as expr(["", " + b"], x). strings.length is always
// values.length + 1. There is no "${" text syntax to lex: JS has already
// done that splitting before this function ever runs, so a HOLE token is
// just spliced into the token stream at each boundary, carrying the
// already-evaluated JS value through untouched.
function expr(strings, ...values) {
    const tokens = [];
    const state = { inComment: false };
    let source = "";
    for (let i = 0; i < strings.length; i++) {
        tokenizeSegment(strings[i], source.length, tokens, state);
        source += strings[i];
        if (i < values.length) {
            source += "${...}";
            // A value interpolated inside an open "#" comment is
            // silently dropped -- never reaches holeToNode, so it's
            // never validated, even if it would otherwise be an
            // invalid interpolation (a string, undefined, ...). This is
            // deliberate: the whole point of a comment is that its
            // contents don't matter.
            if (!state.inComment) {
                tokens.push({ type: "HOLE", value: values[i], pos: source.length });
            }
        }
    }
    tokens.push({ type: "EOF", value: null, pos: source.length });

    const parser = new Parser(tokens, source);
    const node = parser.parseExpression();
    if (parser.peek().type !== "EOF") {
        parser.error("unexpected trailing input");
    }
    return node;
}

// Parser/tokenizeSegment/holeToNode are exported alongside expr itself so
// fn.js (full function-body syntax: let/return on top of this same
// expression grammar) can reuse this tokenizer and parsing engine
// directly instead of forking it -- "fn's contain expr's" literally, not
// just as a description. Nothing here is part of expr()'s own public
// contract; treat these as internal to the expr/fn syntax family.
module.exports = { expr, Parser, tokenizeSegment, holeToNode };
