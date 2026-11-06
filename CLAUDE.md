# CLAUDE.md

## Agent change-control discipline (READ BEFORE ANY PUSH)

Applies to every AI coding agent working in this repo. Not a suggestion:
this exists because of a real incident on 2026-09-15, where PR #27 (a VS
Code syntax-highlighting extension the maintainer had never once tried
in an actual editor) was merged directly to `main`, then followed by two
more unreviewed commits pushed straight to `main`, on nothing stronger
than "let's get this closed out today. Go." All of it landed under the
maintainer's own GitHub identity, not the agent's. It had to be reverted
and redone as a fresh PR (#31).

**Never push, merge, or publish anything without showing the exact
change first and getting an explicit go-ahead, in that same
conversation turn.** With zero exceptions:

- Merging any pull request, however green its CI is. Green CI is not
  the same as a human having actually tried the change.
- Pushing directly to `main` or any protected/default branch — a
  version bump, a one-line typo fix, a CI workflow fix, anything.
- Creating a GitHub Release, a git tag, or triggering any publish
  workflow (npm, a package/extension marketplace, etc.).
- Changing repository settings (Pages source, branch protection,
  secrets, webhooks).
- Force-pushing, deleting a branch, or rewriting/reverting history.

"Show" means stating plainly what you're about to do, to what target,
and the actual diff or command — not a vague summary — and then
waiting. A broad instruction like "get this done," "ship it," "go," or
"close this out" is a request to figure out what's needed and report
back. It is never, by itself, authorization to execute an irreversible
or outward-facing step. If it's ambiguous whether an instruction covers
a push/merge/publish, treat it as not covering it and ask.

Confirmation is scoped to the single action it was given for.
Approval to push commit A does not carry forward to commit B; approval
to merge one PR does not also authorize pushing follow-on commits to
that branch afterward. Each one gets its own show-then-wait.

Untested is not the same as passing CI. A human confirming they've
actually exercised a change (run it, opened it in the real tool it
targets) is a different signal than automated tests passing, and should
never be assumed from CI status alone — ask directly.

## Branch discipline

**NEVER branch off a feature branch.** Always start new work from `main` (or the
repo's default branch). Before creating a feature branch:

```
git checkout main
git pull origin main
git checkout -b feature/thing
```

If you accidentally branch off the wrong base, rebase onto main before pushing:

```
git fetch origin main
git rebase --onto origin/main <wrong-base> feature/branch-name
git push --force-with-lease
```

Verify the branch contains only your commits before opening a PR:

```
git log --oneline origin/main..HEAD
```

## Codebase

ExprForge is a cross-language math expression code generator. Author a
pure-arithmetic formula once as an AST, emit identical-behavior implementations
in <!-- exprforge:count:executable -->20<!-- /exprforge --> programming languages (executable targets) plus a native JS evaluator,
LaTeX typeset output, and a printer for ExprForge's own syntax (<!-- exprforge:count:outputs -->22<!-- /exprforge --> output
targets in total).

### Architecture layers

- Layer 0: `evaluate.js` -- native tree-walking interpreter
- Layer 1: `ast.js` (builders) + `emitters/<lang>.js` (per-target codegen)
- Layer 2: `expr.js` (infix parser sugar)
- Layer 3: `fn.js` / macros / sessions (optional higher-level sugar)

### Key files

- `ast.js` -- AST node types and builder primitives
- `primitives.js` -- fixed arity table for <!-- exprforge:count:primitives -->24<!-- /exprforge --> built-in Math primitives
- `evaluate.js` -- native interpreter over the AST
- `differentiate.js` -- symbolic differentiation (d/dx)
- `analyze.js` -- opt-in interval/range analysis (`analyzeRanges`): output bounds and divide-by-zero warnings
- `emitters/base.js` -- emitter base class with shared emitExpr pipeline
- `emitters/registry.js` -- maps language names to emitter instances
- `emitters/meta.js` -- helpers over each emitter's `meta` object (the field reference lives there)
- `scripts/sync-docs.js` -- regenerates the marked doc regions from the registry (`npm run docs:sync`)
- `macros.js` -- macro/extern expansion system
- `math/index.js` -- pre-built 3D math compositions (dot3, len3, etc.)

### Adding a new language emitter

1. Create `emitters/<lang>.js` exporting an Emitter instance with `emitter.meta`
   set (display name, conformance label, toolchain probes and docs row,
   division/comparison/guard expectations, native round/select/min-max
   behavior -- field reference in `emitters/meta.js`)
2. Add one line to `emitters/registry.js`
3. Add `.github/workflows/test-<lang>.yml` (named by `meta.ci.workflow`)
4. Add the language's conformance harness: `runX`/`runSuiteX` plus a
   `registerRunner("<lang>", ...)` line next to them in
   `test/conformance.test.js`, and a multi-function test in
   `test/multi-function-files.test.js`
5. Add `playground/src/tools/playground/languages/<lang>.ts` for syntax
   highlighting and default visibility (optional; the target still appears
   without it)
6. Run `npm run docs:sync` and commit the regenerated docs

Counts, ratio sentences, per-language lists, the README toolchain table, the
README CI badges, the package.json description, the registry-wide tests
(division, comparison operators, type guards) and the playground's language
list all derive from the registry and `meta`; no central list needs editing.

### Testing

```
npm test                    # run all tests (skips missing toolchains)
npm run test:coverage       # with coverage
```

Several `npm test` runs may execute at once. Scratch directories come from
`tmpDir()` in `test/harness-util.js` (unique `fs.mkdtemp` dirs, removed at
exit; `EXPRFORGE_KEEP_TMP=1` keeps the leftovers of failed cases), and the
qb64pe compile step goes through `compileQb64()`, which holds a cross-process
lock because qb64pe compiles inside its shared install directory. New
harness code must use these helpers rather than `mkdtempSync` or a direct
`qb64pe` call.

Tests use Node's built-in test runner (`node:test` + `node:assert`).
Conformance tests compile/interpret emitted code against every available
toolchain and skip (not fail) when a toolchain is absent.

### Conventions

- Pure arithmetic expressions only -- no control flow, no loops
- Every `bin` node is emitted with explicit parens for identical FP rounding
- `expandMacros()` runs before everything (evaluate, emit, checkUnboundVars)
- No new dependencies unless absolutely necessary
- No comments in generated code
- **Every AST-level addition (a new primitive, a new node type) supports
  every registered emitter target by default -- full coverage is the
  starting bar, not an opt-in stretch goal for "whichever languages need it
  right now."** Falling short for one target needs a profound, specific,
  documented reason (a real structural mismatch, like GnuCOBOL's
  compile-time-fixed `OCCURS` array size -- see
  `docs/array-index-primitives.md`), not "didn't get to it yet" or "only
  two languages asked for this." Where a target genuinely can't support
  something yet, throw a clear "not supported for this target" error at
  generation time (same pattern `formatSuite` already uses) and treat it as
  tracked follow-up work, not settled scope.
- **New user-facing functionality (an analysis, option, target or API) is
  demonstrated in the playground as part of the same work, or a follow-up
  issue is filed right away.** The playground is how people discover a
  feature exists; a capability that ships without a tab or control there
  stays invisible to most users.
- **Any feature with more than one discrete operator/keyword value
  (comparison operators today; the next one won't be the last) needs real
  compiled/executed conformance coverage for EVERY value, not just one
  representative one.** This exists because of a real, shipped bug
  (2026-09-16): `cmp()`'s six operators (`>` `<` `>=` `<=` `==` `!=`)
  compile to genuinely different syntax on different targets (QB64 has
  neither `==` nor `!=`; Fortran and Lua both lack `!=`), but every sample
  that ever exercised `select()`/`cmp()` against a real compiled toolchain
  (`spline-frame.js`) happened to only ever use `>` -- so `==`/`!=` shipped
  broken on three targets for as long as `select`/`cmp` have existed,
  caught only by a direct user report, not CI. `evaluate()`/unit tests
  passing is NOT evidence here: they exercise the interpreter's own
  language (JS), which can't reveal a target-language syntax mismatch by
  construction. See `samples/comparison-ops-demo.js` and
  `test/comparison-operators.test.js` for what closing this gap actually
  looked like -- both a real-compiler conformance sample AND a static
  per-emitter/per-value string check, not just one or the other.

### Docs-sync rule

Any change to targets, primitives, node types, options, toolchain versions,
numeric behavior or CI updates every doc that states it, in the same PR.
Facts that derive from the registry are generated, not hand-maintained:

- `npm run docs:sync` (`scripts/sync-docs.js`) rewrites every region
  delimited by exprforge comment markers (example below) in README.md,
  CLAUDE.md and `docs/`, plus the `package.json` description. Keys are the
  object returned by `docFacts()` in `emitters/meta.js`: target counts,
  per-language lists, the ratio sentences (native round tie behavior, whether
  `select` short-circuits), the supported-toolchain-versions table and the CI
  badges.
  ```
  <!-- exprforge:count:executable -->N<!-- /exprforge -->
  ```

- `test/registry-meta.test.js` runs the generator in check mode, so stale
  counts, lists or tables fail `npm test` (and CI) with the fix named.
- To state a new derived number or list, add a key to `docFacts()` and put a
  marker where it belongs; do not type the number.
- Per-language expectations used by tests (division text, comparison
  spellings, type-guard substrings, toolchain probes) live in each
  `emitters/<lang>.js` `meta`, not in central test tables.

What stays hand-written: prose, ADRs (use count-free wording such as "a
majority of the executable targets"), the README sections for individual
behaviors, and workflow contents. When a change touches one of those, update
it in the same PR:

- README sections that describe behavior
- `package.json` keywords
- `docs/` and ADRs
- playground text
- workflow comments
- test comments

Prefer count-free wording ("every registered target") where possible. Where a
number is needed, use a marker. The convention is: N programming languages
(executable targets), LaTeX typeset output, ExprForge's own syntax printer,
M output targets in total. Claims about identical computed behavior cover the
executable targets (plus the evaluator), not LaTeX or `expr`.

Checklist when adding a new target:

- [ ] `emitters/<lang>.js` with `emitter.meta`, and its `emitters/registry.js` line
- [ ] CI workflow `.github/workflows/test-<lang>.yml` (named by `meta.ci`)
- [ ] conformance harness and multi-function test (every operator/keyword value covered)
- [ ] `npm run docs:sync`
- [ ] playground language file (highlighting, default visibility)

### Toolchain versions

Adding a target, or raising the minimum toolchain version an emitter
needs, requires updating that emitter's `meta.toolchain.docs` (the row of
the README table "Supported toolchain versions", regenerated by
`npm run docs:sync`) and the matching `.github/workflows/test-<lang>.yml`.
Keep Zig and GnuCOBOL pinned exactly; re-verification steps are in their
workflows.
