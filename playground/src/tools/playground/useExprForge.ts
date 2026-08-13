import { useMemo } from "react";
import { ExprForge } from "../../lib/exprforge";
import type { EmitResult, FnDef } from "../../lib/exprforgeTypes";

const { fn, loadExprSource, emitMany, checkUnboundVars } = ExprForge;

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

export interface FunctionResult {
    def: FnDef;
    outputs: Record<string, CardResult>;
}

export interface ExprForgeResult {
    error: string | null;
    // In source order (loadExprSource's own defs object preserves
    // definition order via ordinary string-key insertion order, same as
    // Object.entries() always does) -- empty when the buffer is blank or
    // doesn't parse as a runnable definition at all (an unsigned bare
    // expression, or a genuine error -- see `error` above).
    functions: FunctionResult[];
}

function emitOutputs(def: FnDef): Record<string, CardResult> {
    const outputs: Record<string, CardResult> = {};
    for (const [lang, result] of Object.entries(emitMany(def))) {
        outputs[lang] =
            result.error === null
                ? { ok: true, ext: result.ext as string, source: result.source as string }
                : { ok: false, error: result.error };
    }
    return outputs;
}

// The one place the playground actually talks to the real, bundled
// exprforge library. A single "name(params): ...;" definition -- the
// common case, and everything every example but one demonstrates -- is
// parsed directly by fn(), exactly as before this hook supported more
// than one at all. The source only ever falls back to loadExprSource()
// (which additionally accepts SEVERAL back-to-back definitions, letting
// a later one reference an earlier one as an inline macro -- the same
// "expanded, not called" model loadMacro() itself uses, see the root
// README's "Macros and externs" section) when fn() itself fails to parse
// the WHOLE buffer as one definition -- in practice, almost always
// because there's a second "name(params):" line following the first.
// All real library calls, not a reimplementation, so whatever this shows
// is genuinely what require("exprforge") produces, not an approximation
// of it.
export function useExprForge(source: string): ExprForgeResult {
    return useMemo<ExprForgeResult>(() => {
        if (!source.trim()) {
            return { error: null, functions: [] };
        }

        let defs: Record<string, FnDef>;
        try {
            // fn(strings, ...values) is a tagged-template function --
            // called directly here (not as a template literal) with a
            // one-element string array and no interpolation values.
            const parsed = fn([source]);
            if (!isFnDef(parsed)) {
                // A bare Node (no signature line) -- fn() alone can
                // produce this, loadExprSource() never does (every
                // definition there needs a signature, see its own doc
                // comment), so this case is only reachable via THIS
                // branch, not the multi-definition fallback below.
                return { error: MISSING_SIGNATURE_MESSAGE, functions: [] };
            }
            defs = { [parsed.name]: parsed };
        } catch {
            // Not parseable as one definition -- retry as a
            // multi-definition buffer; its own error (if any) is a more
            // relevant message for that case than fn()'s single-
            // definition one would be, so surface THAT one, not the
            // original.
            try {
                defs = loadExprSource(source, "playground");
            } catch (e) {
                return { error: e instanceof Error ? e.message : String(e), functions: [] };
            }
        }

        const functions: FunctionResult[] = [];
        for (const def of Object.values(defs)) {
            // Checked once, up front, per function -- same tier as a
            // parse error -- rather than left to surface per-emitter
            // below. Every one of the 18 targets would throw the
            // IDENTICAL "unbound variable" message (checkUnboundVars
            // runs inside every emitter's own emitFunction() too, see
            // ast.js), which would otherwise render as 18 duplicate
            // error cards instead of one clear message next to the
            // editor. One bad definition blanks the WHOLE buffer's
            // results, not just its own -- consistent with
            // loadExprSource() itself already being all-or-nothing for
            // a genuine parse error.
            try {
                checkUnboundVars(def);
            } catch (e) {
                return { error: e instanceof Error ? e.message : String(e), functions: [] };
            }
            functions.push({ def, outputs: emitOutputs(def) });
        }

        return { error: null, functions };
    }, [source]);
}
