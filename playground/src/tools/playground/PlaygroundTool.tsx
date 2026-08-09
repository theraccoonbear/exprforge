import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useExprForge } from "./useExprForge";
import { LanguageCard } from "./LanguageCard";
import { InterpreterCard } from "./InterpreterCard";
import { LANGUAGE_META, INTERPRETER_ID } from "./languageMeta";

const DEFAULT_SOURCE = `normalize(x, y):
let mag = sqrt(x^2 + y^2);
return mag > 0 ? x / mag : 0;
`;

const SOURCE_PARAM = "src";
const MOBILE_BREAKPOINT_PX = 640;

function readSourceFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get(SOURCE_PARAM);
    if (!encoded) return null;
    try {
        return decodeURIComponent(encoded);
    } catch {
        return null;
    }
}

function defaultToggledLanguages(): Set<string> {
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT_PX;
    const ids = Object.entries(LANGUAGE_META)
        .filter(([, meta]) => (isMobile ? meta.defaultOnMobile : meta.defaultOn))
        .map(([id]) => id);
    return new Set([...ids, INTERPRETER_ID]);
}

// CodeMirror's built-in JavaScript mode isn't fn/expr's real grammar --
// it's a deliberate, documented approximation (see the plan: a real
// language grammar overlaps with the separate, unstarted
// docs/editor-support-spec.md editor-tooling work and isn't required
// for this to be useful). Identifiers/keywords/numbers/punctuation still
// highlight sensibly since the token shapes are similar enough.
const editorExtensions = [javascript()];

export function PlaygroundTool() {
    const [source, setSource] = useState(() => readSourceFromUrl() ?? DEFAULT_SOURCE);
    const [enabled, setEnabled] = useState(defaultToggledLanguages);

    const debouncedSource = useDebouncedValue(source, 200);
    const { error, def, outputs } = useExprForge(debouncedSource);

    // Keep the URL in sync so the current example is always shareable --
    // replaceState (not push) so every keystroke doesn't spam browser
    // history.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        params.set(SOURCE_PARAM, encodeURIComponent(debouncedSource));
        const next = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState(null, "", next);
    }, [debouncedSource]);

    const languageIds = useMemo(() => Object.keys(LANGUAGE_META), []);

    function toggle(id: string) {
        setEnabled((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    return (
        <div className="playground">
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

            <div className="playground-toggles" role="group" aria-label="Toggle visible outputs">
                <button
                    type="button"
                    className={enabled.has(INTERPRETER_ID) ? "toggle-chip toggle-chip--active" : "toggle-chip"}
                    onClick={() => toggle(INTERPRETER_ID)}
                >
                    Interpreter
                </button>
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
                {def && enabled.has(INTERPRETER_ID) && <InterpreterCard def={def} />}
                {outputs &&
                    languageIds
                        .filter((id) => enabled.has(id))
                        .map((id) => <LanguageCard key={id} label={LANGUAGE_META[id].label} ext={outputs[id].ext} source={outputs[id].source} />)}
            </div>
        </div>
    );
}
