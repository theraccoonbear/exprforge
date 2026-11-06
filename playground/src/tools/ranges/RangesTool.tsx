import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { exprForgeLanguage } from "../playground/exprForgeMode";
import { ExprForge } from "../../lib/exprforge";
import { RANGE_EXAMPLES } from "./examples";
import { readStorageString, writeStorageString } from "../../lib/storage";
import type { FnDef, Interval, RangeAnalysis, RangeFinding } from "../../lib/exprforgeTypes";
import { RANGES_TOOL_ID } from "./id";

const { fn, loadExprSource, analyzeRanges } = ExprForge;

const SOURCE_STORAGE_KEY = "rangesSource";
const RANGES_STORAGE_KEY = "rangesValues";
const TOOL_PARAM = "tool";
const SOURCE_PARAM = "src";
const RANGES_PARAM = "ranges";
const editorExtensions = [exprForgeLanguage];

function parseDef(source: string): FnDef | null {
    if (!source.trim()) return null;
    try {
        const parsed = fn([source]);
        if (parsed && typeof parsed === "object" && "name" in parsed) return parsed as FnDef;
    } catch { /* fall through */ }
    try {
        const defs = loadExprSource(source, "ranges");
        const names = Object.keys(defs);
        if (names.length > 0) return defs[names[0]];
    } catch { /* fall through */ }
    return null;
}

function readJson(raw: string | null): Record<string, string> | null {
    if (raw === null) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function initialSource(): string {
    const fromUrl = new URLSearchParams(window.location.search).get(SOURCE_PARAM);
    if (fromUrl !== null && parseDef(fromUrl)) return fromUrl;
    const saved = readStorageString(SOURCE_STORAGE_KEY);
    if (saved !== null && parseDef(saved)) return saved;
    return RANGE_EXAMPLES[0].source;
}

// A ?ranges= value is only trusted paired with a ?src= that validated.
function initialRanges(): Record<string, string> {
    const params = new URLSearchParams(window.location.search);
    const src = params.get(SOURCE_PARAM);
    if (src !== null && parseDef(src)) {
        const fromUrl = readJson(params.get(RANGES_PARAM));
        if (fromUrl) return fromUrl;
    }
    return readJson(readStorageString(RANGES_STORAGE_KEY)) ?? RANGE_EXAMPLES[0].ranges;
}

function fmt(n: number): string {
    if (!Number.isFinite(n)) return n > 0 ? "∞" : "-∞";
    if (Number.isInteger(n)) return String(n);
    return n.toPrecision(6).replace(/\.?0+$/, "").replace(/\.?0+e/, "e");
}

function fmtInterval(i: Interval): string {
    return `[${fmt(i.lo)}, ${fmt(i.hi)}]${i.nan ? " or NaN" : ""}`;
}

// Messages mark source snippets with backticks; render those as <code>.
function MessageText({ text }: { text: string }) {
    return (
        <>
            {text.split("`").map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))}
        </>
    );
}

function FindingItem({ f }: { f: RangeFinding }) {
    const cls = f.severity === "info"
        ? "ranges-finding-info"
        : f.kind === "div-by-zero" ? "ranges-warn-error" : "ranges-warn-guarded";
    return (
        <li className={`ranges-finding ${cls}`} data-severity={f.severity} data-kind={f.kind} title={`debug path: ${f.at}`}>
            <span className="ranges-badge">{f.severity === "info" ? "Note" : "Warning"}</span>{" "}
            <MessageText text={f.message} />
        </li>
    );
}

function parseRange(raw: string): [number, number] | null {
    const parts = raw.split(",").map((s) => s.trim());
    if (parts.length !== 2 || parts.some((p) => p === "")) return null;
    const lo = Number(parts[0]);
    const hi = Number(parts[1]);
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo > hi) return null;
    return [lo, hi];
}

interface Computed {
    analysis: RangeAnalysis | null;
    error: string | null;
}

function compute(def: FnDef | null, raw: Record<string, string>): Computed {
    if (!def) return { analysis: null, error: null };
    const ranges: Record<string, [number, number]> = {};
    for (const p of def.params) {
        const text = (raw[p] ?? "").trim();
        if (text === "") continue;
        const r = parseRange(text);
        if (!r) return { analysis: null, error: `Range for ${p} must be "min, max" with min <= max` };
        ranges[p] = r;
    }
    try {
        return { analysis: analyzeRanges(def, ranges), error: null };
    } catch (e) {
        return { analysis: null, error: e instanceof Error ? e.message : String(e) };
    }
}

export function RangesTool() {
    const [source, setSource] = useState(initialSource);
    const [raw, setRaw] = useState(initialRanges);
    const [linkCopied, setLinkCopied] = useState(false);

    useEffect(() => { writeStorageString(SOURCE_STORAGE_KEY, source); }, [source]);
    useEffect(() => { writeStorageString(RANGES_STORAGE_KEY, JSON.stringify(raw)); }, [raw]);

    const def = useMemo(() => parseDef(source), [source]);
    const { analysis, error } = useMemo(() => compute(def, raw), [def, raw]);
    const parseError = source.trim() && !def ? "Could not parse: expected a definition with a signature line, e.g. f(x): ..." : null;

    function loadExample(id: string) {
        const ex = RANGE_EXAMPLES.find((e) => e.id === id);
        if (ex) {
            setSource(ex.source);
            setRaw(ex.ranges);
        }
    }

    async function copyLink() {
        const params = new URLSearchParams();
        params.set(TOOL_PARAM, RANGES_TOOL_ID);
        params.set(SOURCE_PARAM, source);
        params.set(RANGES_PARAM, JSON.stringify(raw));
        const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
        try {
            await navigator.clipboard.writeText(url);
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 1500);
        } catch { /* clipboard denied */ }
    }

    const range = analysis?.range;
    const single = range && "lo" in range ? (range as Interval) : null;

    return (
        <div className="diff">
            <div className="diff-toolbar">
                <label className="diff-examples">
                    <span>Load example</span>
                    <select onChange={(e) => loadExample(e.target.value)} value="">
                        <option value="" disabled>Choose a formula…</option>
                        {RANGE_EXAMPLES.map((ex) => (
                            <option key={ex.id} value={ex.id}>{ex.label}</option>
                        ))}
                    </select>
                </label>
                <div className="diff-toolbar-right">
                    <button type="button" className="diff-copy-link" onClick={copyLink}>
                        {linkCopied ? "Link copied" : "Copy link"}
                    </button>
                </div>
            </div>

            <div className="diff-panes">
                <div className="diff-editor-pane">
                    <div className="diff-pane-header">f(x)</div>
                    <div className="diff-editor-resize">
                        <CodeMirror
                            value={source}
                            height="100%"
                            theme={oneDark}
                            extensions={editorExtensions}
                            onChange={setSource}
                            basicSetup={{ lineNumbers: true, foldGutter: false }}
                        />
                    </div>
                    {(parseError || error) && <div className="diff-error">{parseError ?? error}</div>}
                </div>

                <div className="diff-result-pane ranges-result">
                    <div className="diff-pane-header">Analysis</div>
                    <p className="ranges-explainer">
                        Given a range for each input, this shows the range the result can take and flags divisions that could hit zero.
                    </p>
                    {analysis ? (
                        <div className="ranges-body">
                            <div className="ranges-row">
                                <span className="ranges-label">Output range</span>
                                {single ? (
                                    <strong className="ranges-output">{fmtInterval(single)}</strong>
                                ) : (
                                    <ul className="ranges-list">
                                        {Object.entries(range as Record<string, Interval>).map(([k, i]) => (
                                            <li key={k}><code>{k}</code> <strong>{fmtInterval(i)}</strong></li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div className="ranges-row">
                                <span className="ranges-label">Findings</span>
                                {analysis.findings.length === 0 ? (
                                    <span className="diff-verify-match ranges-no-warnings">Nothing to report: no division can see a zero denominator.</span>
                                ) : (
                                    <ul className="ranges-list">
                                        {[...analysis.findings]
                                            .sort((x, y) => Number(x.severity === "info") - Number(y.severity === "info"))
                                            .map((f, i) => <FindingItem key={i} f={f} />)}
                                    </ul>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="diff-result-empty">{error || parseError ? "" : "Enter an expression to analyze"}</div>
                    )}
                </div>
            </div>

            {def && def.params.length > 0 && (
                <div className="diff-verify">
                    <span className="diff-verify-label">Input ranges</span>
                    {def.params.map((p) => (
                        <label key={p} className="diff-verify-point">
                            <span>{p}</span>
                            <input
                                type="text"
                                className="diff-verify-input ranges-input"
                                data-param={p}
                                value={raw[p] ?? ""}
                                onChange={(e) => setRaw({ ...raw, [p]: e.target.value })}
                                placeholder="min, max"
                            />
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}
