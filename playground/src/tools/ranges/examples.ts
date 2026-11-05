export interface RangeExample {
    id: string;
    label: string;
    source: string;
    // param -> "min, max"
    ranges: Record<string, string>;
}

export const RANGE_EXAMPLES: RangeExample[] = [
    {
        id: "unguarded",
        label: "x / d, d may be zero",
        source: `f(x, d):\n  return x / d;\n`,
        ranges: { x: "1, 2", d: "-1, 1" },
    },
    {
        id: "naive-guard",
        label: "guarded by select, but not safe on eager targets",
        source: `f(x, d):\n  return abs(d) > 0.000001 ? x / d : 0;\n`,
        ranges: { x: "1, 2", d: "-1, 1" },
    },
    {
        id: "safe-div",
        label: "safeDiv: clamped denominator",
        source: `f(x, d):\n  return safeDiv(x, d, 0);\n`,
        ranges: { x: "1, 2", d: "-1, 1" },
    },
    {
        id: "dead-branch",
        label: "condition decided by the ranges",
        source: `f(x):\n  return x > 10 ? 1 / x : 0;\n`,
        ranges: { x: "0, 1" },
    },
    {
        id: "length",
        label: "sqrt(x^2 + y^2) + 1",
        source: `f(x, y):\n  return sqrt(x^2 + y^2) + 1;\n`,
        ranges: { x: "-3, 3", y: "-4, 4" },
    },
    {
        id: "sqrt-domain",
        label: "sqrt(x - 1), may leave the domain",
        source: `f(x):\n  return sqrt(x - 1);\n`,
        ranges: { x: "0, 5" },
    },
];
