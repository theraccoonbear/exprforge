import { useEffect, useMemo, useState } from "react";
import type { FunctionResult } from "./useExprForge";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { exprForgeLanguage } from "./exprForgeMode";
import { useExprForge } from "./useExprForge";
import { LanguageCard } from "./LanguageCard";
import { InterpreterCard } from "./InterpreterCard";
import { LANGUAGE_META } from "./languageMeta";
import { EXAMPLES } from "./examples";
import { readStorageJSON, readStorageString, writeStorageJSON, writeStorageString } from "../../lib/storage";
import { ExprForge } from "../../lib/exprforge";

const { fn, loadExprSource } = ExprForge;

const SOURCE_PARAM = "src";
const MOBILE_BREAKPOINT_PX = 640;
const SOURCE_STORAGE_KEY = "source";
const ENABLED_STORAGE_KEY = "enabledLanguages";

function readSourceFromUrl(): string | null {
    // URLSearchParams.get() already decodes -- do NOT also call
    // decodeURIComponent() here (found the hard way: doing both, paired
    // with the equally-doubled encode in copyLink() below, happened to
    // round-trip correctly by accident since both sides were doubled
    // symmetrically, but produced needlessly mangled URLs and would
    // break the moment only one side ever changed).
    return new URLSearchParams(window.location.search).get(SOURCE_PARAM);
}

// Same fallback fn()-then-loadExprSource() attempt useExprForge.ts's own
// hook makes, stripped down to a bare yes/no -- used ONLY to validate
// content that's about to become the editor's INITIAL value (from
// localStorage or a shared link), never against a live keystroke (a
// syntax error while you're mid-edit is exactly what the inline
// `error` display below is for, and must never silently discard
// whatever you're actively typing).
//
// This exists specifically because a real, live incident proved the gap:
// a grammar change (loadExprSource's own "fn"/"macro" requirement, see
// the root README's "Loading a .expr file" section) made previously-
// saved/shared content that used to parse fine throw instead -- and
// since this component used to trust localStorage/the URL unconditionally,
// every returning visitor with old content saved got a raw, confusing
// parse error on load, for text they never typed this session at all.
function sourceParses(source: string): boolean {
    if (!source.trim()) return true; // an empty buffer is never "broken"
    try {
        fn([source]);
        return true;
    } catch {
        try {
            loadExprSource(source, "playground");
            return true;
        } catch {
            return false;
        }
    }
}

// Priority, highest first: an explicit shared link (?src=...) always
// wins -- following a link someone sent you should show THAT formula,
// not silently substitute whatever you last had open. Otherwise, your
// own last session's source from localStorage. Otherwise, the built-in
// default for a genuinely first-ever visit.
//
// Either candidate is validated BEFORE being trusted: content that no
// longer parses (most likely because it predates a breaking grammar
// change -- this has already happened once for real, see sourceParses'
// own comment) is treated exactly as if nothing were saved/shared at
// all, falling through to the next priority instead of handing back
// something the editor can only ever show as a top-level error. The
// stale value gets overwritten with real content on the very next
// render anyway (the effect below re-persists `source` on every
// change), so there's nothing extra to clean up here.
function initialSource(): string {
    const fromUrl = readSourceFromUrl();
    if (fromUrl !== null && sourceParses(fromUrl)) return fromUrl;
    const fromStorage = readStorageString(SOURCE_STORAGE_KEY);
    if (fromStorage !== null && sourceParses(fromStorage)) return fromStorage;
    return EXAMPLES[0].source;
}

function defaultToggledLanguages(): Set<string> {
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT_PX;
    const ids = Object.entries(LANGUAGE_META)
        .filter(([, meta]) => (isMobile ? meta.defaultOnMobile : meta.defaultOn))
        .map(([id]) => id);
    return new Set(ids);
}

function initialEnabledLanguages(): Set<string> {
    const saved = readStorageJSON<string[]>(ENABLED_STORAGE_KEY);
    return saved ? new Set(saved) : defaultToggledLanguages();
}

// A real fn/expr mode (exprForgeMode.ts), not a borrowed approximation
// -- an earlier version of this used @codemirror/lang-javascript as a
// stand-in, which broke visibly on "#" comments containing an
// apostrophe (JS has no "#" comment syntax, so its tokenizer read the
// apostrophe in e.g. "Binet's formula" as the start of a string
// literal, corrupting highlighting for the rest of the line).
const editorExtensions = [exprForgeLanguage];

export function PlaygroundTool() {
    const [source, setSource] = useState(initialSource);
    const [enabled, setEnabled] = useState(initialEnabledLanguages);
    const [linkCopied, setLinkCopied] = useState(false);
    // Which function's interpreter/language cards are showing, when the
    // buffer holds more than one (see useExprForge.ts's own header
    // comment for when that happens) -- a name, not an index, so
    // switching examples/editing text doesn't leave a stale selection
    // pointing at the wrong function; selectedFunction below falls back
    // to the first one whenever this name isn't (or isn't yet) present.
    const [selectedName, setSelectedName] = useState<string | null>(null);

    const { error, functions } = useExprForge(source);
    const languageIds = useMemo(() => Object.keys(LANGUAGE_META), []);

    const selectedFunction: FunctionResult | null = useMemo(() => {
        if (functions.length === 0) return null;
        return functions.find((f) => f.def.name === selectedName) ?? functions[0];
    }, [functions, selectedName]);

    // Persisted so a refresh restores exactly what you had, not the
    // defaults -- your in-progress formula and which languages you'd
    // toggled, independent of each other. A loaded share-link's source
    // becomes the new persisted value too (see initialSource()'s
    // priority ordering) -- opening someone else's formula and coming
    // back later picks up where that visit left off, same as any other
    // edit would.
    useEffect(() => {
        writeStorageString(SOURCE_STORAGE_KEY, source);
    }, [source]);

    useEffect(() => {
        writeStorageJSON(ENABLED_STORAGE_KEY, [...enabled]);
    }, [enabled]);

    function toggle(id: string) {
        setEnabled((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function loadExample(id: string) {
        const example = EXAMPLES.find((e) => e.id === id);
        if (example) setSource(example.source);
    }

    // Explicit, on-demand sharing -- NOT a live URL that mutates on
    // every keystroke. The address bar stays exactly what you'd expect
    // while editing; this builds and copies a shareable link only when
    // asked, using the CURRENT (not debounced) source so what you copy
    // always matches what's on screen right now.
    async function copyLink() {
        const params = new URLSearchParams();
        // .set() already encodes -- see readSourceFromUrl()'s comment.
        params.set(SOURCE_PARAM, source);
        const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
        try {
            await navigator.clipboard.writeText(url);
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 1500);
        } catch {
            // Clipboard access denied -- nothing better to fall back to
            // here without a modal; not worth the complexity for v1.
        }
    }

    return (
        <div className="playground">
            <div className="playground-toolbar">
                <label className="playground-examples">
                    <span>Load example</span>
                    <select onChange={(e) => loadExample(e.target.value)} value="">
                        <option value="" disabled>
                            Choose a formula…
                        </option>
                        {EXAMPLES.map((ex) => (
                            <option key={ex.id} value={ex.id}>
                                {ex.label}
                            </option>
                        ))}
                    </select>
                </label>
                <button type="button" className="playground-copy-link" onClick={copyLink}>
                    {linkCopied ? "Link copied" : "Copy link to this formula"}
                </button>
            </div>

            <div className="playground-editor-pane">
                <div className="playground-editor-resize">
                    <CodeMirror
                        value={source}
                        height="100%"
                        theme={oneDark}
                        extensions={editorExtensions}
                        onChange={setSource}
                        basicSetup={{ lineNumbers: true, foldGutter: false }}
                    />
                </div>
                {error && <div className="playground-error">{error}</div>}
            </div>

            {functions.length > 1 && (
                <div className="function-tabs" role="tablist" aria-label="Choose a function">
                    {functions.map(({ def: fnDef }) => (
                        <button
                            key={fnDef.name}
                            type="button"
                            role="tab"
                            aria-selected={selectedFunction?.def.name === fnDef.name}
                            className={
                                selectedFunction?.def.name === fnDef.name ? "function-tab function-tab--active" : "function-tab"
                            }
                            onClick={() => setSelectedName(fnDef.name)}
                        >
                            {fnDef.name}
                        </button>
                    ))}
                </div>
            )}

            {selectedFunction && <InterpreterCard def={selectedFunction.def} />}

            <div className="playground-toggles" role="group" aria-label="Toggle visible outputs">
                {languageIds.map((id) => (
                    <button
                        key={id}
                        type="button"
                        className={enabled.has(id) ? "toggle-chip toggle-chip--active" : "toggle-chip"}
                        onClick={() => toggle(id)}
                    >
                        {LANGUAGE_META[id].label}
                    </button>
                ))}
            </div>

            <div className="lang-card-grid">
                {selectedFunction &&
                    languageIds
                        .filter((id) => enabled.has(id))
                        .map((id) => (
                            <LanguageCard key={id} languageId={id} label={LANGUAGE_META[id].label} result={selectedFunction.outputs[id]} />
                        ))}
            </div>
        </div>
    );
}
