import type { Tool } from "../types";
import { RangesTool } from "./RangesTool";
import { RANGES_TOOL_ID } from "./id";

const tool: Tool = {
    id: RANGES_TOOL_ID,
    label: "Range analysis",
    description: "Interval analysis: declare input ranges, see output bounds and divide-by-zero warnings.",
    component: RangesTool,
    order: 30,
};

export default tool;
