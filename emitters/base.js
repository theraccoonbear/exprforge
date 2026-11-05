// exprforge/emitters/base.js
//
// A language plugin is just a config object passed to `new Emitter(config)`.
// This is the extension point: adding a new language means writing ONE new
// file that builds an Emitter, not touching this file or any other emitter.
//
// config shape:
//   ext            — output file extension, e.g. "rs"
//   formatNumber   — (value: number) => string        (literal syntax)
//   calls          — { [mathFnName]: (argStrs: string[]) => string }
//                    Covers BOTH "direct" (sqrt -> `sqrt(${x})`) and
//                    "expanded" (sign -> ternary expression) cases, and
//                    postfix/method-call languages like Rust (`${x}.sqrt()`),
//                    uniformly — it's just a string template either way.
//   emitDiv        — optional override: (leftStr, rightStr) => string
//                    How a "/" bin node is spelled on targets where plain
//                    division does not follow IEEE 754 for a zero
//                    denominator (Python, Perl, PHP: see
//                    docs/adr/0004-division-by-zero.md). Skipped when the
//                    denominator is a nonzero numeric literal, which can
//                    never divide by zero. Absent on every target whose
//                    native "/" is already IEEE-correct.
//   formatFunction — (fn: {name, params, body}, bodyStr: string, letBindings: {name, valueStr}[]) => string
//                    Full source text for one function, including any
//                    language-specific signature/type/wrapper syntax.
//                    letBindings is [] for let-free expressions.
//   emitSelect     — optional override: (condNode, thenStr, elseStr) => string
//                    Default is a ternary; QB64 has no ternary and overrides
//                    this with the equivalent arithmetic expression instead.
//   formatSuite    — (fn: {name, params}, outputStrs: {name: string}, letBindings) => string
//                    Only needed for targets that support multi-output
//                    suites (see ast.js's outputs()). Renders whatever
//                    multi-value idiom the language has. Required if any
//                    suite gets emitted through this emitter; omitted
//                    otherwise.

const { collectLets, checkUnboundVars } = require("../ast.js");
const { expandMacros, resolveExternForEmitter, withContext } = require("../macros.js");

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Used-only helper selection. A target that needs support definitions in
// its generated output (a division wrapper, a domain-checked sqrt, ...)
// declares them as a map of
//
//     name -> { source: string, deps?: string[] }
//
// and asks this function which of them a piece of generated code actually
// calls. `code` must be the generated text WITHOUT any helper definitions
// (so a definition can never count as a use of itself); `deps` names the
// other helpers a helper's own source calls, which are pulled in
// transitively. A reference is a whole-identifier match on the helper name
// (identifier characters are letters, digits, "_" and "-", so `ef_min`
// does not match inside `ef_minimum`, and COBOL's `ef-cmp-gt` is one
// token). Helper names must use a prefix users cannot pick for their own
// identifiers (`_exprforge_`, `ef_`, `ef-`, ...).
//
// Returns [{ name, source }] in a deterministic order: declaration order of
// the map, except that a helper's dependencies always come first.
// `exclude` (a Set of names) lists helpers already defined elsewhere in the
// same output; they are skipped (their dependencies were defined with them).
function selectHelpers(helpers, code, { exclude } = {}) {
    const names = Object.keys(helpers);
    const referenced = (name) =>
        new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`).test(code);
    const needed = new Set();
    const need = (name) => {
        if (needed.has(name)) return;
        if (!helpers[name]) throw new Error(`unknown helper "${name}"`);
        needed.add(name);
        for (const dep of helpers[name].deps || []) need(dep);
    };
    for (const name of names) if (referenced(name)) need(name);
    const ordered = [];
    const done = new Set();
    const visiting = new Set();
    const visit = (name) => {
        if (done.has(name)) return;
        if (visiting.has(name)) throw new Error(`helper dependency cycle at "${name}"`);
        visiting.add(name);
        for (const dep of helpers[name].deps || []) visit(dep);
        visiting.delete(name);
        done.add(name);
        ordered.push(name);
    };
    for (const name of names) if (needed.has(name)) visit(name);
    return ordered
        .filter((name) => !(exclude && exclude.has(name)))
        .map((name) => ({ name, source: helpers[name].source }));
}

// Used-only import selection, the import-side twin of selectHelpers. A
// target whose generated code needs a preamble line to reach library
// functions or constants (`import math`, `#include <math.h>`, ...) declares
// them as a map of
//
//     name -> { source: string, pattern: RegExp }
//
// `pattern` matches the text that needs the import (a qualified call such
// as `math.sqrt(`, a libc function name, ...). The text matched is the
// generated code plus the sources of the helpers that were selected, since
// a helper's own body can need an import the function body does not. A
// pattern must not carry the g or y flag. Only language-mandatory
// scaffolding (`use strict`, `package`, ...) stays unconditional, outside
// this table. `exclude` (a Set) holds import keys already written earlier
// in the same output; they are skipped. Declaration order is preserved.
function importKey(name) {
    return `import:${name}`;
}

// An entry with `onExtern: true` is also selected whenever `externUsed` is
// set, i.e. the emitted code includes the output of a user-supplied extern
// template. Such a template is free-form and can call anything the
// library provides, which no fixed pattern can enumerate.
function selectImports(imports, code, { exclude, externUsed } = {}) {
    return Object.keys(imports)
        .filter((name) => (externUsed && imports[name].onExtern) || imports[name].pattern.test(code))
        .filter((name) => !(exclude && exclude.has(importKey(name))))
        .map((name) => ({ name, source: imports[name].source }));
}

class Emitter {
    constructor(config) {
        this.ext = config.ext;
        this.formatNumber = config.formatNumber;
        this.calls = config.calls || {};
        this.emitDivImpl = config.emitDiv ? config.emitDiv.bind(this) : null;
        this.formatFunctionImpl = config.formatFunction;
        this.formatSuiteImpl = config.formatSuite || null;
        // Optional: name -> { source, deps } map of this target's support
        // definitions. See selectHelpers and usedHelpers.
        this.helpers = config.helpers || {};
        // Optional: name -> { source, pattern } map of this target's
        // import/include preamble lines. See selectImports and usedImports.
        this.imports = config.imports || {};
        this.emitSelectImpl = config.emitSelect
            ? config.emitSelect.bind(this)
            : this._defaultSelect.bind(this);
        // No sane language-agnostic default exists (every target's array
        // subscript syntax, and whether it needs an index-origin
        // translation, differs -- see docs/array-index-primitives.md).
        // null here means emitExpr's "index" case throws a clear
        // "not supported for this target" error, same shape formatSuite
        // already uses for multi-output.
        this.emitIndexImpl = config.emitIndex
            ? config.emitIndex.bind(this)
            : null;
        // Optional, opt-in-only (see emitFunction's `addTypeGuards`):
        // (paramName, fnName) => one line of runtime-guard code asserting
        // that array-typed parameter actually holds an array-shaped value
        // at the call boundary. Only meaningful for targets with no
        // compile-time enforcement of that -- present on the
        // dynamically-typed emitters (js/ts/python/php/lua/perl/ruby/scheme/
        // julia/r), absent (null) everywhere else, since every compiled
        // target already gets this for free from its own compiler. See
        // docs/runtime-type-guards.md.
        this.typeGuardImpl = config.typeGuard || null;
        // Optional, opt-in-only, layered on top of typeGuard above (see
        // emitFunction's own `fn.arrayLengths` doc comment): (arrayParam,
        // lengthParam, fnName) => one line of runtime-guard code
        // asserting that arrayParam's ACTUAL length matches the value of
        // a separate scalar parameter the caller claims it to be. Same
        // 9-target availability as typeGuard, for the same reason (every
        // compiled target either has no portable way to query an array's
        // real runtime length at all -- see docs/array-index-primitives.md's
        // "Array length is always caller-supplied" note -- or already
        // gets an equivalent check from its own compiler/runtime, e.g. a
        // Rust slice's .len() bounds-checks on access regardless).
        this.lengthGuardImpl = config.lengthGuard || null;
    }

    // The helper definitions `code` (generated text without any helper
    // definitions) actually uses, dependencies first -- see selectHelpers.
    // `opts.includeHelpers === false` yields none. When `opts.emittedHelpers`
    // (a Set) is passed it records helpers already defined earlier in the
    // same output: those are skipped and the newly returned ones are added,
    // so concatenating several functions' output defines the union of used
    // helpers exactly once.
    usedHelpers(code, opts = {}) {
        if (opts.includeHelpers === false) return [];
        const used = selectHelpers(this.helpers, code, { exclude: opts.emittedHelpers });
        if (opts.emittedHelpers) for (const h of used) opts.emittedHelpers.add(h.name);
        return used;
    }

    // The import lines `code` (generated text without helper definitions)
    // plus the selected `helpers` (the array usedHelpers returned) actually
    // need -- see selectImports. Shares `opts.emittedHelpers` with
    // usedHelpers: an import already recorded there (key `import:<name>`) is
    // skipped and newly returned ones are recorded, so concatenated
    // functions import each module once.
    usedImports(code, helpers = [], opts = {}) {
        const text = code + helpers.map((h) => h.source).join("\n");
        const used = selectImports(this.imports, text, { exclude: opts.emittedHelpers, externUsed: this._externUsed });
        if (opts.emittedHelpers) for (const i of used) opts.emittedHelpers.add(importKey(i.name));
        return used;
    }

    // Default ternary (cond ? a : b) — correct for JS, C, and Java, which
    // all share this syntax. Go has no ternary at all (and `if` is a
    // statement, not an expression); Rust uses `if`-as-expression instead
    // of ?:; QB64 has no conditional expression syntax whatsoever. Those
    // three override emitSelect with their own syntax — see their files.
    _defaultSelect(condNode, thenStr, elseStr) {
        const L = this.emitExpr(condNode.left);
        const R = this.emitExpr(condNode.right);
        return `((${L} ${condNode.op} ${R}) ? ${thenStr} : ${elseStr})`;
    }

    emitExpr(node) {
        switch (node.type) {
            case "num": {
                return this.formatNumber(node.value);
            }
            case "var": {
                return node.name;
            }
            case "bin": {
                if (node.op === "/" && this.emitDivImpl && !(node.right.type === "num" && node.right.value !== 0)) {
                    return this.emitDivImpl(this.emitExpr(node.left), this.emitExpr(node.right));
                }
                return `(${this.emitExpr(node.left)} ${node.op} ${this.emitExpr(node.right)})`;
            }
            case "call": {
                const args = node.args.map((a) => this.emitExpr(a));
                // `this.lang` is injected by emitters/registry.js (the
                // registered key, e.g. "js"/"cobol") -- not set for an
                // Emitter built standalone outside the registry, in which
                // case an extern simply never resolves here, same as an
                // unmapped name.
                const builtin = this.calls[node.name];
                const template = builtin || (this.lang && resolveExternForEmitter(node.name, this.lang, this._registry));
                if (!template) {
                    throw new Error(`emitter for .${this.ext}: no mapping for Math function "${node.name}"`);
                }
                // Only an extern's own per-target template is caller-
                // supplied code that could have a bug worth attributing
                // -- a built-in primitive's template is exprforge's own,
                // not worth wrapping.
                if (!builtin) this._externUsed = true;
                return builtin
                    ? template(args)
                    : withContext(`emitter for .${this.ext}: while emitting extern "${node.name}"`, () => template(args));
            }
            case "select": {
                const thenStr = this.emitExpr(node.then);
                const elseStr = this.emitExpr(node.else);
                return this.emitSelectImpl(node.cond, thenStr, elseStr);
            }
            case "cmp": {
                // cmp only ever appears as a select's cond, consumed directly
                // by emitSelectImpl above — it never reaches emitExpr in a
                // well-formed tree. Landing here means a cmp node was used
                // somewhere else (e.g. as a plain operand), which isn't
                // supported: cmp isn't a general boolean expression.
                throw new Error(`emitter for .${this.ext}: "cmp" is only valid inside a select() — got it elsewhere`);
            }
            case "index": {
                if (!this.emitIndexImpl) {
                    throw new Error(`emitter for .${this.ext}: array indexing not supported for this target yet`);
                }
                return this.emitIndexImpl(node.target, node.at);
            }
            default: {
                throw new Error(`emitter for .${this.ext}: unknown node type "${node.type}"`);
            }
        }
    }

    // `registry` (see macros.js's createRegistry()) defaults to the
    // process-wide default when omitted -- pass a session's own (see
    // index.js's createSession()) to resolve macros/externs against that
    // session instead. Stashed on `this` for emitExpr's "call" case to
    // read, same instance-state pattern emitters/cobol.js's own
    // `this._pool` already established.
    //
    // `opts.addTypeGuards` (default false): opt-in only, see
    // docs/runtime-type-guards.md for the full rationale. When true AND
    // this target declares a `typeGuard` template (see the constructor)
    // AND `fn.paramTypes` actually has an array-typed entry, one runtime
    // guard line per array-typed parameter is generated and spliced into
    // the output by formatFunctionImpl/formatSuiteImpl (both receive it
    // as a 4th argument, `guardLines: string[]`, defaulting to `[]` for
    // every target that doesn't consume it -- an extra unused argument
    // is harmless in JS, so the ~10 compiled-language emitters (which
    // never declare `typeGuard` and so never receive a non-empty array
    // here) don't need any change at all to stay correct). No effect
    // whatsoever for a target with no `typeGuard` template (every
    // compiled target already gets this from its own compiler) or a
    // call with no array-typed parameter.
    //
    // `fn.arrayLengths` (optional, independent of `opts.addTypeGuards`
    // itself but only ever emits anything WHEN it's also on): a
    // `{ [arrayParam]: lengthParam }` map declaring which OTHER scalar
    // parameter a given array parameter's real length is supposed to
    // equal (e.g. `{ arr: "m" }` for `cyclicElem(arr: number[], m, i)`).
    // ExprForge has no way to verify this itself -- an array's length
    // and a same-named-in-spirit scalar bound are two independently
    // caller-supplied values, nothing in the AST ties them together
    // (see docs/array-index-primitives.md's "Array length is always
    // caller-supplied" note) -- so this is authors opting in to
    // documenting the relationship explicitly, which then lets
    // `lengthGuardImpl` (see the constructor) emit one more runtime
    // check per declared pair, same 9-target availability and the same
    // "not perfect, real protection at the boundary" spirit as
    // `typeGuard` itself. See docs/runtime-type-guards.md's "Array
    // length" section.
    //
    // `opts.includeHelpers` (default true): whether this call may define
    // the target's support helpers at all; false defines none (and, for Go
    // and Zig, omits the package/import preamble). Targets that declare a
    // `helpers` map (python, perl, matlab, qb64, cobol) define only the
    // helpers the call's own code uses -- see usedHelpers above.
    //
    // Imports follow the same rule (python, perl, c, zig, go declare an
    // `imports` map): a preamble line such as `import math` is written only
    // when the call's code, or a helper it pulls in, references the module
    // -- see usedImports. The same shared `opts.emittedHelpers` Set records
    // written imports (as `import:<name>`), so a concatenated file imports
    // each module once, at the first function that needs it. Go is the one
    // exception: it requires imports before any declaration, so it keeps
    // its package-clause-call plus `forceMathImport` mechanism.
    //
    // `opts.emittedHelpers` (a Set, optional): for concatenating N functions
    // emitted for the SAME target into one compiled unit (a real, common
    // pattern -- one .bi/.cob file per program), pass ONE shared Set to
    // every call. Each helper is then defined once, at the first call that
    // uses it, so the file holds the union of used helpers with no
    // duplicate definition (which QB64 and GnuCOBOL reject, see
    // github.com/theraccoonbear/exprforge/pull/37). `formatFunctionImpl`/
    // `formatSuiteImpl` receive the full `opts` object as a 5th argument, so
    // a target-specific concern stays local to that target's emitter file.
    // See docs/multi-function-files.md.
    emitFunction(fn, registry = undefined, opts = {}) {
        this._registry = registry;
        // Set by emitExpr when an extern template contributes to the
        // output; read by usedImports (see selectImports' `onExtern`).
        this._externUsed = false;
        // Resolves every macro call and field() access into plain
        // arithmetic first -- see macros.js's own header comment. Must
        // run before checkUnboundVars: expansion is what introduces the
        // flattened let-bindings a multi-output macro's fields become,
        // and eliminates "field" nodes, which checkUnboundVars/
        // collectLets don't know how to walk.
        fn = expandMacros(fn, null, registry);
        // Checked once, before any per-target work starts -- see
        // checkUnboundVars's own comment in ast.js for why this matters
        // (a typo'd/forgotten identifier used to silently succeed here,
        // for every target, with no error at all).
        checkUnboundVars(fn);
        const guardLines = [];
        if (opts.addTypeGuards && fn.paramTypes) {
            const arrayParams = Object.keys(fn.paramTypes).filter((p) => fn.paramTypes[p] === "number[]");
            for (const p of arrayParams) {
                if (this.typeGuardImpl) guardLines.push(this.typeGuardImpl(p, fn.name));
                // Only emitted when the author actually declared the
                // pairing AND the named length parameter is a real
                // parameter of this fn -- a typo'd/stale arrayLengths
                // entry is silently a no-op here, same "opt-in, never a
                // surprise" spirit as addTypeGuards itself, rather than
                // throwing over what's still just documentation.
                const lengthParam = fn.arrayLengths?.[p];
                if (lengthParam && this.lengthGuardImpl && fn.params.includes(lengthParam)) {
                    guardLines.push(this.lengthGuardImpl(p, lengthParam, fn.name));
                }
            }
        }
        const { bindings, body } = collectLets(fn.body);
        const letBindings = bindings.map(({ name, node }) => ({
            name,
            valueStr: this.emitExpr(node),
        }));
        if (body.type === "outputs") {
            if (!this.formatSuiteImpl) {
                throw new Error(`emitter for .${this.ext}: no formatSuite configured — multi-output suites aren't supported for this target yet`);
            }
            const outputStrs = {};
            for (const [name, node] of Object.entries(body.fields)) {
                outputStrs[name] = this.emitExpr(node);
            }
            return this.formatSuiteImpl(fn, outputStrs, letBindings, guardLines, opts);
        }
        const bodyStr = this.emitExpr(body);
        return this.formatFunctionImpl(fn, bodyStr, letBindings, guardLines, opts);
    }
}

module.exports = Emitter;
module.exports.selectHelpers = selectHelpers;
module.exports.selectImports = selectImports;
