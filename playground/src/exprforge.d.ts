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
    // passes them straight back into evaluate()/emitAll().
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
    export function emitAll(def: FnDef): Record<string, EmitResult>;
    // Real Emitter instances, not just {ext} -- the playground calls
    // emitFunction() per-language itself (see useExprForge.ts) rather
    // than emitAll(), so one target's failure (an unsupported call name,
    // a reserved-name collision, ...) doesn't blank every other card;
    // emitAll() itself has no such isolation (see index.js), it throws
    // on the first emitter that does.
    export const emitters: Record<string, Emitter>;
}
