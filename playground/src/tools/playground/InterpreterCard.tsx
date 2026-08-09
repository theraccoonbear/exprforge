import { useMemo, useState } from "react";
import { ExprForge } from "../../lib/exprforge";
import type { FnDef } from "../../lib/exprforgeTypes";

const { evaluate } = ExprForge;

interface InterpreterCardProps {
    def: FnDef;
}

// The native evaluate() panel -- unlike every LanguageCard, this needs
// actual argument VALUES, not just the parsed AST, so it's its own
// component with a small inline input per parameter rather than a
// straight emitted-source display.
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
        <section className="lang-card lang-card--interpreter">
            <header className="lang-card-header">
                <span className="lang-card-label">Interpreter</span>
                <span className="lang-card-ext">evaluate()</span>
            </header>
            <div className="interpreter-inputs">
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
            {result.error ? (
                <pre className="lang-card-source lang-card-source--error">{result.error}</pre>
            ) : (
                <pre className="lang-card-source">
                    <code>{formatResult(result.value)}</code>
                </pre>
            )}
        </section>
    );
}

function formatResult(value: number | Record<string, number> | null): string {
    if (value === null) return "";
    if (typeof value === "number") return String(value);
    return JSON.stringify(value, null, 2);
}
