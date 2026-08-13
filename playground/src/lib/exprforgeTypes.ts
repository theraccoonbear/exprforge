// Plain type re-exports, decoupled from the ambient module declaration
// in exprforge.d.ts -- consumer files import types from here, and the
// actual runtime value from "./exprforge" (see that file's header
// comment for why the two are kept separate).
export type { Node, FnDef, EmitResult, BatchEmitResult, Emitter } from "exprforge";

import type { FnDef, EmitResult, BatchEmitResult, Emitter } from "exprforge";

export interface ExprForgeModuleShape {
    fn(strings: readonly string[], ...values: unknown[]): unknown;
    evaluate(def: FnDef, args: number[]): number | Record<string, number>;
    emit(def: FnDef, lang: string): EmitResult;
    emitMany(def: FnDef, langs?: string[]): Record<string, BatchEmitResult>;
    emitAll(def: FnDef): Record<string, BatchEmitResult>;
    checkUnboundVars(def: FnDef): void;
    emitters: Record<string, Emitter>;
    loadExprSource(source: string, label?: string): Record<string, FnDef>;
    loadMacro(name: string, def: unknown): void;
    loadExtern(name: string, def: unknown): void;
}
