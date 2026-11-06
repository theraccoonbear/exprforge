import type { Tool } from "../types";
import { DifferentiatorTool } from "./DifferentiatorTool";
import { DIFFERENTIATOR_TOOL_ID } from "./id";

const tool: Tool = {
    id: DIFFERENTIATOR_TOOL_ID,
    label: "Differentiation",
    description: "Symbolic differentiation: enter an expression, get its derivative, verify numerically.",
    component: DifferentiatorTool,
    order: 20,
};

export default tool;
