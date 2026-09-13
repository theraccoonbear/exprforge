# CLAUDE.md

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
