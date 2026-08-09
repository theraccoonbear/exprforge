import { useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { exprForgeLanguage } from "./exprForgeMode";
import { useExprForge } from "./useExprForge";
import { LanguageCard } from "./LanguageCard";
import { InterpreterCard } from "./InterpreterCard";
import { LANGUAGE_META } from "./languageMeta";
import { EXAMPLES } from "./examples";

const SOURCE_PARAM = "src";
const MOBILE_BREAKPOINT_PX = 640;

function readSourceFromUrl(): string | null {
    // URLSearchParams.get() already decodes -- do NOT also call
    // decodeURIComponent() here (found the hard way: doing both, paired
    // with the equally-doubled encode in copyLink() below, happened to
    // round-trip correctly by accident since both sides were doubled
    // symmetrically, but produced needlessly mangled URLs and would
    // break the moment only one side ever changed).
    return new URLSearchParams(window.location.search).get(SOURCE_PARAM);
}

function defaultToggledLanguages(): Set<string> {
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT_PX;
    const ids = Object.entries(LANGUAGE_META)
        .filter(([, meta]) => (isMobile ? meta.defaultOnMobile : meta.defaultOn))
        .map(([id]) => id);
    return new Set(ids);
}

// A real fn/expr mode (exprForgeMode.ts), not a borrowed approximation
// -- an earlier version of this used @codemirror/lang-javascript as a
// stand-in, which broke visibly on "#" comments containing an
// apostrophe (JS has no "#" comment syntax, so its tokenizer read the
// apostrophe in e.g. "Binet's formula" as the start of a string
// literal, corrupting highlighting for the rest of the line).
const editorExtensions = [exprForgeLanguage];

export function PlaygroundTool() {
    const [source, setSource] = useState(() => readSourceFromUrl() ?? EXAMPLES[0].source);
    const [enabled, setEnabled] = useState(defaultToggledLanguages);
    const [linkCopied, setLinkCopied] = useState(false);

    const { error, def, outputs } = useExprForge(source);
    const languageIds = useMemo(() => Object.keys(LANGUAGE_META), []);

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
                <CodeMirror
                    value={source}
                    height="220px"
                    theme={oneDark}
                    extensions={editorExtensions}
                    onChange={setSource}
                    basicSetup={{ lineNumbers: true, foldGutter: false }}
                />
                {error && <div className="playground-error">{error}</div>}
            </div>

            {def && <InterpreterCard def={def} />}

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
                {outputs &&
                    languageIds
                        .filter((id) => enabled.has(id))
                        .map((id) => <LanguageCard key={id} languageId={id} label={LANGUAGE_META[id].label} result={outputs[id]} />)}
            </div>
        </div>
    );
}
