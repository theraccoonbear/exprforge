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
//   { type: "field",   target: Node, field: string }
//
// "field" is postfix "." access (e.g. b.rx) — parser sugar produced only
// by expr.js/fn.js's grammar, and eliminated by macros.js's
// expandMacros() before a tree ever reaches checkUnboundVars,
// evaluate(), or any emitter. It only makes semantic sense when `target`
// resolves to a name bound to a multi-output *macro* call (see
// macros.js) — that's checked there, not here, same "defer semantic
// validation to the consumer" precedent call() already follows for
// function names. A "field" node reaching evaluate()/an emitter directly
// means expandMacros() was skipped or didn't run to completion; both
// throw their own "unknown node type" error in that case.
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

// Chains N letIn bindings without hand-nesting them (and hand-balancing the
// resulting N closing parens — the nesting depth reflects no real
// hierarchy, only that each binding must be lifted ahead of anything using
// it). Builds the exact same nested `let` structure letIn() would if
// written out by hand: pure authoring sugar, not a new node type, so
// collectLets and every emitter already understand the result unchanged.
//
// `bindings` is an ORDERED array of [name, valueNode] pairs, not a
// {name: valueNode} object like outputs() takes — order is load-bearing
// here (a later binding's value can reference an earlier one's name via
// v(name)), and a plain object's key order isn't reliably that: a binding
// named e.g. "0" would silently sort ahead of everything else. An array
// keeps "this is a strict sequence" explicit instead of resting on that.
//
// Doesn't check for duplicate names itself — collectLets already does,
// with the whole function body in view (see its doc comment); duplicating
// that check here would only see this one chain, not the whole picture.
function letChain(bindings, body) {
    return bindings.reduceRight((acc, [name, value]) => letIn(name, value, acc), body);
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

// Postfix "." field access into a multi-output intrinsic's result — see
// the "field" node-shape comment at the top of this file for what this
// actually means and who consumes it.
function field(target, name) {
    return { type: "field", target, field: name };
}

// The prefix macros.js's own gensym'd internal let-names always start
// with (see substituteAndRename's "let" case there) — defined HERE, not
// there, specifically so collectLets below can recognize a collision
// against one WITHOUT macros.js needing to require this file back (it
// already does the other direction: macros.js requires ast.js). Kept as
// one shared constant rather than a duplicated string literal in both
// files, so it can't quietly drift out of sync between "the name this
// generates" and "the name this recognizes".
const MACRO_GENSYM_PREFIX = "efMacro_";

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
            // A colliding name that happens to start with macros.js's own
            // gensym prefix is almost certainly NOT something you wrote
            // on purpose -- vanishingly unlikely to be an intentional
            // collision, and confusing to debug as a plain "duplicate
            // name" if you don't already know that prefix means
            // "internally generated" -- named explicitly here rather
            // than left for you to work out. The gensym'd name itself is
            // never the one to rename (it's already unique per macro
            // invocation, see toMacro's own comment in macros.js) -- only
            // your OWN same-named binding actually needs to change.
            const hint = name.startsWith(MACRO_GENSYM_PREFIX)
                ? ` -- this looks like an internal name macro expansion generates automatically ` +
                  `(see macros.js's own gensym'd "let" renaming), not something you wrote; if you ` +
                  `have your own let/param actually named "${name}", rename YOURS to something that ` +
                  `doesn't start with "${MACRO_GENSYM_PREFIX}"`
                : "";
            throw new Error(`collectLets: duplicate let binding name "${name}" in one function${hint}`);
        }
        seen.add(name);
    }

    return { bindings, body };
}

// Every v(name) reference anywhere in `node`, regardless of whether
// anything actually declares it -- a pure structural walk, no binding
// awareness at all. `refs` accumulates across recursive calls so this
// can be called repeatedly against several subtrees (e.g. once per
// let-binding's own value, plus once for the final body) and still
// build one combined set. Mirrors collectLets's own node-type walk
// above exactly, since it needs to see the identical tree shape.
function collectVarRefs(node, refs = new Set()) {
    if (node.type === "var") {
        refs.add(node.name);
    } else if (node.type === "bin") {
        collectVarRefs(node.left, refs);
        collectVarRefs(node.right, refs);
    } else if (node.type === "call") {
        for (const a of node.args) collectVarRefs(a, refs);
    } else if (node.type === "cmp") {
        collectVarRefs(node.left, refs);
        collectVarRefs(node.right, refs);
    } else if (node.type === "select") {
        collectVarRefs(node.cond, refs);
        collectVarRefs(node.then, refs);
        collectVarRefs(node.else, refs);
    } else if (node.type === "let") {
        collectVarRefs(node.value, refs);
        collectVarRefs(node.body, refs);
    } else if (node.type === "outputs") {
        for (const fieldNode of Object.values(node.fields)) collectVarRefs(fieldNode, refs);
    }
    // num: nothing to add.
    return refs;
}

// Confirms every var() reference anywhere in fn.body -- inside a
// let-binding's own value, or in the final body/outputs -- corresponds
// to something actually declared: a parameter, or a let binding
// somewhere else in the same function. "Somewhere else", not
// "somewhere earlier": collectLets's own doc comment already
// establishes there's no real lexical scoping here -- every let-binding
// is one flat, function-wide name -- so "declared anywhere in this
// function" is the right, and only meaningful, check, not an
// order-sensitive one.
//
// Catches a typo'd or forgotten identifier at the earliest possible
// point, for every target and for evaluate() uniformly, rather than
// relying on evaluate() happening to hit it at runtime (which it might
// never do -- e.g. a reference inside a select() branch that a
// particular call's arguments never take would never surface that way)
// or on whichever target language's own compiler/runtime eventually
// notices, with wildly inconsistent timing and clarity (a real compile
// error in Java, a silent-until-called ReferenceError in JS). Confirmed
// the gap first, not assumed: before this existed, emitAll() silently
// succeeded across all 18 targets for a body referencing a completely
// undeclared name.
function checkUnboundVars(fn) {
    const { bindings, body } = collectLets(fn.body);
    const declared = new Set([...fn.params, ...bindings.map((b) => b.name)]);

    const referenced = new Set();
    for (const { node } of bindings) collectVarRefs(node, referenced);
    collectVarRefs(body, referenced);

    for (const name of referenced) {
        if (!declared.has(name)) {
            throw new Error(
                `checkUnboundVars: "${name}" is referenced in "${fn.name}" but never declared -- ` +
                `not a parameter (${fn.params.length ? fn.params.join(", ") : "none"}) and no ` +
                `"let ${name} = ..." binding exists anywhere in this function`,
            );
        }
    }
}

module.exports = {
    num, v, bin, call, add, mul, sub, div, neg, letIn, letChain, cmp, select, outputs, field, collectLets,
    checkUnboundVars,
    MACRO_GENSYM_PREFIX,
};
