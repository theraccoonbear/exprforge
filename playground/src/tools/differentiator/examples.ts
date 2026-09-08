export interface DiffExample {
    id: string;
    label: string;
    source: string;
    variable: string;
}

export const DIFF_EXAMPLES: DiffExample[] = [
    {
        id: "sin-x2-ex",
        label: "sin(x^2) * e^x (chain rule)",
        source: `f(x):\n  return sin(x^2) * exp(x);\n`,
        variable: "x",
    },
    {
        id: "sqrt-x2p1",
        label: "sqrt(x^2 + 1)",
        source: `f(x):\n  return sqrt(x^2 + 1);\n`,
        variable: "x",
    },
    {
        id: "pow-x-x",
        label: "x^x (general power rule)",
        source: `f(x):\n  return x^x;\n`,
        variable: "x",
    },
    {
        id: "atan2-sin-cos",
        label: "atan2(sin(x), cos(x))",
        source: `f(x):\n  return atan2(sin(x), cos(x));\n`,
        variable: "x",
    },
    {
        id: "quotient",
        label: "(2x + 1) / (x + 3) (quotient rule)",
        source: `f(x):\n  return (2 * x + 1) / (x + 3);\n`,
        variable: "x",
    },
    {
        id: "log-sin",
        label: "log(sin(x)) (nested chain)",
        source: `f(x):\n  return log(sin(x));\n`,
        variable: "x",
    },
    {
        id: "multi-var",
        label: "sin(x) * cos(y) (partial w.r.t. x)",
        source: `f(x, y):\n  return sin(x) * cos(y);\n`,
        variable: "x",
    },
    {
        id: "hypot",
        label: "hypot(x, 3) (2-arg)",
        source: `f(x):\n  return hypot(x, 3);\n`,
        variable: "x",
    },
];
