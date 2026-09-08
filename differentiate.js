// exprforge/differentiate.js
//
// Symbolic differentiation: differentiate(node, varName) returns an AST
// node representing the derivative of `node` with respect to `varName`.
//
// The result is an ordinary AST in the exact same representation as
// everything else -- emittable to all 18 targets via emit()/emitMany()
// unchanged, and evaluable via evaluate() for the numerical verification
// the issue describes (central-difference proof).
//
// Scope: all differentiable primitives in the AST grammar.
// Non-differentiable operations (floor, ceil, round, trunc, sign) throw
// with a clear error at differentiation time rather than silently
// producing a wrong result.
//
// Design notes:
//   - No simplification pass here -- product/quotient/chain rules produce
//     expression swell (terms like `* 1`, `+ 0`). That's expected and
//     left to a separate constant-folding / algebraic-simplification
//     pass (issue #9) to clean up. Keeping this file purely mechanical
//     makes every rule obviously correct by inspection.
//   - Every rule is structural: it only looks at node.type and recurses.
//     No alpha-renaming, no capture-avoiding substitution -- the output
//     is a fresh tree built from the input's subterms, never mutating
//     the input.

const { num, v, bin, call, add, mul, sub, div, neg, select, cmp } = require("./ast.js");

// The non-differentiable built-in primitives. These are piecewise-constant
// or discontinuous -- no meaningful derivative exists. Throwing here
// catches the mistake at differentiation time rather than silently
// producing a semantically wrong AST that happens to evaluate.
const NON_DIFFERENTIABLE = new Set(["floor", "ceil", "round", "trunc", "sign"]);

// differentiate(node, varName) -> Node
//
// Returns the symbolic derivative of `node` with respect to the variable
// named `varName`. The input is never mutated.
function differentiate(node, varName) {
    return simplify(differentiateRaw(node, varName));
}

function differentiateRaw(node, varName) {
    switch (node.type) {
        // d/dx c = 0
        case "num":
            return num(0);

        // d/dx x = 1, d/dx y = 0
        case "var":
            return node.name === varName ? num(1) : num(0);

        // Binary arithmetic: product rule, quotient rule, sum/difference rule
        case "bin":
            return differentiateBin(node, varName);

        // Function calls: chain rule + one derivative rule per intrinsic
        case "call":
            return differentiateCall(node, varName);

        // select/cmp: differentiate both branches (both are always
        // evaluated by design -- this is a value, not a branch). The
        // condition's derivative is irrelevant (it selects, not computes).
        case "select":
            return select(
                node.cond,
                differentiateRaw(node.then, varName),
                differentiateRaw(node.else, varName),
            );

        default:
            throw new Error(
                `differentiate(): unexpected node type "${node.type}" -- ` +
                `"let"/"outputs"/"field" must already be resolved by expandMacros/collectLets before differentiation`,
            );
    }
}

function differentiateBin(node, varName) {
    const { op, left, right } = node;
    const dl = differentiateRaw(left, varName);
    const dr = differentiateRaw(right, varName);

    switch (op) {
        // d/dx (f + g) = f' + g'
        case "+":
            return add(dl, dr);

        // d/dx (f - g) = f' - g'
        case "-":
            return sub(dl, dr);

        // Product rule: d/dx (f * g) = f' * g + f * g'
        case "*":
            return add(mul(dl, right), mul(left, dr));

        // Quotient rule: d/dx (f / g) = (f' * g - f * g') / g²
        case "/":
            return div(
                sub(mul(dl, right), mul(left, dr)),
                mul(right, right),
            );

        default:
            throw new Error(`differentiateBin(): unknown op "${op}"`);
    }
}

function differentiateCall(node, varName) {
    const { name, args } = node;

    if (NON_DIFFERENTIABLE.has(name)) {
        throw new Error(
            `differentiate(): "${name}" is not differentiable (piecewise-constant/discontinuous)`,
        );
    }

    // Unary primitives: chain rule is d/dx f(u) = f'(u) * u'
    // where u = args[0] and u' = differentiate(args[0], varName).
    //
    // Binary primitives: chain rule is d/dx f(u, v) = (∂f/∂u * u' + ∂f/∂v * v')
    // where partial derivatives are computed treating the other arg as constant.

    const du = differentiateRaw(args[0], varName);

    switch (name) {
        // d/dx sqrt(u) = u' / (2 * sqrt(u))
        case "sqrt":
            return div(du, mul(num(2), call("sqrt", args[0])));

        // d/dx abs(u) = u' * sign(u)
        case "abs":
            return mul(du, call("sign", args[0]));

        // d/dx sin(u) = u' * cos(u)
        case "sin":
            return mul(du, call("cos", args[0]));

        // d/dx cos(u) = -u' * sin(u)
        case "cos":
            return mul(neg(du), call("sin", args[0]));

        // d/dx tan(u) = u' / cos²(u) = u' * (1 + tan²(u))
        // Using 1/cos² form via sec² identity avoids needing a sec builtin.
        case "tan":
            return mul(du, add(num(1), mul(call("tan", args[0]), call("tan", args[0]))));

        // d/dx asin(u) = u' / sqrt(1 - u²)
        case "asin":
            return div(du, call("sqrt", sub(num(1), mul(args[0], args[0]))));

        // d/dx acos(u) = -u' / sqrt(1 - u²)
        case "acos":
            return div(neg(du), call("sqrt", sub(num(1), mul(args[0], args[0]))));

        // d/dx atan(u) = u' / (1 + u²)
        case "atan":
            return div(du, add(num(1), mul(args[0], args[0])));

        // d/dx log(u) = u' / u
        case "log":
            return div(du, args[0]);

        // d/dx log2(u) = u' / (u * ln(2))
        case "log2":
            return div(du, mul(args[0], num(Math.LN2)));

        // d/dx log10(u) = u' / (u * ln(10))
        case "log10":
            return div(du, mul(args[0], num(Math.LN10)));

        // d/dx exp(u) = u' * exp(u)
        case "exp":
            return mul(du, call("exp", args[0]));

        // d/dx pow(u, v) -- three cases:
        //   1. v is constant: d/dx u^v = v * u^(v-1) * u'  (power rule)
        //   2. u is constant: d/dx c^v = c^v * ln(c) * v'   (exponential rule)
        //   3. Both vary:      d/dx u^v = u^v * (v' * ln(u) + v * u'/u)
        case "pow": {
            const dv = differentiateRaw(args[1], varName);
            const uIsConst = isConstant(args[0], varName);
            const vIsConst = isConstant(args[1], varName);

            if (vIsConst) {
                // Power rule: v * u^(v-1) * u'
                return mul(
                    mul(args[1], call("pow", args[0], sub(args[1], num(1)))),
                    du,
                );
            }
            if (uIsConst) {
                // Exponential rule: c^v * ln(c) * v'
                return mul(
                    mul(node, call("log", args[0])),
                    dv,
                );
            }
            // General: u^v * (v' * ln(u) + v * u'/u)
            return mul(
                node,
                add(
                    mul(dv, call("log", args[0])),
                    mul(args[1], div(du, args[0])),
                ),
            );
        }

        // d/dx atan2(u, v) = (u' * v - u * v') / (u² + v²)
        // Partial w.r.t. first arg (u): v / (u² + v²)
        // Partial w.r.t. second arg (v): -u / (u² + v²)
        case "atan2": {
            const dv = differentiateRaw(args[1], varName);
            const denom = add(mul(args[0], args[0]), mul(args[1], args[1]));
            return div(
                sub(mul(du, args[1]), mul(args[0], dv)),
                denom,
            );
        }

        // d/dx min(u, v):
        //   If u < v: derivative is du (min is u)
        //   If v < u: derivative is dv (min is v)
        //   If equal: undefined, but both branches evaluated anyway
        case "min": {
            const dv = differentiateRaw(args[1], varName);
            return select(cmp(args[0], "<", args[1]), du, dv);
        }

        // d/dx max(u, v):
        //   If u > v: derivative is du (max is u)
        //   If v > u: derivative is dv (max is v)
        case "max": {
            const dv = differentiateRaw(args[1], varName);
            return select(cmp(args[0], ">", args[1]), du, dv);
        }

        // d/dx hypot(u, v) = (u * u' + v * v') / hypot(u, v)
        case "hypot": {
            const dv = differentiateRaw(args[1], varName);
            return div(
                add(mul(args[0], du), mul(args[1], dv)),
                call("hypot", args[0], args[1]),
            );
        }

        default:
            throw new Error(`differentiate(): unknown call "${name}"`);
    }
}

// Check whether a node is a constant with respect to varName -- a num
// literal, or a var reference to anything OTHER than the differentiation
// variable. Doesn't recurse into subtrees -- if the node is a call/bin,
// it's not constant (even if all its leaves are). This is deliberately
// conservative: we only need to distinguish "definitely constant" (num,
// unrelated var) from "might not be" (everything else) for the pow()
// special cases.
function isConstant(node, varName) {
    if (node.type === "num") return true;
    if (node.type === "var") return node.name !== varName;
    return false;
}

// Bottom-up algebraic simplification. Handles the expression swell that
// differentiation rules inevitably produce (terms like `* 0`, `+ 0`,
// `* 1`, `/ 1`, `^ 0`, `^ 1`). Runs to fixpoint — a single pass can
// create new simplifiable patterns (e.g. `0 * (x + 0)` → `0 * x` → `0`).
function simplify(node) {
    if (!node || typeof node !== "object") return node;

    // Recurse bottom-up first.
    if (node.type === "bin") {
        node = { ...node, left: simplify(node.left), right: simplify(node.right) };
    } else if (node.type === "call") {
        node = { ...node, args: node.args.map(simplify) };
    } else if (node.type === "select") {
        node = {
            ...node,
            then: simplify(node.then),
            else: simplify(node.else),
            cond: { ...node.cond, left: simplify(node.cond.left), right: simplify(node.cond.right) },
        };
    } else {
        return node; // num, var — nothing to simplify
    }

    // --- bin node simplifications ---
    if (node.type === "bin") {
        const { op, left, right } = node;

        // Constant folding: if both operands are num literals, evaluate.
        if (left.type === "num" && right.type === "num") {
            switch (op) {
                case "+": return num(left.value + right.value);
                case "-": return num(left.value - right.value);
                case "*": return num(left.value * right.value);
                case "/": return num(left.value / right.value);
            }
        }

        if (op === "+") {
            if (left.type === "num" && left.value === 0) return right;
            if (right.type === "num" && right.value === 0) return left;
        }

        if (op === "-") {
            if (right.type === "num" && right.value === 0) return left;
            if (left.type === "num" && left.value === 0) {
                // 0 - x → -(x): if x is a num, fold to negated literal
                if (right.type === "num") return num(-right.value);
                return mul(num(-1), right);
            }
        }

        if (op === "*") {
            if (left.type === "num" && left.value === 0) return num(0);
            if (right.type === "num" && right.value === 0) return num(0);
            if (left.type === "num" && left.value === 1) return right;
            if (right.type === "num" && right.value === 1) return left;
            // -1 * x → negated
            if (left.type === "num" && left.value === -1) return mul(num(-1), right);
            if (right.type === "num" && right.value === -1) return mul(num(-1), left);
        }

        if (op === "/") {
            if (left.type === "num" && left.value === 0) return num(0);
            if (right.type === "num" && right.value === 1) return left;
        }
    }

    // --- call node simplifications ---
    if (node.type === "call" && node.name === "pow" && node.args.length === 2) {
        const [base, exp] = node.args;
        if (exp.type === "num" && exp.value === 0) return num(1);
        if (exp.type === "num" && exp.value === 1) return base;
    }

    return node;
}

module.exports = { differentiate };
