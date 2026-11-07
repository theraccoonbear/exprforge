import type { Tool } from "../types";
import { PlaygroundTool } from "./PlaygroundTool";
import { PLAYGROUND_TOOL_ID } from "./id";

const tool: Tool = {
    id: PLAYGROUND_TOOL_ID,
    label: "Playground",
    description: "Write a formula, see it emitted live across every target language.",
    component: PlaygroundTool,
    order: 10,
};

export default tool;
