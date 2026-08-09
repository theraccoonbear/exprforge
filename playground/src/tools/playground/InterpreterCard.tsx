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

    const args = useMemo(() => def.params.map((p) => Number(values[p] ?? 0)), [def.params, values]);

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
                {def.params.map((p) => (
                    <label key={p} className="interpreter-input">
                        <span>{p}</span>
                        <input
                            type="number"
                            inputMode="decimal"
                            value={values[p] ?? ""}
                            placeholder="0"
                            onChange={(e) => setValues((prev) => ({ ...prev, [p]: e.target.value }))}
                        />
                    </label>
                ))}
            </div>
            <span className="interpreter-panel-arrow" aria-hidden="true">
                →
            </span>
            <div className={result.error ? "interpreter-panel-result interpreter-panel-result--error" : "interpreter-panel-result"}>
                {result.error ?? formatResult(result.value)}
            </div>
        </div>
    );
}

function formatResult(value: number | Record<string, number> | null): string {
    if (value === null) return "";
    if (typeof value === "number") return String(value);
    return JSON.stringify(value);
}
