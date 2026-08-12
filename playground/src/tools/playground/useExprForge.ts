import { useMemo } from "react";
import { ExprForge } from "../../lib/exprforge";
import type { EmitResult, FnDef } from "../../lib/exprforgeTypes";

const { fn, emitMany, checkUnboundVars } = ExprForge;

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

export type CardResult = ({ ok: true } & EmitResult) | { ok: false; error: string };

export interface ExprForgeResult {
    error: string | null;
    def: FnDef | null;
    outputs: Record<string, CardResult> | null;
}

// The one place the playground actually talks to the real, bundled
// exprforge library -- fn() to parse, then emitMany() to get every
// target's source at once, each isolated from the others' failures (see
// exprforge.d.ts's own comment on this). All real library calls, not a
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

        // Checked once, up front -- same tier as a parse error -- rather
        // than left to surface per-emitter below. Every one of the 18
        // targets would throw the IDENTICAL "unbound variable" message
        // (checkUnboundVars runs inside every emitter's own
        // emitFunction() too, see ast.js), which would otherwise render
        // as 18 duplicate error cards instead of one clear message next
        // to the editor.
        try {
            checkUnboundVars(parsed);
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e), def: null, outputs: null };
        }

        const outputs: Record<string, CardResult> = {};
        for (const [lang, result] of Object.entries(emitMany(parsed))) {
            outputs[lang] =
                result.error === null
                    ? { ok: true, ext: result.ext as string, source: result.source as string }
                    : { ok: false, error: result.error };
        }

        return { error: null, def: parsed, outputs };
    }, [source]);
}
