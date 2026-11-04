import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { highlightExtensionFor } from "./highlighting";
import type { CardResult } from "./useExprForge";
import { LatexExtras } from "./LatexExtras";

interface LanguageCardProps {
    languageId: string;
    label: string;
    result: CardResult;
    latexDocument?: string | null;
}

// A read-only, unpadded CodeMirror instance rather than a plain
// <pre><code> block -- real per-language tokenizing (see
// highlighting.ts) instead of no highlighting at all, at the cost of
// one CodeMirror instance per visible card. Fine at this scale (a
// handful of toggled-on cards, not every target rendered simultaneously by
// default).
const READONLY_THEME = EditorView.theme({
    "&": { fontSize: "0.8rem" },
    ".cm-content": { padding: "0.75rem" },
    ".cm-scroller": { maxHeight: "320px" },
});

export function LanguageCard({ languageId, label, result, latexDocument = null }: LanguageCardProps) {
    const [copied, setCopied] = useState(false);

    async function handleCopy() {
        if (!result.ok) return;
        try {
            await navigator.clipboard.writeText(result.source);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch {
            // Clipboard access can be denied (permissions, insecure
            // context) -- not worth surfacing as an error state, the
            // source is still right there to select by hand.
        }
    }

    return (
        <section className={result.ok ? "lang-card" : "lang-card lang-card--error"}>
            <header className="lang-card-header">
                <span className="lang-card-label">{label}</span>
                <div className="lang-card-header-actions">
                    {result.ok && <span className="lang-card-ext">.{result.ext}</span>}
                    {result.ok && (
                        <button type="button" className="lang-card-copy" onClick={handleCopy}>
                            {copied ? "Copied" : "Copy"}
                        </button>
                    )}
                </div>
            </header>
            {result.ok && languageId === "latex" && <LatexExtras source={result.source} documentSource={latexDocument} />}
            {result.ok ? (
                <CodeMirror
                    value={result.source}
                    editable={false}
                    theme={oneDark}
                    basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
                    extensions={[...highlightExtensionFor(languageId), READONLY_THEME]}
                />
            ) : (
                <pre className="lang-card-source lang-card-source--error">{result.error}</pre>
            )}
        </section>
    );
}
