// exprforge-playground/src/tools/index.ts
//
// The extension point this whole shell is built around: a "Tool" is any
// self-contained demo panel. Adding one means creating
// tools/<name>/index.ts that default-exports a Tool (see ./types.ts);
// it is discovered here with import.meta.glob and ordered by its `order`
// field, so no central list needs editing and parallel changes that add
// tools never touch the same lines. App.tsx never needs to know how many
// tools exist or what any individual one does.
import type { Tool } from "./types";

export type { Tool } from "./types";

const modules = import.meta.glob<{ default: Tool }>("./*/index.ts", { eager: true });

export const TOOLS: Tool[] = Object.values(modules)
    .map((m) => m.default)
    .sort((a, b) => a.order - b.order);
