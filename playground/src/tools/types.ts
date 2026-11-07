import type { ComponentType } from "react";

export interface Tool {
    id: string;
    label: string;
    description: string;
    component: ComponentType;
    // Position in the tab bar; lower comes first.
    order: number;
}
