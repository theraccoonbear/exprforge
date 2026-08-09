// Per-target syntax highlighting for the emitted-source cards. Real
// dedicated CodeMirror language packages where they exist (better
// tokenizing than the legacy ports); @codemirror/legacy-modes'
// StreamParser ports for the rest, since it turns out to cover an
// unusually wide set (cobol, fortran, julia, lua, perl, scheme, go, ...)
// straight out of the box. No package exists at all for Zig or QB64/
// BASIC (confirmed by checking, not assumed) -- those two fall back to
// plain, unhighlighted text honestly rather than approximating with a
// wrong language's rules.
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { php } from "@codemirror/lang-php";
import { StreamLanguage } from "@codemirror/language";
import { csharp as legacyCSharp } from "@codemirror/legacy-modes/mode/clike";
import { lua as legacyLua } from "@codemirror/legacy-modes/mode/lua";
import { perl as legacyPerl } from "@codemirror/legacy-modes/mode/perl";
import { julia as legacyJulia } from "@codemirror/legacy-modes/mode/julia";
import { fortran as legacyFortran } from "@codemirror/legacy-modes/mode/fortran";
import { scheme as legacyScheme } from "@codemirror/legacy-modes/mode/scheme";
import { cobol as legacyCobol } from "@codemirror/legacy-modes/mode/cobol";
import type { Extension } from "@codemirror/state";

const CSHARP = StreamLanguage.define(legacyCSharp);
const LUA = StreamLanguage.define(legacyLua);
const PERL = StreamLanguage.define(legacyPerl);
const JULIA = StreamLanguage.define(legacyJulia);
const FORTRAN = StreamLanguage.define(legacyFortran);
const SCHEME = StreamLanguage.define(legacyScheme);
const COBOL = StreamLanguage.define(legacyCobol);

// Keyed by emitters/registry.js's own language keys (see
// languageMeta.ts), so this stays a single lookup rather than a second
// parallel naming scheme to keep in sync.
const HIGHLIGHT: Record<string, Extension> = {
    js: javascript(),
    ts: javascript({ typescript: true }),
    python: python(),
    java: java(),
    csharp: CSHARP,
    c: cpp(),
    go: go(),
    rust: rust(),
    lua: LUA,
    perl: PERL,
    php: php(),
    julia: JULIA,
    fortran: FORTRAN,
    scheme: SCHEME,
    cobol: COBOL,
    // Our own printer output -- close enough to JS-family punctuation
    // that the same approximation the main editor already uses fits.
    expr: javascript(),
    // No CodeMirror language exists for either -- confirmed by checking
    // the actual package registry, not assumed. Falls through to
    // `undefined`, which LanguageCard renders as plain text.
    // zig: undefined,
    // qb64: undefined,
};

export function highlightExtensionFor(languageId: string): Extension[] {
    const ext = HIGHLIGHT[languageId];
    return ext ? [ext] : [];
}
