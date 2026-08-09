import { useState } from "react";

interface LanguageCardProps {
    label: string;
    ext: string;
    source: string;
}

export function LanguageCard({ label, ext, source }: LanguageCardProps) {
    const [copied, setCopied] = useState(false);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(source);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch {
            // Clipboard access can be denied (permissions, insecure
            // context) -- not worth surfacing as an error state, the
            // source is still right there to select by hand.
        }
    }

    return (
        <section className="lang-card">
            <header className="lang-card-header">
                <span className="lang-card-label">{label}</span>
                <div className="lang-card-header-actions">
                    <span className="lang-card-ext">.{ext}</span>
                    <button type="button" className="lang-card-copy" onClick={handleCopy}>
                        {copied ? "Copied" : "Copy"}
                    </button>
                </div>
            </header>
            <pre className="lang-card-source">
                <code>{source}</code>
            </pre>
        </section>
    );
}
