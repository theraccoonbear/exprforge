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
    {
        id: "haversine",
        label: "Haversine distance (great-circle, km)",
        source: `# Great-circle distance between two lat/lon points on a sphere of
# Earth's radius (6371 km) -- NYC to London is roughly 5570 km.
haversineDistance(lat1, lon1, lat2, lon2):
  let toRad = 0.017453292519943295;
  let dLat = (lat2 - lat1) * toRad;
  let dLon = (lon2 - lon1) * toRad;
  let a = sin(dLat / 2)^2 + cos(lat1 * toRad) * cos(lat2 * toRad) * sin(dLon / 2)^2;
  let c = 2 * atan2(sqrt(a), sqrt(1 - a));
  return 6371 * c;
`,
    },
    {
        id: "smoothstep",
        label: "Smoothstep",
        source: `# Classic graphics/shader easing curve -- 0 below edge0, 1 above
# edge1, smoothly interpolated (zero first derivative at both ends)
# in between.
smoothstep(edge0, edge1, x):
  let t = x < edge0 ? 0 : x > edge1 ? 1 : (x - edge0) / (edge1 - edge0);
  return t^2 * (3 - 2 * t);
`,
    },
    {
        id: "catmullRom",
        label: "Catmull-Rom spline (1 component)",
        source: `# Same formula samples/catmull-rom.js uses in the core library --
# passes exactly through p1 at t=0 and p2 at t=1.
catmullRom(p0, p1, p2, p3, t):
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - 3 * p2 + p3 - p0) * t3);
`,
    },
    {
        id: "sigmoid",
        label: "Sigmoid (logistic function)",
        source: `sigmoid(x):
  return 1 / (1 + exp(-x));
`,
    },
];
