# ExprForge fn/expr Syntax

Syntax highlighting for [exprforge](https://github.com/theraccoonbear/exprforge)'s `fn`/`expr` grammar, in two places:

- **Standalone `.expr`/`.fn` files** — the same round-trip text format `loadExpr(path)`/`emit(fn, "expr")` read and write (see the root README's "Loading a `.expr` file" section).
- **Inline, where the syntax is actually authored day-to-day** — `` expr`a * b + 1` `` and `` fn`let m = ...; return m;` `` tagged templates directly inside `.js`/`.ts` source, highlighted in place, `${...}` interpolation switching back to real JS/TS highlighting for its contents.

Not a second, approximate implementation of the grammar — the TextMate patterns in `syntaxes/exprforge.tmLanguage.json` mirror `expr.js`'s own `tokenizeSegment` rule-for-rule (`#` comments, number literals including `.5`/`1e-9`, the `let`/`return`/`fn`/`macro` keyword set, the fixed operator/punctuation set), the same source of truth the playground's own CodeMirror mode (`playground/src/tools/playground/exprForgeMode.ts`) already follows, so the two never drift apart.

## What this doesn't do

Highlighting only — no diagnostics, no "did this actually parse" feedback, no hover info. That's real parser-backed tooling (a language server), a separate, larger effort — see `docs/editor-support-spec.md`'s Phase 2 for the design, not started.

## Development

```
npm install
npm test
```

Tests are real VS-Code-grade tokenization snapshots (`vscode-tmgrammar-test`, backed by the same `vscode-textmate`/`vscode-oniguruma` engine VS Code itself uses) over the fixture files in `fixtures/` — not a guess about what the grammar does, an actual run of it (named `fixtures/`, not `test/`, deliberately: a directory literally named `test` gets auto-discovered by the root project's own `node --test`, and `fixtures/inline.ts` isn't a real test file for that runner to try to execute). `npm run test:standalone` covers the `.expr` file grammar directly; `npm run test:injection` covers the tagged-template injection, loaded against a real TypeScript/JavaScript grammar (`tm-grammars`, a snapshot of VS Code's own bundled grammars) so `${...}` interpolation's switch back to real JS highlighting is actually verified, not assumed.

To review a snapshot change (a deliberate grammar update, not a regression): `npx vscode-tmgrammar-snap -u ...` (see `package.json`'s own scripts for the exact grammar/scope flags) regenerates the `.snap` files -- diff and review them like any other test-expectation change before committing.

## Installing locally (unpublished)

Not yet on the Marketplace or Open VSX. Package and side-load:

```
npx @vscode/vsce package
code --install-extension exprforge-syntax-0.1.0.vsix
```

VSCodium: same `.vsix`, same install command (`codium` in place of `code`) -- same OSS core, only the distribution channel differs.
