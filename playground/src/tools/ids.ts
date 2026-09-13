// exprforge-playground/src/tools/ids.ts
//
// Tool ids as a tiny standalone module, not inline literals duplicated
// in each tool component or read back from tools/index.ts's TOOLS array
// -- tools/index.ts imports the tool COMPONENTS (PlaygroundTool,
// DifferentiatorTool), so a tool component importing its own id back
// from tools/index.ts would be a circular import.
//
// These are also the exact values App.tsx reads from ?tool=... to
// decide which tab to activate on load, and what each tool's own
// copyLink() writes into that same param -- keeping both sides sourced
// from here means the id a tool copies into its share link and the id
// App.tsx matches against TOOLS can never drift apart.
export const PLAYGROUND_TOOL_ID = "playground";
export const DIFFERENTIATOR_TOOL_ID = "differentiator";
