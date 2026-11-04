import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface LatexExtrasProps {
    // The bare (wrap: "none") LaTeX source.
    source: string;
    // The wrap: "document" form of the same formula, or null if unavailable.
    documentSource: string | null;
}

const CODECOGS_PREFIX = "https://latex.codecogs.com/svg.image?";
const OVERLEAF_PREFIX = "https://www.overleaf.com/docs?snip=";

// Longest full URL either link will be offered for. Both links carry the
// whole formula in the query string. Measured against CodeCogs: requests
// up to ~10.5k characters succeeded and ~11.5k failed outright (no HTTP
// response), so the service itself is not the tight limit. 6000 leaves
// headroom under the 8k request-line/header limit that common proxies and
// servers default to (nginx's large_client_header_buffers is 8k), which
// Overleaf's side is not documented to exceed. It still admits all but the
// largest bundled sample formula.
export const MAX_LINK_URL_LENGTH = 6000;

const THIRD_PARTY_NOTE = "Clicking sends this formula to a third-party site.";

export function codecogsUrl(source: string): string {
    return CODECOGS_PREFIX + encodeURIComponent(source);
}

export function overleafUrl(documentSource: string): string {
    return OVERLEAF_PREFIX + encodeURIComponent(documentSource);
}

function ExternalLink({ href, label, title }: { href: string | null; label: string; title: string }) {
    if (href === null || href.length > MAX_LINK_URL_LENGTH) {
        return (
            <span className="latex-link latex-link--disabled" aria-disabled="true" title={`${label} unavailable`}>
                {label} (formula too long to send as a link)
            </span>
        );
    }
    return (
        <a className="latex-link" href={href} target="_blank" rel="noopener noreferrer" title={`${title} ${THIRD_PARTY_NOTE}`}>
            {label}
        </a>
    );
}

export function LatexExtras({ source, documentSource }: LatexExtrasProps) {
    const html = useMemo(
        () => katex.renderToString(source, { displayMode: true, throwOnError: false }),
        [source],
    );
    return (
        <div className="latex-extras">
            <div className="latex-preview" aria-label="Rendered preview" dangerouslySetInnerHTML={{ __html: html }} />
            <div className="latex-links">
                <ExternalLink href={codecogsUrl(source)} label="Open in CodeCogs" title="Renders the formula as an SVG image." />
                <ExternalLink
                    href={documentSource === null ? null : overleafUrl(documentSource)}
                    label="Open in Overleaf"
                    title="Opens the formula as a new Overleaf project (requires an Overleaf account)."
                />
            </div>
        </div>
    );
}
