import { useMemo } from "react";
import { ExprForge } from "../../lib/exprforge";
import type { EmitResult, FnDef } from "../../lib/exprforgeTypes";

const { fn, emitAll } = ExprForge;

function isFnDef(x: unknown): x is FnDef {
    return (
        !!x &&
        typeof x === "object" &&
        Array.isArray((x as { params?: unknown }).params) &&
        typeof (x as { name?: unknown }).name === "string"
    );
}

export const MISSING_SIGNATURE_MESSAGE =
    'Add a "name(params):" signature line to make this runnable -- e.g. "myFormula(a, b):" as the first line.';

export interface ExprForgeResult {
    error: string | null;
    def: FnDef | null;
    outputs: Record<string, EmitResult> | null;
}

// The one place the playground actually talks to the real, bundled
// exprforge library -- fn() to parse, emitAll() to get every target's
// source at once. Both calls are the literal library functions, not a
// reimplementation, so whatever this shows is genuinely what
// require("exprforge") produces, not an approximation of it.
export function useExprForge(source: string): ExprForgeResult {
    return useMemo<ExprForgeResult>(() => {
        if (!source.trim()) {
            return { error: null, def: null, outputs: null };
        }

        let parsed: unknown;
        try {
            // fn(strings, ...values) is a tagged-template function --
            // called directly here (not as a template literal) with a
            // one-element string array and no interpolation values.
            parsed = fn([source]);
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e), def: null, outputs: null };
        }

        if (!isFnDef(parsed)) {
            return { error: MISSING_SIGNATURE_MESSAGE, def: null, outputs: null };
        }

        try {
            const outputs = emitAll(parsed);
            return { error: null, def: parsed, outputs };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e), def: parsed, outputs: null };
        }
    }, [source]);
}
