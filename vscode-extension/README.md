# ExprForge fn/expr Syntax

Syntax highlighting for [exprforge](https://github.com/theraccoonbear/exprforge)'s `fn`/`expr` grammar, in two places:

- **Standalone `.expr`/`.fn` files**: the same round-trip text format `loadExpr(path)`/`emit(fn, "expr")` read and write (see the root README's "Loading a `.expr` file" section).
- **Inline, where the syntax is actually authored day-to-day**: `` expr`a * b + 1` `` and `` fn`let m = ...; return m;` `` tagged templates directly inside `.js`/`.ts` source, highlighted in place, with `${...}` interpolation switching back to real JS/TS highlighting for its contents.

Not a second, approximate implementation of the grammar. The TextMate patterns in `syntaxes/exprforge.tmLanguage.json` mirror `expr.js`'s own `tokenizeSegment` rule-for-rule (`#` comments, number literals including `.5`/`1e-9`, the `let`/`return`/`fn`/`macro` keyword set, the fixed operator/punctuation set), the same source of truth the playground's own CodeMirror mode (`playground/src/tools/playground/exprForgeMode.ts`) already follows, so the two never drift apart.

## What this doesn't do

Highlighting only: no diagnostics, no "did this actually parse" feedback, no hover info. That's real parser-backed tooling (a language server), a separate, larger effort. See `docs/editor-support-spec.md`'s Phase 2 for the design, not started.

## Development

```
npm install
npm test
```

Tests are real VS-Code-grade tokenization snapshots (`vscode-tmgrammar-test`, backed by the same `vscode-textmate`/`vscode-oniguruma` engine VS Code itself uses) over the fixture files in `fixtures/`: not a guess about what the grammar does, but an actual run of it (named `fixtures/`, not `test/`, deliberately, since a directory literally named `test` gets auto-discovered by the root project's own `node --test`, and `fixtures/inline.ts` isn't a real test file for that runner to try to execute). `npm run test:standalone` covers the `.expr` file grammar directly; `npm run test:injection` covers the tagged-template injection, loaded against a real TypeScript/JavaScript grammar (`tm-grammars`, a snapshot of VS Code's own bundled grammars), so `${...}` interpolation's switch back to real JS highlighting is actually verified, not assumed.

To review a snapshot change (a deliberate grammar update, not a regression): `npx vscode-tmgrammar-snap -u ...` (see `package.json`'s own scripts for the exact grammar/scope flags) regenerates the `.snap` files; diff and review them like any other test-expectation change before committing.

## Distribution: Open VSX only, deliberately

This extension is published to [Open VSX](https://open-vsx.org) — what
VSCodium and other non-Microsoft-branded editors install from — and
**not** to the Microsoft VS Code Marketplace, on purpose.

**Why**: generating the Marketplace's publish token requires an Azure
DevOps organization, and as of 2026, creating a *new* Azure DevOps
organization requires an active Azure subscription — meaning a credit
card on file, even though nothing gets charged — just to get a token
for publishing a free, open-source extension. Open VSX has no such
requirement: a GitHub login and a token from your account settings is
the entire setup. That's the whole reason; see
`docs/editor-support-spec.md` for the same note in the design doc.

**What this costs**: official Microsoft VS Code does not search or
install from Open VSX by default, and there's no simple settings toggle
for it — only a manual `product.json` edit most users never make. So
VSCodium/OSS-fork users get this extension the normal way (search,
install); plain VS Code users would need to manually download the
`.vsix` from Open VSX and side-load it. Accepted tradeoff, not an
oversight.

## Installing locally

Package and side-load (works the same regardless of publish status):

```
npm run package
codium --install-extension exprforge-syntax-0.1.0.vsix
```

(`code` in place of `codium` for official VS Code — same `.vsix`, same
command, same OSS core; it's only automatic discovery via the
Extensions panel that differs, per above.)

## Publishing (maintainers)

Automatic: `.github/workflows/publish-vscode-extension.yml` runs on
every push to `main` that touches `vscode-extension/**`, and republishes
whenever `package.json`'s `version` actually changed in that push (so
merging a PR that only fixes a typo doesn't attempt a republish of a
version that's already live). Runs the grammar tests as a gate first,
then publishes to Open VSX (`ovsx`). Bumping this directory's
`package.json` version and merging is the entire release process;
there's no separate tag or GitHub Release step.

One-time setup before that workflow can succeed: a namespace matching
this directory's `package.json` `publisher` field, claimed at
[open-vsx.org](https://open-vsx.org) (GitHub login, no card), and an
`OVSX_PAT` repo secret generated from your Open VSX account settings.

Local dry run of packaging alone (no publish, no secrets needed):
`npm run package`.
