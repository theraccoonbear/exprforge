import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { exprForgeLanguage } from "../playground/exprForgeMode";
import { highlightExtensionFor } from "../playground/highlighting";
import { ExprForge } from "../../lib/exprforge";
import { DIFF_EXAMPLES } from "./examples";
import { readStorageString, writeStorageString } from "../../lib/storage";
import type { FnDef, Node } from "../../lib/exprforgeTypes";

const { fn, loadExprSource, differentiate, evaluate, emit } = ExprForge;

const SOURCE_STORAGE_KEY = "diffSource";
const VAR_STORAGE_KEY = "diffVar";
const POINT_STORAGE_KEY = "diffPoint";
const editorExtensions = [exprForgeLanguage];

const READONLY_THEME_EXT = EditorView.theme({
    "&": { fontSize: "0.85rem" },
    ".cm-content": { padding: "0.6rem 0.75rem" },
    ".cm-scroller": { overflow: "auto" },
});

function initialSource(): string {
    const saved = readStorageString(SOURCE_STORAGE_KEY);
    if (saved !== null) {
        try {
            fn([saved]);
            return saved;
        } catch {
            try {
                loadExprSource(saved, "diff");
                return saved;
            } catch {
                // fall through
            }
        }
    }
    return DIFF_EXAMPLES[0].source;
}

function formatNumber(n: number): string {
    if (!Number.isFinite(n)) return String(n);
    if (Number.isInteger(n)) return String(n);
    return n.toPrecision(6).replace(/\.?0+$/, "");
}

function numericalDerivative(def: FnDef, varName: string, point: Record<string, number>, h = 1e-7): number | string {
    const params = def.params;
    const env = params.map((p) => point[p] ?? 0);
    const envP = params.map((p, i) => (p === varName ? env[i] + h : env[i]));
    const envM = params.map((p, i) => (p === varName ? env[i] - h : env[i]));
    try {
        const fPlus = evaluate(def, envP) as number;
        const fMinus = evaluate(def, envM) as number;
        return (fPlus - fMinus) / (2 * h);
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

interface DiffResult {
    derivativeNode: Node | null;
    derivativeSource: string;
    error: string | null;
}

function computeDerivative(source: string, varName: string): DiffResult {
    if (!source.trim()) {
        return { derivativeNode: null, derivativeSource: "", error: null };
    }
    try {
        let def: FnDef;
        try {
            const parsed = fn([source]);
            if (parsed && typeof parsed === "object" && "name" in parsed) {
                def = parsed as FnDef;
            } else {
                return { derivativeNode: null, derivativeSource: "", error: "Expression needs a signature line, e.g. f(x): ..." };
            }
        } catch {
            const defs = loadExprSource(source, "diff");
            const names = Object.keys(defs);
            if (names.length === 0) {
                return { derivativeNode: null, derivativeSource: "", error: "No valid definition found" };
            }
            def = defs[names[0]];
        }

        if (!varName.trim()) {
            return { derivativeNode: null, derivativeSource: "", error: "Enter a variable name to differentiate with respect to" };
        }

        const dNode = differentiate(def.body, varName.trim());

        const diffDef: FnDef = { name: def.name + "'", params: def.params, body: dNode as Node };
        let derivativeSource: string;
        try {
            derivativeSource = emit(diffDef, "expr").source;
        } catch {
            derivativeSource = JSON.stringify(dNode);
        }

        return { derivativeNode: dNode, derivativeSource, error: null };
    } catch (e) {
        return { derivativeNode: null, derivativeSource: "", error: e instanceof Error ? e.message : String(e) };
    }
}

function parsePoint(raw: string, params: string[]): Record<string, number> | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(",").map((s) => s.trim());
    if (parts.length === 1 && params.length === 1) {
        const n = Number(parts[0]);
        return Number.isFinite(n) ? { [params[0]]: n } : null;
    }
    if (parts.length === params.length) {
        const point: Record<string, number> = {};
        for (let i = 0; i < params.length; i++) {
            const n = Number(parts[i]);
            if (!Number.isFinite(n)) return null;
            point[params[i]] = n;
        }
        return point;
    }
    return null;
}

export function DifferentiatorTool() {
    const [source, setSource] = useState(initialSource);
    const [varName, setVarName] = useState(() => readStorageString(VAR_STORAGE_KEY) ?? "x");
    const [pointStr, setPointStr] = useState(() => readStorageString(POINT_STORAGE_KEY) ?? "1");
    const [linkCopied, setLinkCopied] = useState(false);

    useEffect(() => { writeStorageString(SOURCE_STORAGE_KEY, source); }, [source]);
    useEffect(() => { writeStorageString(VAR_STORAGE_KEY, varName); }, [varName]);
    useEffect(() => { writeStorageString(POINT_STORAGE_KEY, pointStr); }, [pointStr]);

    const sourceDef = useMemo(() => {
        if (!source.trim()) return null;
        try {
            const parsed = fn([source]);
            if (parsed && typeof parsed === "object" && "name" in parsed) return parsed as FnDef;
        } catch { /* fall through */ }
        try {
            const defs = loadExprSource(source, "diff");
            const names = Object.keys(defs);
            if (names.length > 0) return defs[names[0]];
        } catch { /* fall through */ }
        return null;
    }, [source]);

    const { derivativeNode, derivativeSource, error: diffError } = useMemo(
        () => computeDerivative(source, varName),
        [source, varName],
    );

    const diffDef = useMemo((): FnDef | null => {
        if (!derivativeNode || !sourceDef) return null;
        return { name: sourceDef.name + "'", params: sourceDef.params, body: derivativeNode as Node };
    }, [derivativeNode, sourceDef]);

    const verification = useMemo(() => {
        if (!sourceDef || !diffDef) return null;
        const point = parsePoint(pointStr, sourceDef.params);
        if (!point) return { symbolic: null, numerical: null, error: "Enter values for all parameters (comma-separated)" };

        let symVal: number | string;
        try {
            const v = evaluate(diffDef, sourceDef.params.map((p) => point[p] ?? 0));
            symVal = typeof v === "number" ? v : JSON.stringify(v);
        } catch (e) {
            symVal = e instanceof Error ? e.message : String(e);
        }

        const numVal = numericalDerivative(sourceDef, varName, point);

        if (typeof symVal === "string" || typeof numVal === "string") {
            return { symbolic: symVal, numerical: numVal, error: null };
        }

        const relErr = Math.abs(numVal) > 1e-10
            ? Math.abs((symVal - numVal) / numVal)
            : Math.abs(symVal - numVal);
        const match = relErr < 1e-4;

        return { symbolic: symVal, numerical: numVal, error: null, match };
    }, [sourceDef, diffDef, pointStr, varName]);

    function loadExample(id: string) {
        const ex = DIFF_EXAMPLES.find((e) => e.id === id);
        if (ex) {
            setSource(ex.source);
            setVarName(ex.variable);
        }
    }

    async function copyLink() {
        const params = new URLSearchParams();
        params.set("src", source);
        params.set("var", varName);
        const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
        try {
            await navigator.clipboard.writeText(url);
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 1500);
        } catch { /* clipboard denied */ }
    }

    return (
        <div className="diff">
            <div className="diff-toolbar">
                <label className="diff-examples">
                    <span>Load example</span>
                    <select onChange={(e) => loadExample(e.target.value)} value="">
                        <option value="" disabled>Choose a formula…</option>
                        {DIFF_EXAMPLES.map((ex) => (
                            <option key={ex.id} value={ex.id}>{ex.label}</option>
                        ))}
                    </select>
                </label>
                <div className="diff-toolbar-right">
                    <label className="diff-var-label">
                        <span>w.r.t.</span>
                        <input
                            type="text"
                            className="diff-var-input"
                            value={varName}
                            onChange={(e) => setVarName(e.target.value)}
                            placeholder="x"
                        />
                    </label>
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
                    {diffError && <div className="diff-error">{diffError}</div>}
                </div>

                <div className="diff-result-pane">
                    <div className="diff-pane-header">f'(x) — symbolic derivative</div>
                    {derivativeSource ? (
                        <CodeMirror
                            value={derivativeSource}
                            editable={false}
                            theme={oneDark}
                            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
                            extensions={[...highlightExtensionFor("expr"), READONLY_THEME_EXT]}
                        />
                    ) : (
                        <div className="diff-result-empty">
                            {diffError ? "" : "Enter an expression to differentiate"}
                        </div>
                    )}
                </div>
            </div>

            {sourceDef && (
                <div className="diff-verify">
                    <span className="diff-verify-label">Numerical check</span>
                    <label className="diff-verify-point">
                        <span>{sourceDef.params.length === 1 ? sourceDef.params[0] : "Values"}</span>
                        <input
                            type="text"
                            className="diff-verify-input"
                            value={pointStr}
                            onChange={(e) => setPointStr(e.target.value)}
                            placeholder={sourceDef.params.join(", ")}
                        />
                    </label>
                    {verification && (
                        <div className="diff-verify-results">
                            {verification.error ? (
                                <span className="diff-verify-error">{verification.error}</span>
                            ) : (
                                <>
                                    <span className="diff-verify-val">
                                        Symbolic: <strong>{typeof verification.symbolic === "number" ? formatNumber(verification.symbolic) : String(verification.symbolic)}</strong>
                                    </span>
                                    <span className="diff-verify-val">
                                        Numerical: <strong>{typeof verification.numerical === "number" ? formatNumber(verification.numerical) : String(verification.numerical)}</strong>
                                    </span>
                                    <span className={verification.match ? "diff-verify-match" : "diff-verify-mismatch"}>
                                        {verification.match ? "Match ✓" : "Mismatch ✗"}
                                    </span>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
