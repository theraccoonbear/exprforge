import type { Tool } from "../types";
import { DuplicatesTool } from "./DuplicatesTool";
import { DUPLICATES_TOOL_ID } from "./id";

const tool: Tool = {
    id: DUPLICATES_TOOL_ID,
    label: "Duplicates",
    description: "Find computations repeated across several definitions under different variable names.",
    component: DuplicatesTool,
    order: 40,
};

export default tool;
