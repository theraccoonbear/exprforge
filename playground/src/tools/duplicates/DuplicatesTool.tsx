import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { Decoration, EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import katex from "katex";
import "katex/dist/katex.min.css";
import { exprForgeLanguage } from "../playground/exprForgeMode";
import { highlightExtensionFor } from "../playground/highlighting";
import { ExprForge } from "../../lib/exprforge";
import { DUPLICATES_SAMPLE, DEFAULT_MIN_SIZE } from "./examples";
import { readStorageString, writeStorageString } from "../../lib/storage";
import type { DuplicateCandidate, FnDef, Node } from "../../lib/exprforgeTypes";

const { loadExprSource, findDuplicateSubexpressions, emit } = ExprForge;

const SOURCE_STORAGE_KEY = "duplicatesSource";
const MIN_SIZE_STORAGE_KEY = "duplicatesMinSize";
const MAX_MIN_SIZE = 30;
const editorExtensions = [exprForgeLanguage];

const READONLY_THEME_EXT = EditorView.theme({
    "&": { fontSize: "0.85rem" },
    ".cm-content": { padding: "0.5rem 0.75rem" },
    ".cm-scroller": { overflow: "auto" },
});

const HIGHLIGHT_THEME = EditorView.theme({
    ".cm-line.dup-line-highlight": { backgroundColor: "rgba(56, 189, 248, 0.22)" },
});

// Multi-definition buffers only: the leading "fn"/"macro" keyword is
// mandatory, and a definition runs until the next such line.
function parses(source: string): boolean {
    if (!source.trim()) return true;
    try {
        loadExprSource(source, "duplicates");
        return true;
    } catch {
        return false;
    }
}

function initialSource(): string {
    const saved = readStorageString(SOURCE_STORAGE_KEY);
    return saved !== null && parses(saved) ? saved : DUPLICATES_SAMPLE;
}

function initialMinSize(): number {
    const n = Number(readStorageString(MIN_SIZE_STORAGE_KEY));
    return Number.isInteger(n) && n >= 1 && n <= MAX_MIN_SIZE ? n : DEFAULT_MIN_SIZE;
}

function printExpr(def: { name: string; params: string[]; body: Node }): string {
    try {
        return emit(def as FnDef, "expr").source.trimEnd();
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

// Just the expression, without the "fn name(params):" signature wrapper.
function printBody(args: string[], node: Node): string {
    const full = printExpr({ name: "m", params: args, body: node });
    const m = /^[\s\S]*?return ([\s\S]*);\s*$/.exec(full);
    return m ? m[1] : full;
}

function printLatex(c: DuplicateCandidate): string | null {
    try {
        return emit(c.macro as FnDef, "latex").source;
    } catch {
        return null;
    }
}

interface Computed {
    candidates: DuplicateCandidate[];
    defNames: string[];
    error: string | null;
}

function compute(source: string, minSize: number): Computed {
    if (!source.trim()) return { candidates: [], defNames: [], error: null };
    try {
        const defs = loadExprSource(source, "duplicates");
        return {
            candidates: findDuplicateSubexpressions(defs, { minSize }),
            defNames: Object.keys(defs),
            error: null,
        };
    } catch (e) {
        return { candidates: [], defNames: [], error: e instanceof Error ? e.message : String(e) };
    }
}

// The AST carries no source positions, so occurrences are located at
// definition granularity: every line of each definition containing an
// occurrence is highlighted, found by scanning for "fn <name>(" lines.
function highlightExtension(source: string, definitions: string[]): Extension {
    if (definitions.length === 0) return [];
    const wanted = new Set(definitions);
    const lines = source.split("\n");
    const starts: { name: string | null; line: number }[] = [];
    lines.forEach((text, i) => {
        const m = /^\s*(fn|macro)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(text);
        if (m) starts.push({ name: m[2], line: i + 1 });
    });
    const marked: number[] = [];
    starts.forEach((s, idx) => {
        if (!s.name || !wanted.has(s.name)) return;
        const end = idx + 1 < starts.length ? starts[idx + 1].line - 1 : lines.length;
        for (let l = s.line; l <= end; l++) if (lines[l - 1].trim() !== "") marked.push(l);
    });
    return EditorView.decorations.compute(["doc"], (state) => {
        const ranges = marked
            .filter((l) => l <= state.doc.lines)
            .map((l) => Decoration.line({ class: "dup-line-highlight" }).range(state.doc.line(l).from));
        return Decoration.set(ranges, true);
    });
}

function Katex({ source }: { source: string }) {
    const html = useMemo(() => katex.renderToString(source, { displayMode: true, throwOnError: false }), [source]);
    return <div className="dup-katex" aria-label="Rendered preview" dangerouslySetInnerHTML={{ __html: html }} />;
}

function CandidateCard({
    candidate,
    active,
    onActivate,
    onDeactivate,
    onSelect,
}: {
    candidate: DuplicateCandidate;
    active: boolean;
    onActivate: () => void;
    onDeactivate: () => void;
    onSelect: () => void;
}) {
    const macroSource = useMemo(() => printExpr(candidate.macro), [candidate]);
    const latex = useMemo(() => printLatex(candidate), [candidate]);
    return (
        <section
            className={active ? "dup-card dup-card--active" : "dup-card"}
            data-candidate={candidate.name}
            onMouseEnter={onActivate}
            onMouseLeave={onDeactivate}
        >
            <header className="dup-card-header">
                <button type="button" className="dup-card-name" onClick={onSelect} aria-pressed={active}>
                    {candidate.name}
                </button>
                <span className="dup-card-meta">
                    {candidate.size} nodes, {candidate.occurrences.length} occurrences
                </span>
            </header>
            <div className="dup-card-label">Proposed macro</div>
            <CodeMirror
                value={macroSource}
                editable={false}
                theme={oneDark}
                basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
                extensions={[...highlightExtensionFor("expr"), READONLY_THEME_EXT]}
            />
            {latex && <Katex source={latex} />}
            <div className="dup-card-label">Occurrences</div>
            <ul className="dup-occurrences">
                {candidate.occurrences.map((o, i) => (
                    <li key={i} className="dup-occurrence">
                        <span className="dup-occurrence-def">{o.definition}</span>
                        <code className="dup-occurrence-text">{printBody(o.args, o.node)}</code>
                        <span className="dup-occurrence-args">
                            {candidate.macro.params.map((p, j) => `${p} ← ${o.args[j]}`).join(", ")}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export function DuplicatesTool() {
    const [source, setSource] = useState(initialSource);
    const [minSize, setMinSize] = useState(initialMinSize);
    const [hovered, setHovered] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);

    useEffect(() => { writeStorageString(SOURCE_STORAGE_KEY, source); }, [source]);
    useEffect(() => { writeStorageString(MIN_SIZE_STORAGE_KEY, String(minSize)); }, [minSize]);

    const { candidates, defNames, error } = useMemo(() => compute(source, minSize), [source, minSize]);

    const activeName = hovered ?? selected;
    const active = candidates.find((c) => c.name === activeName) ?? null;
    const highlighted = useMemo(
        () => highlightExtension(source, active ? active.occurrences.map((o) => o.definition) : []),
        [source, active],
    );
    const editorExts = useMemo(() => [...editorExtensions, HIGHLIGHT_THEME, highlighted], [highlighted]);

    return (
        <div className="dup">
            <div className="dup-toolbar">
                <label className="dup-minsize">
                    <span>Minimum size</span>
                    <input
                        type="range"
                        min={1}
                        max={MAX_MIN_SIZE}
                        value={minSize}
                        onChange={(e) => setMinSize(Number(e.target.value))}
                        aria-label="Minimum subexpression size"
                    />
                    <input
                        type="number"
                        className="dup-minsize-input"
                        min={1}
                        max={MAX_MIN_SIZE}
                        value={minSize}
                        onChange={(e) => {
                            const n = Math.round(Number(e.target.value));
                            if (Number.isFinite(n) && n >= 1) setMinSize(Math.min(n, MAX_MIN_SIZE));
                        }}
                        aria-label="Minimum subexpression size (number)"
                    />
                    <span className="dup-minsize-unit">nodes</span>
                </label>
                <button type="button" className="dup-reset" onClick={() => { setSource(DUPLICATES_SAMPLE); setMinSize(DEFAULT_MIN_SIZE); }}>
                    Reset sample
                </button>
            </div>

            <div className="dup-panes">
                <div className="dup-editor-pane">
                    <div className="dup-pane-header">Definitions ({defNames.length})</div>
                    <div className="dup-editor-resize">
                        <CodeMirror
                            value={source}
                            height="100%"
                            theme={oneDark}
                            extensions={editorExts}
                            onChange={setSource}
                            basicSetup={{ lineNumbers: true, foldGutter: false }}
                        />
                    </div>
                    {error && <div className="dup-error">{error}</div>}
                    <div className="dup-note">
                        The AST has no source positions, so hovering or selecting a candidate highlights every
                        line of each definition that contains an occurrence, not the exact subexpression. The
                        matched text is listed per occurrence.
                    </div>
                </div>

                <div className="dup-results" aria-label="Duplicate candidates">
                    <div className="dup-pane-header">
                        Shared subexpressions{error ? "" : ` (${candidates.length})`}
                    </div>
                    <div className="dup-results-body">
                        {error ? null : candidates.length === 0 ? (
                            <div className="dup-empty">
                                {source.trim()
                                    ? "No shared subexpressions across definitions at this size."
                                    : "Enter two or more definitions to look for shared subexpressions."}
                            </div>
                        ) : (
                            candidates.map((c) => (
                                <CandidateCard
                                    key={c.name}
                                    candidate={c}
                                    active={c.name === activeName}
                                    onActivate={() => setHovered(c.name)}
                                    onDeactivate={() => setHovered(null)}
                                    onSelect={() => setSelected(selected === c.name ? null : c.name)}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
