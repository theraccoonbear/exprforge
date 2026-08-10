// Display metadata for each emitters/registry.js key -- labels and which
// ones are toggled on by default. Deliberately a small curated default
// set rather than all 18 at once (see the plan's "easily see multiple
// toggleable outputs, not overwhelmed by all of them" requirement); the
// full set is always one click away via the toggle chips.
export interface LanguageMeta {
    label: string;
    defaultOn: boolean;
    // Smaller still, for narrow viewports -- "pared down" mobile default.
    defaultOnMobile: boolean;
}

export const LANGUAGE_META: Record<string, LanguageMeta> = {
    js: { label: "JavaScript", defaultOn: true, defaultOnMobile: true },
    ts: { label: "TypeScript", defaultOn: false, defaultOnMobile: false },
    python: { label: "Python", defaultOn: true, defaultOnMobile: false },
    java: { label: "Java", defaultOn: true, defaultOnMobile: true },
    csharp: { label: "C#", defaultOn: false, defaultOnMobile: false },
    c: { label: "C", defaultOn: false, defaultOnMobile: false },
    go: { label: "Go", defaultOn: false, defaultOnMobile: false },
    rust: { label: "Rust", defaultOn: false, defaultOnMobile: false },
    lua: { label: "Lua", defaultOn: false, defaultOnMobile: false },
    perl: { label: "Perl", defaultOn: false, defaultOnMobile: false },
    php: { label: "PHP", defaultOn: false, defaultOnMobile: false },
    julia: { label: "Julia", defaultOn: false, defaultOnMobile: false },
    fortran: { label: "Fortran", defaultOn: false, defaultOnMobile: false },
    zig: { label: "Zig", defaultOn: false, defaultOnMobile: false },
    scheme: { label: "Scheme", defaultOn: true, defaultOnMobile: false },
    cobol: { label: "COBOL", defaultOn: true, defaultOnMobile: true },
    qb64: { label: "QB64", defaultOn: false, defaultOnMobile: false },
    // The 18th "target" -- emitters/exprsyntax.js, the printer that
    // round-trips back through fn() itself. Labeled distinctly from the
    // others since it's not a third-party language.
    expr: { label: "ExprForge syntax (printer)", defaultOn: false, defaultOnMobile: false },
};
