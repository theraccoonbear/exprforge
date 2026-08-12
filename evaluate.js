// exprforge/evaluate.js
//
// A native tree-walking interpreter over the exact same AST every
// emitter compiles from -- evaluate(fn, args) computes a result (or a
// {name: value} object for a multi-output suite) directly in JS, no
// codegen/compile/subprocess step involved. Reuses collectLets (ast.js)
// for the same let-lifting every emitter already goes through, so this
// walks nodes in the identical dependency order every target does, and
// there's exactly one node-shape contract (ast.js's own header comment)
// for both this file and every emitters/<lang>.js to agree with.
//
// Every primitive name maps 1:1 onto emitters/js.js's own `calls` table
// keys (the simplest existing source of truth for "what the ~22
// primitives are called") straight to the real Math.* function -- this
// target has no codegen step to route an intermediate string through.
const { collectLets, checkUnboundVars } = require("./ast.js");
const { expandMacros, resolveExternForEvaluate } = require("./macros.js");

const CMP_OPS = {
    ">": (a, b) => a > b,
    "<": (a, b) => a < b,
    ">=": (a, b) => a >= b,
    "<=": (a, b) => a <= b,
    "==": (a, b) => a === b,
    "!=": (a, b) => a !== b,
};

const BIN_OPS = {
    "+": (a, b) => a + b,
    "-": (a, b) => a - b,
    "*": (a, b) => a * b,
    "/": (a, b) => a / b,
};

const CALLS = {
    sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, log: Math.log,
    log2: Math.log2, log10: Math.log10, exp: Math.exp, floor: Math.floor,
    ceil: Math.ceil, round: Math.round, trunc: Math.trunc, sign: Math.sign,
    pow: Math.pow, atan2: Math.atan2, min: Math.min, max: Math.max, hypot: Math.hypot,
};

// Handles every node type EXCEPT "let"/"outputs" -- those are only ever
// valid pre-collectLets (a function's top-level let-chain/body shape),
// never nested inside a bin/call/select, same constraint every emitter
// already relies on (see ast.js's own comments on letIn/outputs).
function evalNode(node, env) {
    switch (node.type) {
        case "num":
            return node.value;
        case "var":
            if (!(node.name in env)) {
                throw new Error(`evaluate(): unbound variable "${node.name}"`);
            }
            return env[node.name];
        case "bin": {
            const op = BIN_OPS[node.op];
            if (!op) throw new Error(`evaluate(): unknown bin op "${node.op}"`);
            return op(evalNode(node.left, env), evalNode(node.right, env));
        }
        case "call": {
            const impl = CALLS[node.name] || resolveExternForEvaluate(node.name);
            if (!impl) throw new Error(`evaluate(): no mapping for Math function "${node.name}"`);
            return impl(...node.args.map((a) => evalNode(a, env)));
        }
        case "select": {
            const cmpFn = CMP_OPS[node.cond.op];
            if (!cmpFn) throw new Error(`evaluate(): unknown cmp op "${node.cond.op}"`);
            const cond = cmpFn(evalNode(node.cond.left, env), evalNode(node.cond.right, env));
            return evalNode(cond ? node.then : node.else, env);
        }
        default:
            throw new Error(
                `evaluate(): unexpected node type "${node.type}" -- "let"/"outputs" must already ` +
                `be lifted out by collectLets before evalNode runs`,
            );
    }
}

// evaluate(fn, args) -- fn is a {name, params, body} definition (the
// same shape emitAll() consumes), args is a plain array positional to
// fn.params. Returns a number for a plain body, or a {name: value}
// object for a multi-output (outputs()) body -- matching the shape
// test/conformance.test.js's own parseSuiteOutput() already expects
// back from every other target.
function evaluate(fn, args) {
    // Resolves every macro call and field() access into plain arithmetic
    // FIRST -- checkUnboundVars/collectLets/evalNode below know nothing
    // about either (see macros.js's own header comment); an extern's
    // call node is left alone here, and resolved above in evalNode's own
    // "call" case instead.
    fn = expandMacros(fn);
    // Checked once, up front, exhaustively -- NOT relying on evalNode's
    // own runtime "unbound variable" throw below to happen to hit it,
    // which it might never do for a given call: a bad reference inside
    // a select() branch these particular args don't take would silently
    // never surface that way. See checkUnboundVars's own comment in
    // ast.js. evalNode's runtime check stays in place too, as a cheap
    // internal backstop -- it should be unreachable now that this runs
    // first, same "check early, keep the deeper check anyway" precedent
    // emitters/cobol.js already follows for its own reserved-name checks.
    checkUnboundVars(fn);
    if (args.length !== fn.params.length) {
        throw new Error(`evaluate(): ${fn.name} expects ${fn.params.length} argument(s), got ${args.length}`);
    }
    const env = {};
    fn.params.forEach((name, i) => {
        env[name] = args[i];
    });

    const { bindings, body } = collectLets(fn.body);
    for (const { name, node } of bindings) {
        env[name] = evalNode(node, env);
    }

    if (body.type === "outputs") {
        const result = {};
        for (const [name, node] of Object.entries(body.fields)) {
            result[name] = evalNode(node, env);
        }
        return result;
    }
    return evalNode(body, env);
}

module.exports = { evaluate };
