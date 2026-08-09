// exprforge-playground/src/tools/index.ts
//
// The extension point this whole shell is built around: a "Tool" is any
// self-contained demo panel (the fn`...` -> multi-language playground
// today; a REPL, a differentiator, a simplifier, etc. later -- see
// exprforge's own GitHub issues #6/#9-#12). Adding a new one is meant to
// mean "write one new component, add one line here" -- App.tsx never
// needs to know how many tools exist or what any individual one does.
import type { ComponentType } from "react";
import { PlaygroundTool } from "./playground/PlaygroundTool";

export interface Tool {
    id: string;
    label: string;
    description: string;
    component: ComponentType;
}

export const TOOLS: Tool[] = [
    {
        id: "playground",
        label: "Playground",
        description: "Write a formula, see it emitted live across every target language.",
        component: PlaygroundTool,
    },
    // Future tools slot in here, e.g.:
    // { id: "repl", label: "REPL", description: "...", component: ReplTool },
];
