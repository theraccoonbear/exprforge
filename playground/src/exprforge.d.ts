// playground/src/exprforge.d.ts
//
// exprforge ships as plain CommonJS with no type declarations -- and
// deliberately so, that's part of the "zero dependencies" surface (see
// the root README's "Layered by design" section). This is a loose,
// hand-written ambient declaration covering only the surface the
// playground actually calls, not a full type port of the library.
//
// Declared as plain named exports here for the type checker's benefit
// only -- the ACTUAL runtime import in every .ts/.tsx file that uses
// this is a namespace import with a defensive `.default` unwrap (see
// src/lib/exprforge.ts), not a named or default import directly.
// Rollup's CommonJS interop (real production `vite build`, unlike the
// dev server's more lenient esbuild-based transform) doesn't reliably
// synthesize named OR default ESM exports for exprforge's
// `module.exports = {...}` object, since several of its properties
// (fn, evaluate, ...) are themselves destructured from a nested
// require() one file away rather than assigned directly -- confirmed
// against two real `vite build` failures, not assumed on the first
// guess. A namespace import is the one form that doesn't depend on that
// synthesis at all.
declare module "exprforge" {
    // A parsed `fn`/`expr` AST node -- deliberately untyped here (a
    // plain {type: ...} object per ast.js's own node-shape comment).
    // The playground never inspects node internals directly, only
    // passes them straight back into evaluate()/emitMany().
    export type Node = unknown;

    export interface FnDef {
        name: string;
        params: string[];
        body: Node;
    }

    export interface EmitResult {
        ext: string;
        source: string;
    }

    // What emitMany()/emitAll() actually return per language: `ext` is
    // always present (even on failure, so a failed card still knows its
    // file extension), `source` is null and `error` is the failure
    // message when that one language's emitter threw, otherwise `source`
    // is the real output and `error` is null.
    export interface BatchEmitResult {
        ext: string | null;
        source: string | null;
        error: string | null;
    }

    export interface Emitter {
        ext: string;
        emitFunction(def: FnDef): string;
    }

    // fn(strings, ...values) is a tagged-template function; called
    // directly (not as a template literal) with a plain string array
    // and no interpolation values, e.g. fn([sourceText]). Returns a
    // bare Node when the source has no "name(params):" signature line,
    // or a full FnDef when it does -- see fn.js's own header comment.
    export function fn(strings: readonly string[], ...values: unknown[]): Node | FnDef;
    export function evaluate(def: FnDef, args: number[]): number | Record<string, number>;
    // One target, explicit -- throws if `lang` is unknown or if that one
    // emitter fails for this def (nothing to isolate a single target's
    // own error from).
    export function emit(def: FnDef, lang: string): EmitResult;
    // Several targets (default: every registered one), each isolated from
    // the others' failures -- see BatchEmitResult above. This is what
    // useExprForge.ts actually calls now, replacing the hand-rolled
    // per-emitter loop this file used to need to work around emitAll's
    // lack of isolation.
    export function emitMany(def: FnDef, langs?: string[]): Record<string, BatchEmitResult>;
    // Deprecated: every target at once, no way to ask for fewer. Now just
    // emitMany(def) -- kept working, not removed. See index.js.
    export function emitAll(def: FnDef): Record<string, BatchEmitResult>;
    // Confirms every variable reference in def.body is actually declared
    // (a parameter, or a let binding somewhere in the function) --
    // throws with a clear message otherwise. Called once, up front, by
    // useExprForge.ts, so an unbound identifier surfaces as ONE top-level
    // error (same tier as a parse error) rather than the identical
    // message repeated across all 18 per-language cards.
    export function checkUnboundVars(def: FnDef): void;
    // Real Emitter instances, not just {ext} -- exposed for callers that
    // want to enumerate registered languages (e.g. to build `langs` for
    // emitMany()) without emitting anything yet.
    export const emitters: Record<string, Emitter>;
    // Parses source text (not a file -- see loadExprSource's own doc
    // comment for why that matters here specifically) as zero or more
    // "name(params): ...;" definitions back-to-back, keyed by name, each
    // ready to use directly with evaluate()/emit()/emitMany(). A later
    // definition can reference an earlier one by name as an inline
    // macro -- see useExprForge.ts, which is what actually calls this
    // (as a fallback, when the buffer holds more than one definition).
    export function loadExprSource(source: string, label?: string): Record<string, FnDef>;
    // Register a macro/extern -- not currently called by the playground
    // itself (nothing here registers a custom one), typed for
    // completeness since the linked library already exports both.
    export function loadMacro(name: string, def: unknown): void;
    export function loadExtern(name: string, def: unknown): void;
}
