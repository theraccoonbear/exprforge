// A real CodeMirror mode for fn/expr syntax, not an approximation via
// some other language's grammar. Found the hard way: the main editor
// was using @codemirror/lang-javascript as a stand-in (see git history)
// -- close enough for identifiers/numbers/punctuation, but JS has no
// "#" comment syntax, so its tokenizer read `# Binet's formula` as an
// unrecognized "#", then treated the apostrophe in "Binet's" as the
// start of a single-quoted string literal, breaking highlighting for
// the rest of the line. The actual grammar is small (see expr.js's own
// tokenizeSegment) and this project already owns it -- mirroring that
// tokenizer's exact rules here, rather than continuing to borrow a
// grammar that was never quite right, is the real fix.
//
// Deliberately simpler than expr.js's real tokenizer in one respect:
// this never needs to track a comment staying open across a `${...}`
// interpolation boundary, since the editor only ever shows plain
// template text, never a real tagged-template call with interpolated
// JS values spliced in.
import { StreamLanguage } from "@codemirror/language";
import type { StringStream } from "@codemirror/language";

// "fn"/"macro" are the mandatory leading keywords loadExprSource()'s
// stricter grammar requires on every signature line in a multi-
// definition buffer (see fn.js's requireExportKeyword mode and the root
// README's "Loading a .expr file" section) -- colored the same as
// "let"/"return" for the same reason: all four are only ever recognized
// contextually by the real parser (specific positions, never reserved
// everywhere), but coloring the literal word as a keyword unconditionally
// is the same reasonable simplification already made for "let"/"return"
// below.
const KEYWORDS = new Set(["let", "return", "fn", "macro"]);

function readNumber(stream: StringStream) {
    stream.eatWhile(/[0-9]/);
    if (stream.peek() === ".") {
        stream.next();
        stream.eatWhile(/[0-9]/);
    }
    if (stream.peek() === "e" || stream.peek() === "E") {
        const mark = stream.pos;
        stream.next();
        if ((stream.peek() as string) === "+" || (stream.peek() as string) === "-") stream.next();
        if (/[0-9]/.test(stream.peek() ?? "")) {
            stream.eatWhile(/[0-9]/);
        } else {
            stream.pos = mark; // no digits after e/E after all -- back out
        }
    }
    return "number";
}

function token(stream: StringStream): string | null {
    if (stream.eatSpace()) return null;

    // "#" comments run to end of line -- exactly expr.js's own rule.
    if (stream.peek() === "#") {
        stream.skipToEnd();
        return "comment";
    }

    const ch = stream.peek() as string;

    // NUMBER: 123, 123.45, .5, 1e-9 -- same shape as expr.js's tokenizer.
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(stream.string[stream.pos + 1] ?? ""))) {
        return readNumber(stream);
    }

    // IDENT / keyword / call name. "let"/"return" are only ever
    // recognized contextually by the real parser (statement-start
    // position) -- for highlighting purposes, coloring the literal word
    // as a keyword everywhere is a reasonable simplification, matching
    // how most editors treat reserved-ish words.
    if (/[A-Za-z_]/.test(ch)) {
        const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/) as RegExpMatchArray | null;
        const name = word ? word[0] : "";
        if (KEYWORDS.has(name)) return "keyword";
        if (stream.peek() === "(") return "variableName.function";
        return "variableName";
    }

    // Two-character comparison operators before their one-character
    // prefixes -- same ordering rule as expr.js's tokenizer.
    if ((ch === ">" || ch === "<" || ch === "=" || ch === "!") && stream.string[stream.pos + 1] === "=") {
        stream.next();
        stream.next();
        return "operator";
    }

    if ("+-*/^".includes(ch)) {
        stream.next();
        return "operator";
    }
    if ("?:><!=".includes(ch)) {
        stream.next();
        return "operator";
    }
    if ("(){};,".includes(ch)) {
        stream.next();
        return "punctuation";
    }

    // Unrecognized character -- still advance so the stream can't get
    // stuck, just render it unstyled rather than throwing (this is
    // highlighting, not the real parser; a genuinely invalid character
    // still gets a real, clear error from fn()/expr() itself once you
    // try to run it).
    stream.next();
    return null;
}

export const exprForgeStreamParser = {
    token,
};

export const exprForgeLanguage = StreamLanguage.define(exprForgeStreamParser);
