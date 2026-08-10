// Per-target syntax highlighting for the emitted-source cards. Real
// dedicated CodeMirror language packages where they exist (better
// tokenizing than the legacy ports); @codemirror/legacy-modes'
// StreamParser ports for the rest, since it turns out to cover an
// unusually wide set (cobol, fortran, julia, lua, perl, scheme, go, ...)
// straight out of the box. No package exists at all for QB64/BASIC
// (confirmed by checking, not assumed) -- approximated instead via
// legacy-modes' "vb" mode, see below. Zig previously had no coverage
// either under the OFFICIAL @codemirror/lang-zig namespace (which
// doesn't exist), but a real, separately-published third-party package
// does exist -- codemirror-lang-zig by jared-hughes, a genuine
// Lezer-grammar LanguageSupport (same shape as the official lang-*
// packages above, not a StreamParser port), MIT-licensed, ~11.5k
// monthly downloads at the time this was added despite its one release
// being from 2023 -- checked directly (npm view, actual .d.ts exports)
// before trusting it, not assumed safe just because the name matched.
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { php } from "@codemirror/lang-php";
import { zig } from "codemirror-lang-zig";
import { StreamLanguage } from "@codemirror/language";
import { csharp as legacyCSharp } from "@codemirror/legacy-modes/mode/clike";
import { lua as legacyLua } from "@codemirror/legacy-modes/mode/lua";
import { perl as legacyPerl } from "@codemirror/legacy-modes/mode/perl";
import { julia as legacyJulia } from "@codemirror/legacy-modes/mode/julia";
import { fortran as legacyFortran } from "@codemirror/legacy-modes/mode/fortran";
import { scheme as legacyScheme } from "@codemirror/legacy-modes/mode/scheme";
import { cobol as legacyCobol } from "@codemirror/legacy-modes/mode/cobol";
import { vb as legacyVB } from "@codemirror/legacy-modes/mode/vb";
import type { Extension } from "@codemirror/state";
import { exprForgeLanguage } from "./exprForgeMode";

const CSHARP = StreamLanguage.define(legacyCSharp);
const LUA = StreamLanguage.define(legacyLua);
const PERL = StreamLanguage.define(legacyPerl);
const JULIA = StreamLanguage.define(legacyJulia);
const FORTRAN = StreamLanguage.define(legacyFortran);
const SCHEME = StreamLanguage.define(legacyScheme);
const COBOL = StreamLanguage.define(legacyCobol);
// QB64 has no CodeMirror mode of its own -- but it's a classic
// DIM/AS-typed, END-block-terminated BASIC dialect, and legacy-modes'
// "vb" mode (VB.NET-flavored) already covers exactly that vocabulary
// (dim, as, function/end function, double, integer, ...). Not a perfect
// match (VB.NET-only keywords like "namespace"/"imports" just never get
// exercised by real QB64 output), but a real, honest improvement over
// no highlighting at all -- unlike Zig, where nothing close enough
// exists to be worth approximating.
const QB64 = StreamLanguage.define(legacyVB);

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
    // Our own printer output -- the real mode (exprForgeMode.ts), same
    // one the main editor uses, not a borrowed approximation.
    expr: exprForgeLanguage,
    qb64: QB64,
    zig: zig(),
};

export function highlightExtensionFor(languageId: string): Extension[] {
    const ext = HIGHLIGHT[languageId];
    return ext ? [ext] : [];
}
