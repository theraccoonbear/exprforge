import { useMemo, useState } from "react";
import { ExprForge } from "../../lib/exprforge";
import type { FnDef } from "../../lib/exprforgeTypes";

const { evaluate } = ExprForge;

interface InterpreterCardProps {
    def: FnDef;
}

// Lives directly under the editor, not among the toggleable output
// cards -- this is an input to editing/testing the formula (param
// values feeding evaluate()), not a target-language output view, so it
// shouldn't compete visually or structurally with the language grid
// below it.
export function InterpreterCard({ def }: InterpreterCardProps) {
    const [values, setValues] = useState<Record<string, string>>({});

    const args = useMemo(
        () =>
            def.params.map((p) => {
                const raw = values[p] ?? "";
                return def.paramTypes?.[p] === "number[]" ? parseArrayInput(raw) : Number(raw || 0);
            }),
        [def.params, def.paramTypes, values],
    );

    const result = useMemo(() => {
        try {
            return { value: evaluate(def, args), error: null as string | null };
        } catch (e) {
            return { value: null, error: e instanceof Error ? e.message : String(e) };
        }
    }, [def, args]);

    return (
        <div className="interpreter-panel">
            <span className="interpreter-panel-label">Try it</span>
            <div className="interpreter-panel-inputs">
                {def.params.map((p) => {
                    const isArray = def.paramTypes?.[p] === "number[]";
                    return (
                        <label key={p} className="interpreter-input">
                            <span>{p}</span>
                            <input
                                type={isArray ? "text" : "number"}
                                inputMode={isArray ? "text" : "decimal"}
                                value={values[p] ?? ""}
                                placeholder={isArray ? "10, 20, 30" : "0"}
                                onChange={(e) => setValues((prev) => ({ ...prev, [p]: e.target.value }))}
                            />
                        </label>
                    );
                })}
            </div>
            <span className="interpreter-panel-arrow" aria-hidden="true">
                →
            </span>
            <ResultDisplay error={result.error} value={result.value} />
        </div>
    );
}

// Array-typed param input is comma-separated numbers ("10, 20, 30") --
// the simplest text shape that round-trips through a single <input>
// without a dedicated multi-field widget. Empty/whitespace-only input
// becomes an empty array, not [NaN] -- evaluate() then throws its own
// clear "array index ... out of bounds" error for that (same
// error-display path as any other bad input here), instead of a
// confusing NaN silently propagating through the index expression.
function parseArrayInput(raw: string): number[] {
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map(Number);
}

function ResultDisplay({ error, value }: { error: string | null; value: number | Record<string, number> | null }) {
    if (error) {
        return <div className="interpreter-panel-result interpreter-panel-result--error">{error}</div>;
    }
    if (value === null) {
        return <div className="interpreter-panel-result" />;
    }
    if (typeof value === "number") {
        return <div className="interpreter-panel-result">{formatNumber(value)}</div>;
    }
    // A multi-output result -- one labeled field per row (matching the
    // param-input aesthetic above it), not a single line of proportional-
    // font JSON crammed in next to the arrow.
    return (
        <div className="interpreter-panel-result interpreter-panel-result--fields">
            {Object.entries(value).map(([name, fieldValue]) => (
                <span key={name} className="interpreter-panel-field">
                    <span className="interpreter-panel-field-name">{name}:</span> {formatNumber(fieldValue)}
                </span>
            ))}
        </div>
    );
}

// Long floats (e.g. an irrational result) are truncated to a readable
// number of significant digits -- the raw double's ~17-digit round-trip
// precision is correctness-relevant for evaluate() itself, but not
// something worth spelling out in full in a UI meant to be read at a
// glance.
function formatNumber(n: number): string {
    if (!Number.isFinite(n)) return String(n);
    if (Number.isInteger(n)) return String(n);
    return n.toPrecision(6).replace(/\.?0+$/, "");
}
