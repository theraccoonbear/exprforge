// exprforge/emitters/latex.js
//
// Renders an AST as LaTeX math-mode source -- typeset documentation of a
// formula, not executable code. Output is bare math-mode content (no
// $$...$$ / \[...\] wrapper) so it drops into whichever delimiter the
// caller's renderer uses (KaTeX, MathJax, a real LaTeX document).
//
// Like emitters/exprsyntax.js, this overrides emitExpr wholesale instead
// of filling a `calls` table -- but further than that one does, because
// base.js's explicit-parens-around-every-bin rule exists to pin down
// floating-point evaluation order in real target languages, and typeset
// math has no evaluation order to pin down. Wrapping every bin node in
// parens would just make the output unreadable, so this tracks precedence
// itself and only parenthesizes where the math notation would otherwise
// be ambiguous. Every node goes through `_r()`, which returns a rendered
// string plus enough metadata (precedence, leading minus, what kind of
// token it starts/ends with) for the parent to decide on parens and on
// multiplication spacing.
//
// No compiler exists for this target and the output can't round-trip back
// into an AST, so it's verified by exact-string tests (see
// test/latex-emitter.test.js) plus, where a `katex` CLI is on PATH (CI's
// test-latex.yml installs one), a real KaTeX parse of every sample's
// output -- the closest thing this target has to "compiled conformance".
//
// `opts.greekLetters` (default true): names like alpha/theta/Gamma render
// as Greek symbols, the usual convention in math and physics writing
// (SymPy's latex() does the same). false renders them as ordinary
// multi-letter names (\mathit{theta}).
//
// `opts.mulSymbol` (passed through emitFunction's opts, same as
// addTypeGuards): "implicit" (default) | "cdot" | "times". "implicit"
// juxtaposes factors the way published math does (2x, ab) but still
// falls back to \cdot wherever juxtaposition would misread: a factor
// starting with a digit (2 \cdot 3, never 23; x \cdot 2), a numeric
// coefficient before a fraction (2 \cdot \frac{1}{3}, never a mixed
// number), a multi-letter identifier on either side (\mathit{rate}
// \cdot \mathit{time}, never "ratetime"), and a cases block on either
// side. Scientific-notation literals always use \times 10^{k} regardless.
//
// `opts.wrap`: "none" (default, bare math-mode content) | "inline" ($...$)
// | "display" ($$ on their own lines) | "equation" (equation environment)
// | "document" (a minimal standalone article using amsmath, which
// provides aligned, cases, \operatorname, \text and \lvert). Applies to
// functions and suites alike.
const Emitter = require("./base.js");

const MUL_SYMBOLS = { implicit: null, cdot: "\\cdot", times: "\\times" };

// Each wrapper receives the bare output (which already ends in a newline)
// and returns it wrapped, keeping the trailing newline. "document" is a
// complete file; concatenating several of them is not valid LaTeX.
const WRAPS = {
    none: (body) => body,
    inline: (body) => `$${body.replace(/\n$/, "")}$\n`,
    display: (body) => `$$\n${body}$$\n`,
    equation: (body) => `\\begin{equation}\n${body}\\end{equation}\n`,
    document: (body) =>
        `\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\\[\n${body}\\]\n\\end{document}\n`,
};

// NEG: a negated literal or a unary minus applied to a tighter-binding
// term -- fine as a product's left factor (-5 x), never as its right.
const PREC = { MOD: 0, ADD: 1, NEG: 1.5, MUL: 2, FRAC: 2.5, POW: 3, CASES: 3.5, ATOM: 4 };

const CMP_LATEX = { ">": ">", "<": "<", ">=": "\\geq", "<=": "\\leq", "==": "=", "!=": "\\neq" };

// Identifiers rendered as Greek letters: exactly the set standard LaTeX
// defines commands for. Lowercase: every letter except omicron (no
// \omicron -- it's indistinguishable from Latin "o"). Uppercase: only the
// 11 capitals that differ visually from Latin ones; \Alpha, \Beta, etc.
// don't exist in standard LaTeX (they'd just be A, B, ...), so those
// names fall through to \mathit{} rather than emitting a command a real
// LaTeX compiler rejects. Variant forms (\varepsilon, \varphi, ...) are
// not mapped.
const GREEK_LOWER = [
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa",
    "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi",
    "omega",
];
const GREEK_UPPER = ["Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega"];
const GREEK = new Set([...GREEK_LOWER, ...GREEK_UPPER]);

function escapeText(s) {
    return s.replace(/[\\$_{}&%#^~]/g, (c) => `\\${c}`);
}

// x -> x, alpha -> \alpha, x1 -> x_{1}, v_max -> v_{\mathrm{max}},
// rate -> \mathit{rate}. `multi` marks a multi-letter rendering, which
// implicit multiplication must never juxtapose against another factor.
// `greek: false` turns the Greek-letter mapping off; `literal: true`
// renders the name exactly as written (used for names that would
// otherwise collide with another name in the same function).
function formatIdentBase(name, greek) {
    if (greek && GREEK.has(name)) return { s: `\\${name}`, multi: false };
    const digits = /^([A-Za-z]+)(\d+)$/.exec(name);
    if (digits) {
        const base = formatIdentBase(digits[1], greek);
        return { s: `${base.s}_{${digits[2]}}`, multi: base.multi };
    }
    if (/^[A-Za-z]$/.test(name)) return { s: name, multi: false };
    return { s: `\\mathit{${escapeText(name)}}`, multi: true };
}

function formatIdent(name, { greek = true, literal = false } = {}) {
    if (literal) {
        return /^[A-Za-z]$/.test(name) ? { s: name, multi: false } : { s: `\\mathit{${escapeText(name)}}`, multi: true };
    }
    const us = name.indexOf("_");
    if (us > 0 && us < name.length - 1) {
        const base = formatIdentBase(name.slice(0, us), greek);
        if (!base.s.includes("_")) {
            const sub = name.slice(us + 1);
            const subStr = /^\d+$/.test(sub) || /^[A-Za-z]$/.test(sub) ? sub : `\\mathrm{${escapeText(sub)}}`;
            return { s: `${base.s}_{${subStr}}`, multi: base.multi };
        }
    }
    return formatIdentBase(name, greek);
}

function formatFnName(name) {
    return /^[A-Za-z]$/.test(name) ? name : `\\operatorname{${escapeText(name)}}`;
}

function formatNumberParts(value) {
    const str = String(value);
    const neg = str.startsWith("-");
    const m = /^(-?)([\d.]+)e([+-]?)(\d+)$/.exec(str);
    if (!m) {
        return { s: str, prec: neg ? PREC.NEG : PREC.ATOM, neg, first: neg ? "minus" : "digit", last: "digit" };
    }
    const [, sign, mantissa, expSign, expDigits] = m;
    const exponent = `${expSign === "-" ? "-" : ""}${expDigits}`;
    if (mantissa === "1") {
        return { s: `${sign}10^{${exponent}}`, prec: neg ? PREC.NEG : PREC.POW, neg, first: neg ? "minus" : "digit", last: "pow" };
    }
    return {
        s: `${sign}${mantissa} \\times 10^{${exponent}}`,
        prec: neg ? PREC.NEG : PREC.MUL,
        neg,
        first: neg ? "minus" : "digit",
        last: "pow",
    };
}

function paren(r) {
    return { s: `\\left(${r.s}\\right)`, prec: PREC.ATOM, neg: false, first: "paren", last: "paren" };
}

function atom(s, first = "cmd", last = "cmd") {
    return { s, prec: PREC.ATOM, neg: false, first, last };
}

function args(rs) {
    return `\\left(${rs.map((r) => r.s).join(", ")}\\right)`;
}

class LatexEmitter extends Emitter {
    // Two distinct identifiers can render identically (x1 and x_1 both as
    // x_{1}; theta1 and theta_1 both as \theta_{1}). Every rendered name
    // is recorded during a pass; if any rendering was produced by more
    // than one name, the function is rendered again with those names
    // spelled literally (\mathit{x1}, \mathit{x\_1}) so they stay
    // distinguishable.
    _assemble(fns, registry, opts, file) {
        opts = opts || {};
        const mulSymbol = opts.mulSymbol ?? "implicit";
        if (!Object.hasOwn(MUL_SYMBOLS, mulSymbol)) {
            throw new Error(
                `emitter for .${this.ext}: unknown mulSymbol "${mulSymbol}" -- expected one of: ${Object.keys(MUL_SYMBOLS).join(", ")}`,
            );
        }
        const greekLetters = opts.greekLetters ?? true;
        if (typeof greekLetters !== "boolean") {
            throw new Error(`emitter for .${this.ext}: greekLetters must be true or false, got ${JSON.stringify(greekLetters)}`);
        }
        const wrap = opts.wrap ?? "none";
        if (typeof wrap !== "string" || !Object.hasOwn(WRAPS, wrap)) {
            throw new Error(
                `emitter for .${this.ext}: unknown wrap ${JSON.stringify(wrap)} -- expected one of: ${Object.keys(WRAPS).join(", ")}`,
            );
        }
        const bares = fns.map((fn) => this._emitBare(fn, registry, opts, mulSymbol, greekLetters));
        // A document is one file with one preamble: each function becomes its
        // own display block inside it, never a nested document.
        if (wrap === "document" && bares.length > 1) {
            return WRAPS.document(bares.join("\\]\n\n\\[\n"));
        }
        return bares.map((b) => WRAPS[wrap](b)).join("\n");
    }

    _emitBare(fn, registry, opts, mulSymbol, greekLetters) {
        const prev = this._state;
        try {
            this._state = { mulSymbol, greek: greekLetters, literal: new Set(), seen: new Map() };
            const first = super._emitBody(fn, registry, opts);
            const colliding = [...this._state.seen.values()].filter((names) => names.size > 1);
            if (colliding.length === 0) return first;
            const literal = new Set(colliding.flatMap((names) => [...names]));
            this._state = { mulSymbol, greek: greekLetters, literal, seen: new Map() };
            return super._emitBody(fn, registry, opts);
        } finally {
            this._state = prev;
        }
    }

    _ident(name) {
        const st = this._state ?? { greek: true, literal: new Set(), seen: new Map() };
        const id = formatIdent(name, { greek: st.greek, literal: st.literal.has(name) });
        if (!st.seen.has(id.s)) st.seen.set(id.s, new Set());
        st.seen.get(id.s).add(name);
        return id;
    }

    emitExpr(node) {
        return this._r(node).s;
    }

    _r(node) {
        switch (node.type) {
            case "num":
                return formatNumberParts(node.value);
            case "var": {
                const id = this._ident(node.name);
                const kind = id.multi ? "word" : "letter";
                return { s: id.s, prec: PREC.ATOM, neg: false, first: kind, last: kind };
            }
            case "bin":
                return this._bin(node);
            case "call":
                return this._call(node);
            case "select":
                return this._select(node);
            case "index": {
                const target = this._r(node.target);
                const at = this._r(node.at);
                const base = target.prec === PREC.ATOM && !/[_^]/.test(target.s) ? target.s : `{${target.s}}`;
                return { s: `${base}_{${at.s}}`, prec: PREC.ATOM, neg: false, first: target.first, last: "sub" };
            }
            default:
                // cmp outside a select, and anything unknown: base.js's own
                // errors are already the right ones.
                return atom(super.emitExpr(node));
        }
    }

    _bin(node) {
        const { op } = node;
        if (op === "/") {
            const n = this._r(node.left);
            const d = this._r(node.right);
            return { s: `\\frac{${n.s}}{${d.s}}`, prec: PREC.FRAC, neg: false, first: "frac", last: "frac" };
        }
        if (op === "-" && node.left.type === "num" && Object.is(node.left.value, 0)) {
            let x = this._r(node.right);
            if (x.prec < PREC.MUL || x.neg) x = paren(x);
            return { s: `-${x.s}`, prec: PREC.NEG, neg: true, first: "minus", last: x.last };
        }
        if (op === "+" || op === "-") {
            let l = this._r(node.left);
            let r = this._r(node.right);
            if (l.prec < PREC.ADD) l = paren(l);
            const minPrec = op === "-" ? PREC.MUL : PREC.ADD;
            if (r.prec < minPrec || r.neg) r = paren(r);
            return { s: `${l.s} ${op} ${r.s}`, prec: PREC.ADD, neg: l.neg, first: l.first, last: r.last };
        }
        if (op === "*") {
            let l = this._r(node.left);
            let r = this._r(node.right);
            if (l.prec < PREC.NEG) l = paren(l);
            if (r.prec < PREC.MUL || r.neg) r = paren(r);
            const sep = this._mulSep(l, r);
            return { s: `${l.s} ${sep ? `${sep} ` : ""}${r.s}`, prec: PREC.MUL, neg: l.neg, first: l.first, last: r.last };
        }
        return atom(super.emitExpr(node));
    }

    _mulSep(l, r) {
        const explicit = MUL_SYMBOLS[this._state?.mulSymbol ?? "implicit"];
        if (explicit) return explicit;
        const needsDot =
            r.first === "digit" ||
            r.first === "word" ||
            r.first === "cases" ||
            l.last === "word" ||
            l.last === "cases" ||
            (r.first === "frac" && l.last === "digit");
        return needsDot ? "\\cdot" : null;
    }

    _pow(baseNode, expNode) {
        let b = this._r(baseNode);
        if (b.prec < PREC.ATOM || b.neg || b.last === "pow") b = paren(b);
        const e = this._r(expNode);
        return { s: `${b.s}^{${e.s}}`, prec: PREC.POW, neg: false, first: b.first, last: "pow" };
    }

    _call(node) {
        const a = () => node.args.map((x) => this._r(x));
        const fnCall = (cmd) => atom(`${cmd}${args(a())}`);
        const named = (name) => fnCall(`\\operatorname{${name}}`);
        switch (node.name) {
            case "sqrt":
                return atom(`\\sqrt{${a()[0].s}}`);
            case "abs":
                return atom(`\\left\\lvert ${a()[0].s} \\right\\rvert`);
            case "floor":
                return atom(`\\left\\lfloor ${a()[0].s} \\right\\rfloor`);
            case "ceil":
                return atom(`\\left\\lceil ${a()[0].s} \\right\\rceil`);
            case "pow":
                return this._pow(node.args[0], node.args[1]);
            case "exp": {
                const e = this._r(node.args[0]);
                return { s: `e^{${e.s}}`, prec: PREC.POW, neg: false, first: "letter", last: "pow" };
            }
            case "sin":
            case "cos":
            case "tan":
            case "min":
            case "max":
                return fnCall(`\\${node.name}`);
            case "asin":
                return fnCall("\\arcsin");
            case "acos":
                return fnCall("\\arccos");
            case "atan":
                return fnCall("\\arctan");
            case "log":
                return fnCall("\\ln");
            case "log2":
                return fnCall("\\log_{2}");
            case "log10":
                return fnCall("\\log_{10}");
            case "hypot": {
                const [x, y] = node.args.map((n) => this._pow(n, { type: "num", value: 2 }));
                return atom(`\\sqrt{${x.s} + ${y.s}}`);
            }
            case "sign":
                return named("sgn");
            case "trunc":
                return named("trunc");
            case "round":
                return named("round");
            case "atan2":
                return named("atan2");
            case "clampIndex":
                return named("clamp");
            case "wrapIndex": {
                let [i, m] = a();
                if (i.prec < PREC.MUL || i.neg) i = paren(i);
                if (m.prec < PREC.MUL || m.neg) m = paren(m);
                return { s: `${i.s} \\bmod ${m.s}`, prec: PREC.MOD, neg: false, first: i.first, last: m.last };
            }
            default:
                // Not a built-in primitive: an extern with its own "latex"
                // template, or base.js's "no mapping" error.
                return { s: super.emitExpr(node), prec: PREC.ADD, neg: false, first: "other", last: "other" };
        }
    }

    // A chain of selects nested in each other's else-branch flattens into
    // one cases block (if / else if / ... / otherwise) -- same meaning,
    // far more readable than nested braces.
    _select(node) {
        const rows = [];
        let cur = node;
        while (cur.type === "select") {
            const L = this._r(cur.cond.left).s;
            const R = this._r(cur.cond.right).s;
            const op = CMP_LATEX[cur.cond.op];
            if (!op) throw new Error(`emitter for .${this.ext}: unknown comparison operator "${cur.cond.op}"`);
            rows.push(`${this._r(cur.then).s} & \\text{if } ${L} ${op} ${R}`);
            cur = cur.else;
        }
        rows.push(`${this._r(cur).s} & \\text{otherwise}`);
        return {
            s: `\\begin{cases} ${rows.join(" \\\\ ")} \\end{cases}`,
            prec: PREC.CASES,
            neg: false,
            first: "cases",
            last: "cases",
        };
    }
}

function signature(emitter, fn) {
    return `${formatFnName(fn.name)}${paramArgs(emitter, fn)}`;
}

function paramArgs(emitter, fn) {
    return args(fn.params.map((p) => emitter._ident(p)));
}

function aligned(lines) {
    return `\\begin{aligned}\n${lines.map((l) => `  ${l}`).join(" \\\\\n")}\n\\end{aligned}\n`;
}

function letLines(emitter, letBindings) {
    return letBindings.map(({ name, valueStr }) => `${emitter._ident(name).s} &= ${valueStr}`);
}

// Both callbacks are plain functions (not arrows): base.js calls them as
// methods, so `this` is the emitter and identifier rendering goes
// through its per-call collision tracking.
const emitter = new LatexEmitter({
    ext: "tex",
    formatNumber: (v) => formatNumberParts(v).s,
    formatFunction: function (fn, bodyStr, letBindings = []) {
        if (letBindings.length === 0) return `${signature(this, fn)} = ${bodyStr}\n`;
        return aligned([...letLines(this, letBindings), `${signature(this, fn)} &= ${bodyStr}`]);
    },
    // Each output renders as its own function of the parameters, e.g.
    // \mathit{tangent}\left(t\right) = ..., after any shared definitions.
    formatSuite: function (fn, outputStrs, letBindings = []) {
        const params = paramArgs(this, fn);
        const outLines = Object.entries(outputStrs).map(
            ([name, valueStr]) => `${this._ident(name).s}${params} &= ${valueStr}`,
        );
        return aligned([...letLines(this, letBindings), ...outLines]);
    },
});

// Per-target facts that registry-wide docs and tests read; field reference
// in emitters/meta.js.
emitter.meta = {
    displayName: "LaTeX",
    kind: "typeset",
    testTarget: null,
    ci: { workflow: "test-latex.yml", badge: "LaTeX" },
    toolchain: {
        probes: null,
        docs: {
            minimum: "LaTeX2e with `amsmath` (`wrap: \"document\"` loads it; other wraps need it in the host document). KaTeX 0.16+ or MathJax for web rendering.",
            tested: "KaTeX 0.16 strict parse; `pdflatex` from Ubuntu 24.04 `texlive-latex-base`",
            notes: "Output is typeset math, never executed. `document` output compiles standalone; long one-line formulas can run past the margin (overfull boxes are reported, not failures).",
        },
    },
    guards: null,
    division: "\\frac{x}{y}",
    cmp: { eq: "x = 5", ne: "x \\neq 5", forbidEq: "==", forbidNe: "!=", shared: { ">": "x > 5", "<": "x < 5", ">=": "x \\geq 5", "<=": "x \\leq 5" } },
    roundTies: null,
    selectShortCircuits: null,
    minMaxNaN: null,
};

emitter.lang = "latex";
module.exports = emitter;
