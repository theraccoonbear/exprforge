// exprforge/duplicates.js
//
// Advisory detection of duplicate computation across several function
// definitions (see github.com/theraccoonbear/exprforge/issues/24).
//
// findDuplicateSubexpressions(defs) looks for subtrees that are
// isomorphic up to renaming: every free variable is replaced by a
// positional placeholder in first-appearance order, and every
// let-bound name by a depth-indexed one, so `ay*bz - az*by` and
// `qy*rz - qz*ry` canonicalize identically while `x*x` and `x*y` do not.
//
// Detection and report only. Nothing here rewrites a definition, touches
// the filesystem, or runs as part of loading/emitting -- a caller opts in
// by calling it, and acts on the result (or not) by hand. Each candidate
// carries a proposed `{ name, params, body }` macro definition, ready to
// pass to loadMacro() or to print with emit(def, "expr"); the name is a
// hash-derived placeholder, since a tool cannot know what the shape means.
//
// Definitions produced by loadExprSource()/loadExpr() are already
// macro-expanded, so this runs against the reduced form: a computation
// that was a shared macro in the source shows up as an inlined copy in
// each definition that used it, and is re-detected here.

const DEFAULT_MIN_SIZE = 5;

// 32-bit FNV-1a, as 8 hex digits. Pure JS rather than node:crypto so the
// module also bundles for the browser (the playground); the digest only
// names a placeholder macro, so it needs stability, not cryptographic
// strength.
function shortHash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}

// Children in a stable order. Order matters: it is part of the
// canonical key, so it must be the same for every occurrence.
function children(node) {
    switch (node.type) {
        case "num":
        case "var":
            return [];
        case "bin":
        case "cmp":
            return [node.left, node.right];
        case "call":
            return node.args;
        case "let":
            return [node.value, node.body];
        case "select":
            return [node.cond, node.then, node.else];
        case "outputs":
            return Object.keys(node.fields).map((k) => node.fields[k]);
        case "field":
            return [node.target];
        case "index":
            return [node.target, node.at];
        default:
            throw new Error(`findDuplicateSubexpressions(): unknown node type "${node.type}"`);
    }
}

// Canonicalizes one subtree. Returns { key, ast, freeVars } where `key`
// is a string identical for isomorphic subtrees, `ast` is the subtree
// with placeholders substituted (p0, p1, ... for free variables, t0, t1,
// ... for let-bound names, by nesting depth), and `freeVars` lists the
// original free variable names in placeholder order.
function canonicalize(root) {
    const free = new Map(); // original name -> placeholder index
    const scope = []; // innermost-last stack of let-bound names

    function walk(node) {
        switch (node.type) {
            case "num": {
                const val = Object.is(node.value, -0) ? "-0" : String(node.value);
                return { key: `n${val}`, ast: { type: "num", value: node.value } };
            }
            case "var": {
                const at = scope.lastIndexOf(node.name);
                if (at !== -1) {
                    return { key: `#${scope.length - 1 - at}`, ast: { type: "var", name: `t${at}` } };
                }
                if (!free.has(node.name)) free.set(node.name, free.size);
                const idx = free.get(node.name);
                return { key: `$${idx}`, ast: { type: "var", name: `p${idx}` } };
            }
            case "bin":
            case "cmp": {
                const l = walk(node.left);
                const r = walk(node.right);
                return {
                    key: `(${node.type}${node.op} ${l.key} ${r.key})`,
                    ast: { type: node.type, op: node.op, left: l.ast, right: r.ast },
                };
            }
            case "call": {
                const args = node.args.map(walk);
                return {
                    key: `(call ${JSON.stringify(node.name)} ${args.map((a) => a.key).join(" ")})`,
                    ast: { type: "call", name: node.name, args: args.map((a) => a.ast) },
                };
            }
            case "let": {
                const value = walk(node.value);
                const depth = scope.length;
                scope.push(node.name);
                const body = walk(node.body);
                scope.pop();
                return {
                    key: `(let ${value.key} ${body.key})`,
                    ast: { type: "let", name: `t${depth}`, value: value.ast, body: body.ast },
                };
            }
            case "select": {
                const c = walk(node.cond);
                const t = walk(node.then);
                const e = walk(node.else);
                return {
                    key: `(select ${c.key} ${t.key} ${e.key})`,
                    ast: { type: "select", cond: c.ast, then: t.ast, else: e.ast },
                };
            }
            case "field": {
                const t = walk(node.target);
                return {
                    key: `(field ${JSON.stringify(node.field)} ${t.key})`,
                    ast: { type: "field", target: t.ast, field: node.field },
                };
            }
            case "index": {
                const t = walk(node.target);
                const a = walk(node.at);
                return { key: `(index ${t.key} ${a.key})`, ast: { type: "index", target: t.ast, at: a.ast } };
            }
            default:
                throw new Error(`findDuplicateSubexpressions(): unsupported node type "${node.type}"`);
        }
    }

    const { key, ast } = walk(root);
    return { key, ast, freeVars: [...free.keys()] };
}

function normalizeDefs(defs) {
    let list;
    if (Array.isArray(defs)) {
        list = defs;
    } else if (defs && typeof defs === "object") {
        list = Object.values(defs);
    } else {
        throw new Error("findDuplicateSubexpressions(): defs must be an array of definitions or an object of them (as loadExprSource() returns)");
    }
    const seen = new Set();
    for (const d of list) {
        if (!d || typeof d.name !== "string" || !d.body || typeof d.body.type !== "string") {
            throw new Error("findDuplicateSubexpressions(): every definition must be a { name, params, body } object");
        }
        if (seen.has(d.name)) {
            throw new Error(`findDuplicateSubexpressions(): duplicate definition name "${d.name}"`);
        }
        seen.add(d.name);
    }
    return list;
}

/**
 * Finds computations that appear, up to variable renaming, in two or more
 * of the given definitions.
 *
 * `defs`: an array of `{ name, params, body }` definitions, or an object
 * keyed by name (what loadExprSource()/loadExpr() return).
 *
 * `opts.minSize` (default 5): minimum node count of a reported subtree.
 * Trivial matches (`a + b`) stay below the default; the seven-node
 * pieces of a cross product clear it.
 *
 * Returns candidates, largest first, each:
 *   {
 *     name:        hash-derived placeholder macro name, `shared_<hex>`
 *     size:        node count of the shared subtree
 *     macro:       proposed { name, params, body } (params p0, p1, ...)
 *     occurrences: [{ definition, node, args }]  -- `node` is the matched
 *                  subtree in that definition's own AST, `args` the
 *                  variable names it uses, in `macro.params` order
 *   }
 *
 * Only maximal matches are reported: occurrences that sit inside an
 * occurrence of a larger reported candidate are left out. Matches must
 * span at least two distinct definitions; repeats inside one definition
 * are a different question (a missing `let`) and are not reported.
 * Inputs are never modified.
 */
function findDuplicateSubexpressions(defs, opts = {}) {
    const list = normalizeDefs(defs);
    const minSize = opts.minSize === undefined ? DEFAULT_MIN_SIZE : opts.minSize;
    if (!Number.isInteger(minSize) || minSize < 1) {
        throw new Error(`findDuplicateSubexpressions(): opts.minSize must be a positive integer, got ${minSize}`);
    }

    // One record per tree position (not per node object: macro expansion
    // may share a node object between positions).
    const positions = [];
    function visit(node, parent, def) {
        const rec = { id: positions.length, parent, def, node, size: 1, kids: [] };
        positions.push(rec);
        for (const c of children(node)) {
            const kid = visit(c, rec, def);
            rec.kids.push(kid);
            rec.size += kid.size;
        }
        return rec;
    }
    for (const def of list) visit(def.body, null, def);

    const groups = new Map();
    for (const rec of positions) {
        if (rec.size < minSize || rec.node.type === "outputs") continue;
        const canon = canonicalize(rec.node);
        let g = groups.get(canon.key);
        if (!g) {
            g = { size: rec.size, canon, members: [] };
            groups.set(canon.key, g);
        }
        g.members.push({ rec, freeVars: canon.freeVars });
    }

    const ordered = [...groups.entries()]
        .filter(([, g]) => new Set(g.members.map((m) => m.rec.def)).size >= 2)
        .sort((a, b) => b[1].size - a[1].size);

    const claimed = new Set(); // ids of positions inside an already-reported occurrence
    const markClaimed = (rec) => {
        claimed.add(rec.id);
        rec.kids.forEach(markClaimed);
    };
    const results = [];
    for (const [key, g] of ordered) {
        const accepted = [];
        const acceptedIds = new Set();
        for (const m of g.members) {
            let covered = false;
            for (let p = m.rec; p; p = p.parent) {
                if (claimed.has(p.id) || acceptedIds.has(p.id)) {
                    covered = true;
                    break;
                }
            }
            if (!covered) {
                accepted.push(m);
                acceptedIds.add(m.rec.id);
            }
        }
        if (new Set(accepted.map((m) => m.rec.def)).size < 2) continue;
        for (const m of accepted) markClaimed(m.rec);

        const name = `shared_${shortHash(key)}`;
        results.push({
            name,
            size: g.size,
            macro: { name, params: g.canon.freeVars.map((_, i) => `p${i}`), body: g.canon.ast },
            occurrences: accepted.map((m) => ({ definition: m.rec.def.name, node: m.rec.node, args: m.freeVars })),
        });
    }
    return results;
}

module.exports = { findDuplicateSubexpressions };
