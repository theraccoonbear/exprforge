// exprforge/analyze.js
//
// Interval/range analysis: analyzeRanges(fnDef, ranges) propagates declared
// input ranges through a function definition's AST using standard interval
// arithmetic, producing a sound output range and flagging every `/` whose
// denominator could be zero.
//
// Opt-in static analysis only: nothing in evaluate()/emit() calls this, and
// no AST node shape changes. Input ranges are a plain object passed alongside
// the AST: { paramName: [min, max] }. For an array-typed parameter the range
// bounds every element. An undeclared parameter is unbounded (-Inf..Inf).
//
// Result:
//   {
//     range:    { lo, hi, nan }   or, for an outputs() body, { name: {lo,hi,nan} }
//     findings: [ ... ]            everything worth telling a human, see below
//     warnings: [ ... ]            the findings whose severity is "warning"
//     selects:  [ ... ]            one entry per select() node, see below
//   }
//
// `lo`/`hi` bound every non-NaN value the expression can take; `nan` is true
// when NaN is possible (out-of-domain sqrt/log/asin/acos/pow, 0/0, an
// extern whose behavior is unknown). Bounds are conservative: a range may be
// wider than the true range, never narrower. When an expression can only
// ever be NaN, `lo`/`hi` are 0 and `nan` is true.
//
// Every finding has:
//   kind      what it is (below)
//   severity  "warning" (a hazard worth acting on) or "info" (a note)
//   message   a plain-language sentence quoting the source expression, e.g.
//             "`1 / x` can divide by zero: `x` can be 0 (range -20…20)."
//   expr      the source text the finding is about
//   at        internal AST path, for debugging; not meant for display
//
// Finding kinds:
//   "div-by-zero"   severity "warning". The denominator's interval includes
//                   zero even after narrowing by every enclosing select()
//                   condition. `certain` is true when it is exactly [0, 0].
//   "div-guarded"   severity "warning". The denominator includes zero on its
//                   own but an enclosing select() condition excludes it. Safe
//                   where select() short-circuits, but select() is modeled as
//                   evaluating both branches (see ast.js), and the targets
//                   with meta.selectShortCircuits === false (QB64, Fortran,
//                   COBOL and MATLAB/Octave) do exactly that, so the division
//                   still executes there with a zero denominator. `guards` lists the `at`
//                   path of each enclosing select() the exclusion depends on,
//                   `guardConditions` their condition text.
//   "div-unreachable"  severity "info". A division whose denominator includes
//                   zero sits in a select() branch the ranges prove is never
//                   taken, so it is not a hazard. Also `inDeadBranch: true`.
//   "condition-decided"  severity "info". A select() condition is always
//                   true / never true for the declared ranges (`outcome`).
// `warnings` is exactly the "warning" findings, so unreachable divisions are
// no longer in it (they used to appear there with `inDeadBranch: true`).
//
// selects entries: { at, outcome, loadBearing, condition, severity, message }
//   outcome      "always-then" | "always-else" | "either": whether the
//                condition is decided by the declared ranges alone. A decided
//                condition means the other branch is provably dead and the
//                select() could be simplified away.
//   loadBearing  true when removing the guard would let a division in one of
//                its branches see a zero denominator.
//
// Branch narrowing: the then-branch of select(L op R, ...) is analysed with
// the range of each side narrowed by `L op R`, the else-branch with the range
// narrowed by the negated comparison (> <-> <=, < <-> >=, == <-> !=). Either
// side may be the narrowed one (`x > c` and `c < x`), and it can be any
// expression, including a let-bound name. The narrowed facts apply to every
// structurally identical occurrence of that expression inside the branch.
// If the condition cannot be true (resp. false) once both sides carry their
// own narrowed ranges, that branch is unreachable: it gets no narrowing and
// anything hazardous in it is reported as "div-unreachable", not a warning.
//
// Open bounds: intervals are closed, so a strict bound is approximated by
// its closed hull (x > c becomes x >= c). That only ever widens the range,
// never drops a reachable value. Zero is the one point whose openness
// matters (it decides whether a division is safe), so a separate "nonzero"
// fact is recorded when a strict bound is >= 0 (x > 0, x > 3) or a non-strict
// one is > 0 (x >= 1); x >= 0 keeps zero reachable and stays a hazard.
// `!=` narrows nothing except x != 0, which records "nonzero"; its negation
// (==) narrows to the compared range. abs(E) > c / abs(E) >= c with c > 0
// is recognized as excluding the open interval (-c, c) from E, which is the
// shape safeDiv and the EPS-compared selects in samples/spline-frame.js use.

const { collectLets, checkUnboundVars } = require("./ast.js");
const { expandMacros } = require("./macros.js");
const { PRIMITIVE_ARITY } = require("./primitives.js");
const exprSyntax = require("./emitters/exprsyntax.js");
// Read lazily: emitters/meta.js pulls in the whole emitter registry, which a
// caller of analyzeRanges() alone should not pay for.
const lazyEagerSelectTargets = () => require("./emitters/meta.js").eagerSelectTargets();

const INF = Infinity;
const TWO_PI = 2 * Math.PI;

// Internal interval: { lo, hi, nan, nz?, hole? }
//   nz   : value is known to be nonzero
//   hole : [a, b], value is known to lie outside the open interval (a, b)
function iv(lo, hi, nan = false) {
    return { lo, hi, nan };
}
const FULL = () => iv(-INF, INF, false);
const NAN_ONLY = () => iv(0, 0, true);
const strip = (i) => ({ lo: i.lo, hi: i.hi, nan: i.nan });

// Open interval the value is known to lie outside of, if any.
function holeOf(i) {
    if (i.hole) return i.hole;
    if (i.lo > 0) return [-INF, i.lo];
    if (i.hi < 0) return [i.hi, INF];
    return null;
}

// Smallest interval containing both. The "outside this open interval" and
// "nonzero" facts survive only if both sides carry them.
function hull(a, b) {
    const out = iv(Math.min(a.lo, b.lo), Math.max(a.hi, b.hi), a.nan || b.nan);
    const ha = holeOf(a);
    const hb = holeOf(b);
    if (ha && hb) {
        const lo = Math.max(ha[0], hb[0]);
        const hi = Math.min(ha[1], hb[1]);
        if (lo < hi) out.hole = [lo, hi];
    }
    if ((a.nz || a.lo > 0 || a.hi < 0 || (ha && ha[0] < 0 && ha[1] > 0)) &&
        (b.nz || b.lo > 0 || b.hi < 0 || (hb && hb[0] < 0 && hb[1] > 0))) {
        out.nz = true;
    }
    return out;
}
const mulB = (x, y) => (x === 0 || y === 0 ? 0 : x * y);

function containsZero(i) {
    if (i.lo > 0 || i.hi < 0) return false;
    if (i.nz) return false;
    if (i.hole && i.hole[0] < 0 && i.hole[1] > 0) return false;
    return true;
}

// Pieces of a denominator interval with the known-excluded zero removed.
function pieces(i) {
    let ps = [[i.lo, i.hi]];
    if (i.hole) {
        const [a, b] = i.hole;
        const next = [];
        for (const [lo, hi] of ps) {
            if (lo <= a) next.push([lo, Math.min(hi, a)]);
            if (hi >= b) next.push([Math.max(lo, b), hi]);
        }
        ps = next.filter(([lo, hi]) => lo <= hi);
    }
    if (i.nz) {
        const next = [];
        for (const [lo, hi] of ps) {
            if (lo < 0) next.push([lo, Math.min(hi, 0)]);
            if (hi > 0) next.push([Math.max(lo, 0), hi]);
        }
        ps = next.filter(([lo, hi]) => !(lo === 0 && hi === 0));
    }
    return ps;
}

function recip(lo, hi) {
    if (lo > 0 || (lo === 0 && hi > 0)) return [hi === INF ? 0 : 1 / hi, lo === 0 ? INF : 1 / lo];
    if (hi < 0 || (hi === 0 && lo < 0)) return [hi === 0 ? -INF : 1 / hi, lo === -INF ? 0 : 1 / lo];
    return [-INF, INF];
}

function mulI(a, b) {
    const c = [mulB(a.lo, b.lo), mulB(a.lo, b.hi), mulB(a.hi, b.lo), mulB(a.hi, b.hi)];
    return iv(Math.min(...c), Math.max(...c), a.nan || b.nan);
}

// x*x: the two operands are the same value, so the sign-mixed corner
// products mulI() considers are not reachable.
function squareI(a) {
    const m = absI(a);
    return iv(m.lo * m.lo, m.hi * m.hi, a.nan);
}

function divI(a, b) {
    const zero = containsZero(b);
    let r = null;
    for (const [lo, hi] of pieces(b)) {
        const [rl, rh] = recip(lo, hi);
        const p = mulI(a, iv(rl, rh));
        r = r ? hull(r, p) : p;
    }
    if (!r || zero) r = iv(-INF, INF, false);
    const nan = a.nan || b.nan || (zero && a.lo <= 0 && a.hi >= 0);
    return iv(r.lo, r.hi, nan);
}

function monotone(f, a) {
    return iv(f(a.lo), f(a.hi), a.nan);
}

function absI(a) {
    if (a.lo >= 0) return iv(a.lo, a.hi, a.nan);
    if (a.hi <= 0) return iv(-a.hi, -a.lo, a.nan);
    return iv(0, Math.max(-a.lo, a.hi), a.nan);
}

// sin/cos: extremes at the endpoints or at an interior critical point.
function trigI(f, maxAt, a) {
    if (!Number.isFinite(a.lo) || !Number.isFinite(a.hi) || a.hi - a.lo >= TWO_PI) return iv(-1, 1, a.nan);
    let lo = Math.min(f(a.lo), f(a.hi));
    let hi = Math.max(f(a.lo), f(a.hi));
    const hasPoint = (c0) => c0 + TWO_PI * Math.ceil((a.lo - c0) / TWO_PI) <= a.hi;
    if (hasPoint(maxAt)) hi = 1;
    if (hasPoint(maxAt + Math.PI)) lo = -1;
    return iv(Math.max(-1, lo), Math.min(1, hi), a.nan);
}

function tanI(a) {
    if (!Number.isFinite(a.lo) || !Number.isFinite(a.hi)) return iv(-INF, INF, a.nan);
    const half = Math.PI / 2;
    if (Math.ceil((a.lo - half) / Math.PI) <= Math.floor((a.hi - half) / Math.PI)) return iv(-INF, INF, a.nan);
    return iv(Math.tan(a.lo), Math.tan(a.hi), a.nan);
}

// Domain-restricted function: NaN outside [dLo, dHi]; monotone inside.
function domainI(f, dLo, dHi, a, increasing = true) {
    const nan = a.nan || a.lo < dLo || a.hi > dHi;
    const lo = Math.max(a.lo, dLo);
    const hi = Math.min(a.hi, dHi);
    if (lo > hi) return NAN_ONLY();
    return increasing ? iv(f(lo), f(hi), nan) : iv(f(hi), f(lo), nan);
}

const roundAway = (x) => (x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5));

function powI(base, e) {
    const nan = base.nan || e.nan;
    if (e.lo === e.hi && Number.isInteger(e.lo)) {
        const n = e.lo;
        if (n === 0) return iv(1, 1, false);
        if (n < 0) {
            if (containsZero(base)) return iv(-INF, INF, nan);
            return divI(iv(1, 1), powI(base, iv(-n, -n)));
        }
        if (n % 2 === 0) {
            const m = absI(base);
            return iv(Math.pow(m.lo, n), Math.pow(m.hi, n), nan);
        }
        return iv(Math.pow(base.lo, n), Math.pow(base.hi, n), nan);
    }
    if (base.lo >= 0) {
        const c = [
            Math.pow(base.lo, e.lo), Math.pow(base.lo, e.hi),
            Math.pow(base.hi, e.lo), Math.pow(base.hi, e.hi),
        ];
        return iv(Math.min(...c), Math.max(...c), nan);
    }
    return iv(-INF, INF, true);
}

const key = (() => {
    const cache = new WeakMap();
    return (node) => {
        let k = cache.get(node);
        if (k === undefined) {
            k = JSON.stringify(node);
            cache.set(node, k);
        }
        return k;
    };
})();


// ---- plain-language rendering --------------------------------------------

function stripOuterParens(s) {
    if (s[0] !== "(" || s[s.length - 1] !== ")") return s;
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")" && --depth === 0 && i < s.length - 1) return s;
    }
    return s.slice(1, -1);
}

// Source text of a sub-expression, via the project's own expr-syntax emitter.
function show(node) {
    try {
        return stripOuterParens(exprSyntax.emitExpr(node));
    } catch {
        return node.type;
    }
}

const showCond = (c) => `${show(c.left)} ${c.op} ${show(c.right)}`;

function fmtNum(n) {
    if (n === INF) return "\u221e";
    if (n === -INF) return "\u2212\u221e";
    return String(Number(n.toPrecision(6))).replace("-", "\u2212");
}

function fmtRange(i) {
    return i.lo === i.hi ? fmtNum(i.lo) : `${fmtNum(i.lo)}\u2026${fmtNum(i.hi)}`;
}

const code = (s) => `\`${s}\``;

const NEGATE = { ">": "<=", "<": ">=", ">=": "<", "<=": ">", "==": "!=", "!=": "==" };
const FLIP = { ">": "<", "<": ">", ">=": "<=", "<=": ">=", "==": "==", "!=": "!=" };

// Can the comparison be true / false, given operand intervals.
function decide(op, l, r) {
    const nan = l.nan || r.nan;
    const overlap = l.lo <= r.hi && r.lo <= l.hi;
    const bothPoint = l.lo === l.hi && r.lo === r.hi && l.lo === r.lo;
    switch (op) {
        case ">": return { canTrue: l.hi > r.lo, canFalse: !(l.lo > r.hi) || nan };
        case ">=": return { canTrue: l.hi >= r.lo, canFalse: !(l.lo >= r.hi) || nan };
        case "<": return { canTrue: l.lo < r.hi, canFalse: !(l.hi < r.lo) || nan };
        case "<=": return { canTrue: l.lo <= r.hi, canFalse: !(l.hi <= r.lo) || nan };
        case "==": return { canTrue: overlap, canFalse: !bothPoint || nan };
        default: return { canTrue: !bothPoint || nan, canFalse: overlap };
    }
}

// Facts implied by `subject op bound` holding, as [exprNode, fact] pairs.
// fact: { lo, hi, nz?, hole? }
function factsFor(subject, op, bound) {
    const out = [];
    const f = { lo: -INF, hi: INF };
    switch (op) {
        case ">": f.lo = bound.lo; if (bound.lo >= 0) f.nz = true; break;
        case ">=": f.lo = bound.lo; if (bound.lo > 0) f.nz = true; break;
        case "<": f.hi = bound.hi; if (bound.hi <= 0) f.nz = true; break;
        case "<=": f.hi = bound.hi; if (bound.hi < 0) f.nz = true; break;
        case "==":
            f.lo = bound.lo; f.hi = bound.hi;
            if (bound.lo > 0 || bound.hi < 0) f.nz = true;
            break;
        default:
            if (bound.lo === 0 && bound.hi === 0) f.nz = true;
            break;
    }
    out.push([subject, f]);
    // abs(E) op c: bounds on |E| translate to a hole / range on E itself.
    if (subject.type === "call" && subject.name === "abs" && subject.args.length === 1) {
        const e = subject.args[0];
        const g = { lo: -INF, hi: INF };
        if (op === ">" || op === ">=") {
            if (bound.lo > 0) {
                g.hole = [-bound.lo, bound.lo];
                g.nz = true;
            } else if (op === ">" && bound.lo === 0) {
                g.nz = true;
            }
        } else if (op === "<" || op === "<=") {
            g.lo = -bound.hi;
            g.hi = bound.hi;
        }
        if (g.hole || g.nz || g.lo > -INF || g.hi < INF) out.push([e, g]);
    }
    return out;
}

function applyFact(r, f) {
    const lo = Math.max(r.lo, f.lo);
    const hi = Math.min(r.hi, f.hi);
    if (lo > hi) return r;
    const out = iv(lo, hi, r.nan);
    if (r.nz || f.nz) out.nz = true;
    const hole = f.hole || r.hole;
    if (hole) out.hole = hole;
    return out;
}

function checkRanges(fnDef, ranges) {
    if (ranges === null || typeof ranges !== "object" || Array.isArray(ranges)) {
        throw new Error("analyzeRanges(): ranges must be a plain object of { paramName: [min, max] }");
    }
    for (const [name, r] of Object.entries(ranges)) {
        if (!fnDef.params.includes(name)) {
            throw new Error(
                `analyzeRanges(): range declared for "${name}", which is not a parameter of ${fnDef.name} ` +
                `(${fnDef.params.join(", ") || "none"})`,
            );
        }
        if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== "number" || typeof r[1] !== "number" || Number.isNaN(r[0]) || Number.isNaN(r[1])) {
            throw new Error(`analyzeRanges(): range for "${name}" must be [min, max] with numeric bounds`);
        }
        if (r[0] > r[1]) {
            throw new Error(`analyzeRanges(): range for "${name}" has min ${r[0]} greater than max ${r[1]}`);
        }
    }
}

/**
 * analyzeRanges(fnDef, ranges, registry?) -> { range, warnings, selects, findings }
 * See this file's header comment for the result shape.
 */
function analyzeRanges(fnDef, ranges = {}, registry = undefined) {
    checkRanges(fnDef, ranges);
    const fn = expandMacros(fnDef, null, registry);
    checkUnboundVars(fn);

    const findings = [];
    const selects = [];
    const selectInfo = new Map();
    let nextSelectId = 0;
    const path = [];
    const scope = {};
    for (const p of fn.params) {
        const r = ranges[p];
        scope[p] = r ? iv(r[0], r[1]) : FULL();
    }

    // ctx: { facts: [{key, fact, owner}], mute, dead }
    function lookup(ctx, node) {
        const k = key(node);
        let r = null;
        for (const e of ctx.facts) if (e.key === k) r = r ? applyFact(r, e.fact) : e.fact;
        return r;
    }

    function an(node, ctx) {
        let r = raw(node, ctx);
        if (ctx.facts.length) {
            const f = lookup(ctx, node);
            if (f) r = applyFact(r, f);
        }
        return r;
    }

    function step(label, node, ctx) {
        path.push(label);
        try {
            return an(node, ctx);
        } finally {
            path.pop();
        }
    }

    function raw(node, ctx) {
        switch (node.type) {
            case "num": return iv(node.value, node.value);
            case "var": return scope[node.name] ? { ...scope[node.name] } : FULL();
            case "bin": return binI(node, ctx);
            case "call": return callI(node, ctx);
            case "select": return selectI(node, ctx);
            case "index": {
                step("index.at", node.at, ctx);
                step("index.target", node.target, ctx);
                if (node.target.type === "var" && ranges[node.target.name]) {
                    const [lo, hi] = ranges[node.target.name];
                    return iv(lo, hi);
                }
                return FULL();
            }
            default:
                throw new Error(`analyzeRanges(): unexpected node type "${node.type}"`);
        }
    }

    function binI(node, ctx) {
        const l = step(`bin(${node.op}).left`, node.left, ctx);
        const r = step(`bin(${node.op}).right`, node.right, ctx);
        switch (node.op) {
            case "+": return iv(l.lo + r.lo, l.hi + r.hi, l.nan || r.nan);
            case "-": return iv(l.lo - r.hi, l.hi - r.lo, l.nan || r.nan);
            case "*":
                if (key(node.left) === key(node.right)) return squareI(l);
                return mulI(l, r);
            case "/": return division(node, l, r, ctx);
            default: throw new Error(`analyzeRanges(): unknown bin op "${node.op}"`);
        }
    }

    function zeroPossible(node, facts) {
        return containsZero(an(node, { facts, mute: true }));
    }

    function division(node, l, r, ctx) {
        const result = divI(l, r);
        if (ctx.mute) return result;
        const at = path.join(" > ");
        const text = show(node);
        const denomText = show(node.right);
        if (ctx.dead) {
            if (containsZero(r)) {
                findings.push({
                    kind: "div-unreachable", severity: "info", at, expr: text,
                    denominator: strip(r), inDeadBranch: true,
                    message: `${code(text)} never runs for these inputs (${ctx.dead}), so its zero denominator is not a hazard.`,
                });
            }
            return result;
        }
        if (containsZero(r)) {
            const certain = r.lo === 0 && r.hi === 0 && !r.nz;
            findings.push({
                kind: "div-by-zero", severity: "warning", at, expr: text,
                certain, denominator: strip(r),
                message: certain
                    ? `${code(text)} always divides by zero: ${code(denomText)} is always 0.`
                    : `${code(text)} can divide by zero: ${code(denomText)} can be 0 (range ${fmtRange(r)}).`,
            });
            return result;
        }
        if (!ctx.facts.length) return result;
        // Safe only if the enclosing guards are honored; check without them.
        if (!zeroPossible(node.right, [])) return result;
        const owners = [...new Set(ctx.facts.map((e) => e.owner))];
        const needed = owners.filter((o) => zeroPossible(node.right, ctx.facts.filter((e) => e.owner !== o)));
        for (const o of needed) selectInfo.get(o).loadBearing = true;
        const denominator = strip(an(node.right, { facts: [], mute: true }));
        const conds = needed.map((o) => code(selectInfo.get(o).condition)).join(", ");
        findings.push({
            kind: "div-guarded", severity: "warning", at, expr: text,
            guards: needed.map((o) => selectInfo.get(o).at),
            guardConditions: needed.map((o) => selectInfo.get(o).condition),
            denominator,
            message: `${code(text)} is protected from a zero denominator only by the condition ${conds} ` +
                `(${code(denomText)} can be 0 on its own, range ${fmtRange(denominator)}). ` +
                `Targets that evaluate both branches of a select (${lazyEagerSelectTargets()}) still run the division.`,
        });
        return result;
    }

    function callI(node, ctx) {
        const args = node.args.map((a, i) => step(`${node.name}.arg${i}`, a, ctx));
        const a = args[0];
        switch (node.name) {
            case "abs": return absI(a);
            case "sqrt": return domainI(Math.sqrt, 0, INF, a);
            case "sin": return trigI(Math.sin, Math.PI / 2, a);
            case "cos": return trigI(Math.cos, 0, a);
            case "tan": return tanI(a);
            case "asin": return domainI(Math.asin, -1, 1, a);
            case "acos": return domainI(Math.acos, -1, 1, a, false);
            case "atan": return monotone(Math.atan, a);
            case "log": return domainI(Math.log, 0, INF, a);
            case "log2": return domainI(Math.log2, 0, INF, a);
            case "log10": return domainI(Math.log10, 0, INF, a);
            case "exp": return monotone(Math.exp, a);
            case "floor": return monotone(Math.floor, a);
            case "ceil": return monotone(Math.ceil, a);
            case "trunc": return monotone(Math.trunc, a);
            case "round": return monotone(roundAway, a);
            case "sign": return monotone(Math.sign, a);
            case "pow": return powI(a, args[1]);
            case "atan2": return iv(-Math.PI, Math.PI, a.nan || args[1].nan);
            case "min": return iv(Math.min(a.lo, args[1].lo), Math.min(a.hi, args[1].hi), a.nan || args[1].nan);
            case "max": return iv(Math.max(a.lo, args[1].lo), Math.max(a.hi, args[1].hi), a.nan || args[1].nan);
            case "hypot": {
                const x = absI(a);
                const y = absI(args[1]);
                return iv(Math.hypot(x.lo, y.lo), Math.hypot(x.hi, y.hi), a.nan || args[1].nan);
            }
            case "wrapIndex": {
                const m = args[1];
                if (m.lo > 0) return iv(0, m.hi, a.nan || m.nan);
                return iv(-INF, INF, true);
            }
            case "clampIndex": {
                const lo = args[1];
                const hi = args[2];
                const inner = iv(Math.min(hi.lo, a.lo), Math.min(hi.hi, a.hi), a.nan || hi.nan);
                return iv(Math.max(lo.lo, inner.lo), Math.max(lo.hi, inner.hi), inner.nan || lo.nan);
            }
            default:
                if (PRIMITIVE_ARITY[node.name] !== undefined) {
                    throw new Error(`analyzeRanges(): no interval rule for primitive "${node.name}"`);
                }
                // Extern: caller-owned native call, nothing is known about it.
                return iv(-INF, INF, true);
        }
    }

    function selectI(node, ctx) {
        const id = nextSelectId++;
        const condition = showCond(node.cond);
        const info = { at: path.join(" > ") || "body", outcome: "either", loadBearing: false, condition };
        selectInfo.set(id, info);

        const { left, right, op } = node.cond;
        const l = step("select.cond.left", left, ctx);
        const r = step("select.cond.right", right, ctx);
        const { canTrue, canFalse } = decide(op, l, r);
        if (!canFalse) info.outcome = "always-then";
        else if (!canTrue) info.outcome = "always-else";
        info.severity = "info";
        if (info.outcome === "always-then") {
            info.message = `Condition ${code(condition)} is always true for these inputs, so this always returns ${code(show(node.then))}.`;
        } else if (info.outcome === "always-else") {
            info.message = `Condition ${code(condition)} is never true for these inputs, so this always returns ${code(show(node.else))}.`;
        } else {
            info.message = `Condition ${code(condition)} can be true or false for these inputs.`;
        }
        if (!ctx.mute) {
            selects.push(info);
            if (!ctx.dead && info.outcome !== "either") {
                findings.push({
                    kind: "condition-decided", severity: "info", at: info.at, expr: condition,
                    outcome: info.outcome, message: info.message,
                });
            }
        }

        // Each branch is analysed with the operand ranges narrowed by the
        // condition (then) or its negation (else); see factsFor().
        const branch = (truth, can, label, sub) => {
            const bop = truth ? op : NEGATE[op];
            const entries = [];
            if (can) {
                for (const [e, f] of factsFor(left, bop, r)) entries.push({ key: key(e), fact: f, owner: id });
                for (const [e, f] of factsFor(right, FLIP[bop], l)) entries.push({ key: key(e), fact: f, owner: id });
            }
            const reason = `${code(condition)} is ${truth ? "never true" : "always true"} here`;
            const bctx = { facts: ctx.facts.concat(entries), mute: ctx.mute, dead: ctx.dead || (can ? false : reason) };
            return step(label, sub, bctx);
        };
        const t = branch(true, canTrue, "select.then", node.then);
        const e = branch(false, canFalse, "select.else", node.else);
        if (canTrue && canFalse) return hull(t, e);
        return canTrue ? t : e;
    }

    const { bindings, body } = collectLets(fn.body);
    const top = { facts: [], mute: false, dead: false };
    for (const { name, node } of bindings) {
        path.push(`let ${name}`);
        scope[name] = an(node, top);
        path.pop();
    }
    let range;
    if (body.type === "outputs") {
        range = {};
        for (const [name, node] of Object.entries(body.fields)) {
            path.push(`outputs.${name}`);
            range[name] = strip(an(node, top));
            path.pop();
        }
    } else {
        path.push("body");
        range = strip(an(body, top));
        path.pop();
    }
    const warnings = findings.filter((f) => f.severity !== "info");
    return { range, warnings, selects, findings };
}

module.exports = { analyzeRanges };
