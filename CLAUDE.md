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
in 18 target languages plus a native JS evaluator.

### Architecture layers

- Layer 0: `evaluate.js` -- native tree-walking interpreter
- Layer 1: `ast.js` (builders) + `emitters/<lang>.js` (per-target codegen)
- Layer 2: `expr.js` (infix parser sugar)
- Layer 3: `fn.js` / macros / sessions (optional higher-level sugar)

### Key files

- `ast.js` -- AST node types and builder primitives
- `primitives.js` -- fixed arity table for 22 built-in Math primitives
- `evaluate.js` -- native interpreter over the AST
- `differentiate.js` -- symbolic differentiation (d/dx)
- `emitters/base.js` -- emitter base class with shared emitExpr pipeline
- `emitters/registry.js` -- maps language names to emitter instances
- `macros.js` -- macro/extern expansion system
- `math/index.js` -- pre-built 3D math compositions (dot3, len3, etc.)

### Adding a new language emitter

1. Create `emitters/<lang>.js` exporting an Emitter instance
2. Add one line to `emitters/registry.js`

### Testing

```
npm test                    # run all tests (skips missing toolchains)
npm run test:coverage       # with coverage
```

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
