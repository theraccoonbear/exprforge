// playground/src/lib/exprforge.ts
//
// The one place the real "exprforge" module is actually imported --
// every other file goes through this, not "exprforge" directly. See
// exprforge.d.ts's header comment for why: neither a named import
// (`import { fn } from "exprforge"`) nor a default import
// (`import ExprForge from "exprforge"`) survives a real production
// `vite build` (Rollup's CommonJS interop doesn't reliably synthesize
// either for this module's export shape) -- both failed for real before
// this fix. A namespace import is the one form that doesn't depend on
// Rollup's named/default export synthesis at all, but depending on the
// interop settings in play, the real exports can land either directly
// on the namespace object or wrapped one level down under `.default` --
// so this unwraps defensively instead of assuming either shape.
import * as ExprForgeNS from "exprforge";
import type { ExprForgeModuleShape } from "./exprforgeTypes";

const ns = ExprForgeNS as unknown as { default?: ExprForgeModuleShape } & ExprForgeModuleShape;

export const ExprForge: ExprForgeModuleShape = ns.default ?? ns;
