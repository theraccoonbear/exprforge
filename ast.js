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
//   { type: "index",   target: Node, at: Node }
//
// "index" is fixed-position array access (arr[i]) -- NOT iteration, NOT a
// dynamic-length loop; see docs/array-index-primitives.md for the full
// design rationale and why this stays inside the "expression tree, no
// statements" model. `target` is expected to resolve to an array-typed
// value (see the {name, params, body} shape's optional `paramTypes` field
// below); indexing into anything else is caught at evaluate()/emit time,
// not here -- same "defer semantic validation to the consumer" precedent
// `call()`/`field()` already follow for names this layer can't itself
// verify.
//
// A {name, params, body} function definition's `params` stays plain
// string[] as always -- NOT restructured to carry type info inline, since
// that would break every existing `fn.params.map(...)`/`.join(...)` call
// site across this codebase for a feature only some functions use. An
// array-typed parameter is instead declared via an OPTIONAL sibling field,
// `paramTypes: { [paramName]: "number[]" }`, present only on functions
// that actually have one -- absent (or omitted entirely) means "every
// param is a plain scalar", the same as every function defined before
// this existed.
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
//
// SECURITY: every builder below validates its own name/op/value
// argument(s) -- see assertSafeIdentifier/assertSafeOp/assertFiniteNumber
// just below. This is specifically about these builders being the "raw
// AST" layer -- the one this project's own README recommends reaching
// for when you want the least amount of magic between your formula and
// the code it emits. Without validation, that would have been the LEAST
// safe layer to build from untrusted input, not the most: fn`...`/
// expr`...`'s own tokenizer already only ever produces safe identifier
// characters, so these builders were the one place a malicious/malformed
// name -- e.g. `v('x); process.exit(1); //')` -- could reach emitted
// output completely unchecked, verbatim, in all 16 targets at once.
// Confirmed, not assumed, before this existed.

// Matches fn`...`/expr`...`'s own tokenizer IDENT rule exactly (see
// expr.js's tokenizeSegment) -- anything that couldn't have come out of
// the real parser isn't allowed in here either.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertSafeIdentifier(name, context) {
    if (typeof name !== "string" || !IDENTIFIER.test(name)) {
        throw new Error(
            `${context}: ${JSON.stringify(name)} isn't a safe identifier -- must start with a letter or "_", ` +
            `followed only by letters/digits/"_" (the same rule fn\`...\`/expr\`...\`'s own tokenizer already ` +
            `enforces on anything parsed from text; this only matters when building a tree directly, bypassing ` +
            `the parser)`,
        );
    }
}

const BIN_OPS = new Set(["+", "-", "*", "/"]);
const CMP_OPS = new Set([">", "<", ">=", "<=", "==", "!="]);

function assertSafeOp(op, allowed, context) {
    if (!allowed.has(op)) {
        throw new Error(`${context}: ${JSON.stringify(op)} isn't one of the allowed operators (${[...allowed].join(" ")})`);
    }
}

function assertFiniteNumber(value, context) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
            `${context}: ${JSON.stringify(value)} isn't a finite number -- NaN/Infinity/non-numeric values ` +
            `can't be emitted as a literal in every target`,
        );
    }
}

function num(value) {
    assertFiniteNumber(value, "num()");
    return { type: "num", value };
}

function v(name) {
    assertSafeIdentifier(name, "v()");
    return { type: "var", name };
}

function bin(op, left, right) {
    assertSafeOp(op, BIN_OPS, "bin()");
    return { type: "bin", op, left, right };
}

function call(name, ...args) {
    assertSafeIdentifier(name, "call()");
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
    assertSafeIdentifier(name, "letIn()");
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
    assertSafeOp(op, CMP_OPS, "cmp()");
    return { type: "cmp", op, left, right };
}

// Conditional *value* selection, not a branch -- modeled AS IF both `then`
// and `else` are always evaluated, matching the strictest real targets
// (QB64's arithmetic-multiplication emulation of a ternary; Fortran's
// MERGE, an elemental intrinsic that doesn't short-circuit its arguments,
// confirmed against a real compiler -- see fortran.js's own comment;
// COBOL's picker helper, which spills both branches into temps before the
// call). Do NOT use this to guard division by zero or any other undefined
// operation, even though most OTHER targets happen to short-circuit at
// the native-language level (a plain ternary/if-else/and-or/if-special-
// form -- confirmed directly: this is true of evaluate() itself, and of
// JS/TS/Java/C/C#/Python/Rust/Go/Lua/Scheme/Zig/Julia/Perl/PHP's emitted
// output) -- relying on that isn't part of this AST's own contract, only
// an implementation detail of 15 of 18 targets that the remaining 3 don't
// share, so it breaks silently and unevenly rather than being something
// safe to build on. Ensure the operands are already safe instead (e.g.
// clamp a denominator with its own select before dividing by it), or keep
// a real guard as hand-written code in the caller of the generated
// function.
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
    for (const name of Object.keys(fields)) assertSafeIdentifier(name, "outputs()");
    return { type: "outputs", fields };
}

// Postfix "." field access into a multi-output intrinsic's result — see
// the "field" node-shape comment at the top of this file for what this
// actually means and who consumes it.
function field(target, name) {
    assertSafeIdentifier(name, "field()");
    return { type: "field", target, field: name };
}

// Fixed-position array access (arr[i]) — see the "index" node-shape
// comment at the top of this file. `target` is typically v(paramName)
// where paramName is declared array-typed via the function definition's
// `paramTypes` field, but that's checked by evaluate()/each emitter, not
// here — this builder just assembles the node, same "validate the parts
// I own, defer the rest" split every other builder above follows.
function idx(target, at) {
    return { type: "index", target, at };
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
        if (n.type === "index") return { ...n, target: walk(n.target), at: walk(n.at) };
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
    } else if (node.type === "index") {
        collectVarRefs(node.target, refs);
        collectVarRefs(node.at, refs);
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
//
// Also validates fn.name and every fn.params entry as safe identifiers
// (see assertSafeIdentifier above) -- the SAME concern as every builder
// above, just here instead of at a constructor call site, since
// {name, params, body} is a plain object literal shape with no
// constructor function of its own to hook into. This is the one place
// every real consumption path (evaluate(), every emitter's
// emitFunction(), cobol.js's own override) already runs unconditionally,
// so it's the natural single checkpoint for this too.
// Verifies no array-typed parameter (see paramTypes) is ever used as a
// bare value -- valid ONLY as the target of an "index" node (arr[i]),
// never handed to a bin/call/cmp/select/outputs field, or used as the
// index expression itself, directly. There's no array literal and no
// array-typed return anywhere in this grammar (see the "index"
// node-shape comment at the top of this file), so any OTHER appearance
// of an array-typed name is necessarily a bug -- and a genuinely
// dangerous one to leave uncaught here: `return arr;`/`outputs({x: arr})`
// silently "work" on evaluate()/js/python (nothing there minds a JS
// array flowing through untyped) and then fail to even COMPILE on every
// statically-typed target, discovered only per-language, as an opaque
// host-compiler error -- exactly the failure mode this whole feature
// exists to prevent for everything else (see
// docs/array-index-primitives.md). Caught once, here, at the same single
// checkpoint every other structural check in checkUnboundVars already
// runs at, with one clear message, instead of N different opaque ones.
//
// Because `at` (the index expression) is walked through this exact same
// general check rather than being exempted, indexing with anything
// array-typed -- `arr[arr]`, `arr[otherArr]` -- is rejected too, for the
// same reason: an index has to be a number, and an array-typed name is
// never a number on its own, wherever it appears. And because an
// "index" node's own `target` is required to be exactly a bare
// array-typed `var` (see the "index" case below), chained indexing --
// `matrix[i][j]`, or indexing the result of a call/arithmetic expression
// (`sqrt(x)[i]`, `(a + b)[i]`) -- is rejected too: none of those can
// ever BE array-typed in the first place (no multi-dimensional array
// type, no function/primitive that returns one), so "index into it
// again" is caught before it ever reaches evaluate()'s runtime check or
// an emitted target's own compiler.
//
// Mirrors collectVarRefs' own node-type walk above (identical tree
// shape; "let" is already stripped out by collectLets by the time this
// runs, so there's no "let" case needed here either).
function assertNoBareArrayUse(node, arrayTypedNames, fnName) {
    if (node.type === "var") {
        if (arrayTypedNames.has(node.name)) {
            throw new Error(
                `checkUnboundVars: "${fnName}" uses array-typed parameter "${node.name}" as a plain value -- ` +
                `an array-typed parameter is only valid as the target of "${node.name}[i]" indexing; there's no ` +
                `array literal or array-typed return in this grammar (see docs/array-index-primitives.md)`,
            );
        }
    } else if (node.type === "bin") {
        assertNoBareArrayUse(node.left, arrayTypedNames, fnName);
        assertNoBareArrayUse(node.right, arrayTypedNames, fnName);
    } else if (node.type === "call") {
        for (const a of node.args) assertNoBareArrayUse(a, arrayTypedNames, fnName);
    } else if (node.type === "cmp") {
        assertNoBareArrayUse(node.left, arrayTypedNames, fnName);
        assertNoBareArrayUse(node.right, arrayTypedNames, fnName);
    } else if (node.type === "select") {
        assertNoBareArrayUse(node.cond, arrayTypedNames, fnName);
        assertNoBareArrayUse(node.then, arrayTypedNames, fnName);
        assertNoBareArrayUse(node.else, arrayTypedNames, fnName);
    } else if (node.type === "outputs") {
        for (const fieldNode of Object.values(node.fields)) assertNoBareArrayUse(fieldNode, arrayTypedNames, fnName);
    } else if (node.type === "index") {
        // The only way to produce an array-shaped value anywhere in this
        // grammar is a bare reference to an array-typed parameter (or a
        // "let" that's a pure alias of one, tracked into arrayTypedNames
        // by checkUnboundVars below) -- there's no array literal, no
        // function/macro/primitive that returns one, and no
        // multi-dimensional array type. So target.type must be exactly
        // "var", full stop: anything else (a call, an arithmetic
        // expression, a field access, or ANOTHER index -- e.g. chained
        // "matrix[i][j]", whose result is one scalar element, not a
        // second array to index into) is categorically invalid, and
        // rejected here directly rather than walked into -- there's
        // nothing further down any of those to find that would make the
        // outer indexing itself valid.
        if (node.target.type !== "var") {
            throw new Error(
                `checkUnboundVars: "${fnName}" indexes into a "${node.target.type}" expression -- an index ` +
                `target must be a bare array-typed parameter (or a "let" binding that's a direct alias of one); ` +
                `nothing else in this grammar (a call, an arithmetic expression, another index, ...) can ever ` +
                `produce an array-typed value to index into (see docs/array-index-primitives.md)`,
            );
        }
        if (!arrayTypedNames.has(node.target.name)) {
            throw new Error(
                `checkUnboundVars: "${fnName}" indexes into "${node.target.name}", which isn't declared ` +
                `array-typed (fn.paramTypes) -- only an array-typed parameter (or a "let" binding that's a ` +
                `direct alias of one) can be indexed with "[...]"`,
            );
        }
        // `at` is walked through the exact same general check, not
        // exempted -- see this function's own header comment for why
        // that's what closes arr[arr]/arr[otherArr] too, for free.
        assertNoBareArrayUse(node.at, arrayTypedNames, fnName);
    }
    // num: nothing to check.
}

function checkUnboundVars(fn) {
    // checkUnboundVars is called both internally (every real consumption
    // path runs it after expandMacros, see macros.js's own comment on
    // expandMacros) AND directly by callers who want the check on its
    // own (e.g. the playground's useExprForge.ts) -- unlike the internal
    // callers, a direct caller hasn't necessarily gone through
    // expandMacros' own equivalent guard first, so this needs its own
    // copy: without it, `fn.name` below crashes with a raw "Cannot read
    // properties of undefined (reading 'name')" for the same "looked up
    // a macro-only name loadExprSource() never returned" mistake
    // expandMacros' own guard exists to catch clearly instead.
    if (!fn || typeof fn !== "object" || typeof fn.name !== "string" || !Array.isArray(fn.params) ||
        !fn.body || typeof fn.body !== "object" || typeof fn.body.type !== "string") {
        throw new Error(
            `checkUnboundVars: expected a {name, params, body} function definition, got ` +
            `${fn === null ? "null" : typeof fn} -- if this came from a loadExprSource()/loadExpr() result ` +
            `object, double check the definition you're looking up was actually marked "fn" (exported), not ` +
            `"macro" (private -- never included in what that call returns)`,
        );
    }
    assertSafeIdentifier(fn.name, "fn.name");
    for (const p of fn.params) assertSafeIdentifier(p, "fn.params");

    // paramTypes is optional (see the "index" node-shape comment at the
    // top of this file) -- validated here, the one place every real
    // consumption path already runs unconditionally, same as every other
    // check in this function. Every key must be an actual declared
    // param (a typo'd key would otherwise silently do nothing at all,
    // in every target, forever), and "number[]" is the only value
    // supported so far -- see the design doc for why struct-typed array
    // elements are explicitly out of scope for now.
    if (fn.paramTypes !== undefined) {
        if (typeof fn.paramTypes !== "object" || fn.paramTypes === null || Array.isArray(fn.paramTypes)) {
            throw new Error(`checkUnboundVars: "${fn.name}".paramTypes must be a plain {paramName: type} object`);
        }
        for (const [name, type] of Object.entries(fn.paramTypes)) {
            if (!fn.params.includes(name)) {
                throw new Error(
                    `checkUnboundVars: "${fn.name}".paramTypes has an entry for "${name}", which isn't one of ` +
                    `this function's params (${fn.params.length ? fn.params.join(", ") : "none"})`,
                );
            }
            if (type !== "number[]") {
                throw new Error(
                    `checkUnboundVars: "${fn.name}".paramTypes["${name}"] is "${type}" -- only "number[]" is ` +
                    `supported (struct/tuple-typed array elements aren't; see docs/array-index-primitives.md)`,
                );
            }
        }
    }

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

    // Array-typed-parameter misuse check -- see assertNoBareArrayUse's own
    // comment for exactly what this catches and why it lives here.
    // Walked in the same order bindings actually execute (collectLets
    // already guarantees that ordering), growing arrayTypedNames as it
    // goes: a "let" that's a pure rename of an array param (`let a =
    // arr;`) is validated against the set BEFORE being added to it, then
    // becomes array-typed itself for everything checked after -- so a
    // leak hiding behind a rename (`let a = arr; return a;`) still gets
    // caught once the final body is checked against the grown set,
    // exactly like leaking the original name directly would be.
    const arrayTypedNames = new Set(Object.keys(fn.paramTypes || {}));
    for (const { name, node } of bindings) {
        // A pure alias (`let a = arr;`, value is EXACTLY a bare
        // reference to an already-array-typed name) is the one case
        // that must NOT go through the general check below -- the value
        // node IS a bare array-typed var by definition here, which is
        // exactly what that check exists to reject everywhere else.
        // Anything else (arr used inside a larger expression, e.g.
        // `let a = arr + 1;`) still goes through it normally, and still
        // throws.
        if (node.type === "var" && arrayTypedNames.has(node.name)) {
            arrayTypedNames.add(name);
        } else {
            assertNoBareArrayUse(node, arrayTypedNames, fn.name);
        }
    }
    assertNoBareArrayUse(body, arrayTypedNames, fn.name);
}

module.exports = {
    num, v, bin, call, add, mul, sub, div, neg, letIn, letChain, cmp, select, outputs, field, idx, collectLets,
    checkUnboundVars,
    MACRO_GENSYM_PREFIX,
};
