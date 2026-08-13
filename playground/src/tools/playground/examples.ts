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
        label: "Quadratic formula (multi-output: both roots)",
        source: `quadraticRoots(a, b, c):
  let disc = sqrt(b^2 - 4 * a * c);
  return {
    root1: (-b + disc) / (2 * a),
    root2: (-b - disc) / (2 * a)
  };
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
    {
        id: "normalize3",
        label: "Normalize 3D vector (multi-output: x, y, z)",
        source: `# Same shape as math/index.js's real normalize3() helper -- falls
# back to (0, 0, 0) rather than dividing by zero for the degenerate
# input vector.
normalize3(x, y, z):
  let mag = sqrt(x^2 + y^2 + z^2);
  return {
    nx: mag > 0 ? x / mag : 0,
    ny: mag > 0 ? y / mag : 0,
    nz: mag > 0 ? z / mag : 0
  };
`,
    },
    {
        id: "cardano",
        label: "☠️ Cardano's cubic formula (all 3 roots, 16th century)",
        source: `# Cardano's formula (1545) -- the general closed-form solution to
# ax^3 + bx^2 + cx + d = 0. Legendary not just for its size: Cardano
# published Tartaglia's method after swearing not to, which is its own
# whole story.
#
# Real cube roots need sign(v) * abs(v)^(1/3), not v^(1/3) directly --
# a fractional power of a negative base is NaN in real arithmetic (no
# complex numbers in this grammar), so the sign has to be pulled out by
# hand first.
#
# All 5 outputs are pure arithmetic composition, no branching at all --
# root1 is the one guaranteed-real root; root2/root3 are a complex
# conjugate pair, split into real/imaginary parts since there's no
# complex number type here either. Verified against x^3-1=0 (roots are
# exactly the cube roots of unity: 1, -0.5+-0.866i) and cross-checked
# against Vieta's formulas (sum and product of all 3 roots, computed two
# completely independent ways) before trusting this.
#
cardanoAllRoots(a, b, c, d):
  let p = (3 * a * c - b^2) / (3 * a^2);
  let q = (2 * b^3 - 9 * a * b * c + 27 * a^2 * d) / (27 * a^3);
  let disc = (q / 2)^2 + (p / 3)^3;
  let sqrtDisc = sqrt(disc);
  let u = -(q / 2) + sqrtDisc;
  let v = -(q / 2) - sqrtDisc;
  let cbrtU = sign(u) * abs(u)^(1 / 3);
  let cbrtV = sign(v) * abs(v)^(1 / 3);
  let t1 = cbrtU + cbrtV;
  let shift = b / (3 * a);
  return {
    root1: t1 - shift,
    root2Real: -t1 / 2 - shift,
    root2Imag: (sqrt(3) / 2) * (cbrtU - cbrtV),
    root3Real: -t1 / 2 - shift,
    root3Imag: -(sqrt(3) / 2) * (cbrtU - cbrtV)
  };
`,
    },
    {
        id: "crossLength",
        label: "Cross product + length (multi-function buffer)",
        source: `# TWO definitions in one buffer -- crossLength references cross3
# by name below. That reference is inline-expanded at parse time,
# never a real function call in any emitted target -- see the
# README's "Macros and externs" section. Pick which one to run in
# the tabs above the "Try it" panel below.
cross3(ax, ay, az, bx, by, bz):
  let rx = ay * bz - az * by;
  let ry = az * bx - ax * bz;
  let rz = ax * by - ay * bx;
  return { rx, ry, rz };

crossLength(ax, ay, az, bx, by, bz):
  let c = cross3(ax, ay, az, bx, by, bz);
  return sqrt(c.rx^2 + c.ry^2 + c.rz^2);
`,
    },
];
