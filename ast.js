// exprforge/ast.js
// Generic AST builder primitives — this is the actual library API. Compose
// these into your own expression trees; see samples/ for worked examples.
//
// Node shapes:
//   { type: "num",    value: number }
//   { type: "var",    name: string }
//   { type: "bin",    op: "+" | "-" | "*" | "/", left: Node, right: Node }
//   { type: "call",   name: string, args: Node[] }   // any Math.* function
//   { type: "let",    name: string, value: Node, body: Node }
//   { type: "cmp",    op: ">" | "<" | ">=" | "<=" | "==" | "!=", left: Node, right: Node }
//   { type: "select", cond: CmpNode, then: Node, else: Node }
//   { type: "outputs", fields: { [name: string]: Node } }
//
// Every "bin" node is emitted with explicit parens in every target, so
// operation order (and therefore floating-point rounding behavior) is
// identical everywhere.

function num(value) {
    return { type: "num", value };
}

function v(name) {
    return { type: "var", name };
}

function bin(op, left, right) {
    return { type: "bin", op, left, right };
}

function call(name, ...args) {
    return { type: "call", name, args };
}

function add(...terms) {
    return terms.reduce((acc, t) => (acc === null ? t : bin("+", acc, t)), null);
}

function mul(...terms) {
    return terms.reduce((acc, t) => (acc === null ? t : bin("*", acc, t)), null);
}

function sub(a, b) {
    return bin("-", a, b);
}

function div(a, b) {
    return bin("/", a, b);
}

// Unary negation, since there's no unary operator in the AST — every
// operator here is binary. `0 - x` rather than `-1 * x`: both are always
// safe to emit, but subtraction from zero is the more direct reading.
function neg(x) {
    return sub(num(0), x);
}

// Name a subexpression to avoid recomputing it (e.g. sqrt(x²+y²+z²) once,
// then divide three components by it). Lifted out by collectLets before
// emission — see there for how `v(name)` ends up referring to it.
function letIn(name, value, body) {
    return { type: "let", name, value, body };
}

// Comparison predicate — only valid as the `cond` of a select(); not a
// general boolean expression, and shouldn't appear anywhere else in a tree.
function cmp(left, op, right) {
    return { type: "cmp", op, left, right };
}

// Conditional *value* selection, not a branch — both `then` and `else` are
// always evaluated by every emitter (this is a value expression, not
// control flow). Do not use this to guard division by zero or any other
// undefined operation: ensure the operands are already safe (e.g. clamp a
// denominator with its own select before dividing by it), or keep a real
// guard as hand-written code in the caller of the generated function.
function select(cond, thenNode, elseNode) {
    return { type: "select", cond, then: thenNode, else: elseNode };
}

// Multiple named outputs computed from ONE shared let-chain, instead of N
// separate function definitions each re-deriving the whole chain from
// scratch. Only valid as a function's (post-let-lifting) top-level body —
// wrap it, don't nest it inside bin/call/select. Each emitter renders it as
// whatever multi-value idiom its language has (a struct, a native multiple
// return, an object literal, output parameters) — see formatSuite in each
// emitters/<lang>.js.
function outputs(fields) {
    return { type: "outputs", fields };
}

// Lifts every `let` node out of the tree into a flat, ordered list of
// { name, node } bindings, replacing each with a plain v(name) reference.
// The list is in dependency order — safe to declare/assign top-to-bottom.
// Throws if two bindings share a name: they'd silently shadow or fail to
// redeclare depending on the target language, and there's no lexical
// scoping here to make that meaningful — every binding lands in one flat
// list per function.
function collectLets(node) {
    const bindings = [];

    function walk(n) {
        if (n.type === "let") {
            const { bindings: inner, body: val } = collectLets(n.value);
            bindings.push(...inner);
            bindings.push({ name: n.name, node: val });
            return walk(n.body);
        }
        if (n.type === "bin") return { ...n, left: walk(n.left), right: walk(n.right) };
        if (n.type === "call") return { ...n, args: n.args.map(walk) };
        if (n.type === "select") {
            return {
                ...n,
                then: walk(n.then),
                else: walk(n.else),
                cond: { ...n.cond, left: walk(n.cond.left), right: walk(n.cond.right) },
            };
        }
        if (n.type === "outputs") {
            const fields = {};
            for (const [name, fieldNode] of Object.entries(n.fields)) {
                fields[name] = walk(fieldNode);
            }
            return { ...n, fields };
        }
        return n; // num, var
    }

    const body = walk(node);

    const seen = new Set();
    for (const { name } of bindings) {
        if (seen.has(name)) {
            throw new Error(`collectLets: duplicate let binding name "${name}" in one function`);
        }
        seen.add(name);
    }

    return { bindings, body };
}

module.exports = { num, v, bin, call, add, mul, sub, div, neg, letIn, cmp, select, outputs, collectLets };
