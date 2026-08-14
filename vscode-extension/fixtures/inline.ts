import { fn, expr, evaluate } from "exprforge";

const normalize2 = fn`
    normalize2(x, y):
      let mag = sqrt(x^2 + y^2);
      return { nx: x / mag, ny: y / mag };
`;

const scaled = expr`${base} * 2 + offset`;

evaluate(normalize2, [3, 4]);
