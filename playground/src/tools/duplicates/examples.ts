// Three definitions that each contain the same distance computation under
// different variable names, plus two definitions that only look alike:
// `x * y + 3` and `x * x + 3` have the same shape but a different
// variable-sharing pattern, so they must NOT be reported as a match.
export const DUPLICATES_SAMPLE = `# The same Euclidean distance appears in three formulas, each with its
# own variable names. The last two definitions are a near-miss: x * y
# and x * x are not the same computation.
fn bounce(px, py, qx, qy, speed):
  return sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy)) * speed;

fn arrival(ax, ay, bx, by, v):
  return sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)) / v;

fn energy(m, ux, uy, wx, wy):
  return m * sqrt((ux - wx) * (ux - wx) + (uy - wy) * (uy - wy)) + 1;

fn product(x, y):
  return x * y + 3;

fn square(x, y):
  return x * x + 3;
`;

export const DEFAULT_MIN_SIZE = 5;
