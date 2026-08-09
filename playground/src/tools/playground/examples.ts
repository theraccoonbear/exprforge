export interface Example {
    id: string;
    label: string;
    source: string;
}

// A small, deliberately varied set -- not trying to be exhaustive, just
// enough to show off different corners of fn`...` syntax (let-chains,
// ternaries, ^, multi-output) without overwhelming a first-time visitor.
// Body lines are indented 2 spaces deeper than the signature line, by
// convention (not required by the parser -- fn's whitespace is
// insignificant) -- matches emitters/exprsyntax.js's own printer output.
export const EXAMPLES: Example[] = [
    {
        id: "normalize",
        label: "Normalize 2D vector",
        source: `normalize(x, y):
  let mag = sqrt(x^2 + y^2);
  return mag > 0 ? x / mag : 0;
`,
    },
    {
        id: "fibonacci",
        label: "Fibonacci (closed form)",
        source: `# Binet's formula -- no loops in this grammar, so a closed form
# instead of the usual iterative version.
fib(n):
  let phi = (1 + sqrt(5)) / 2;
  let psi = (1 - sqrt(5)) / 2;
  return round((phi^n - psi^n) / sqrt(5));
`,
    },
    {
        id: "quadratic",
        label: "Quadratic formula (both roots)",
        source: `quadraticRoots(a, b, cc):
  let disc = sqrt(b^2 - 4 * a * cc);
  return { root1: (-b + disc) / (2 * a), root2: (-b - disc) / (2 * a) };
`,
    },
    {
        id: "lerp",
        label: "Linear interpolation",
        source: `lerp(a, b, t):
  return (b - a) * t + a;
`,
    },
    {
        id: "clamp",
        label: "Clamp",
        source: `clamp(val, lo, hi):
  return val < lo ? lo : val > hi ? hi : val;
`,
    },
];
