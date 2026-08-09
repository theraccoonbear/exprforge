// Plain type re-exports, decoupled from the ambient module declaration
// in exprforge.d.ts -- consumer files import types from here, and the
// actual runtime value from "./exprforge" (see that file's header
// comment for why the two are kept separate).
export type { Node, FnDef, EmitResult } from "exprforge";

import type { FnDef, EmitResult } from "exprforge";

export interface ExprForgeModuleShape {
    fn(strings: readonly string[], ...values: unknown[]): unknown;
    evaluate(def: FnDef, args: number[]): number | Record<string, number>;
    emitAll(def: FnDef): Record<string, EmitResult>;
    emitters: Record<string, { ext: string }>;
}
