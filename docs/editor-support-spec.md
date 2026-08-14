# Editor support for `expr`/`fn` syntax (VS Code / VSCodium)

**Status: Phase 1a and 1b shipped** (`vscode-extension/`) -- both the
standalone `.expr`/`.fn` grammar and the inline tagged-template
injection, tested with real `vscode-textmate`-backed tokenization
snapshots (`vscode-extension/README.md`). Phase 2 (language server) is
still just the idea below, not started.

## Motivation

`expr`/`fn` source shows up in two places today, and they want different
tooling:

1. **Inline, as JS/TS tagged templates** — `` expr`a * b + 1` `` and
   `` fn`let m = ...; return m;` `` written directly inside `.js`/`.ts`
   files. This is the primary, everyday way the syntax is actually
   authored right now.
2. **As standalone files** — `emitters/exprsyntax.js` (registry key
   `expr`, `.ext = "fn"`) really does produce bare `.fn` source text as
   one of the 18 output targets, so a real `.fn` file on disk is also a
   legitimate artifact, not hypothetical.

These need different VS Code mechanisms and should be scoped/decided
separately, not conflated into one "add a language" task.

## Not Electron-relevant

Syntax highlighting doesn't run any JS or touch Electron at all — it's a
declarative TextMate grammar (a JSON file of regex patterns mapping
token classes to scopes) plus a `package.json` contribution block
registering the language. The place a Node host process actually matters
is a language *server* (see Phase 2) — extensions run in Node, so a
server there can `require()` the real parser instead of approximating it
with regex.

## Phase 1a — standalone `.fn`/`.expr` file support (SHIPPED, see vscode-extension/)

Grammar surface is small and fully regex-lexable: `let`/`return`/`fn`/
`macro` keywords (the last two added by issue #21/#25's loadExprSource()
export-marking work, after this doc was first written), identifiers,
numbers (incl. `.5`, `1e-9`), the fixed operator set
`+ - * / ^ ( ) , ? : > < >= <= == != ; { } =`, and `#` end-of-line
comments (added since this doc was first written -- `expr.js`'s
tokenizer has no `//`/`/* */` handling, only `#`).

- `package.json`: `contributes.languages` (id, extensions `.fn`/`.expr`,
  icon) + `contributes.grammars` (scope name, path to the `.tmLanguage.json`).
- One grammar file, ~60-100 lines, adaptable from any minimal-language
  TextMate template.
- VSCodium reuses the same extension unchanged (same OSS core as VS
  Code) — only the distribution channel differs (Marketplace vs. Open
  VSX vs. unpublished `.vsix` side-load).
- **Effort: a few hours.**

## Phase 1b — inline highlighting inside `` expr`...` ``/`` fn`...` `` template literals (SHIPPED, see vscode-extension/)

Higher immediate value than 1a, since this is where the syntax is
actually written day-to-day — same pattern VS Code's own
`graphql`/`styled-components`/`sql` template-tag extensions use: a
TextMate **injection grammar** that matches JS/TS template literals
tagged with a specific identifier (`expr`/`fn`) and applies the `.fn`
grammar from 1a to the string content, live, inside a `.js`/`.ts` file.

- Needs an injection selector (`"injectionSelector":
  "L:meta.embedded.expr"`-style scoping, matched against
  `source.js`/`source.ts`) rather than a top-level language grammar.
  Fiddlier to get right than 1a — TextMate injection precedence/scoping
  is a known rough edge in the ecosystem — but well-trodden.
- Depends on 1a's grammar existing first (reused, not duplicated).
- **Effort: roughly 1-2 days**, mostly spent on injection-scope
  debugging rather than grammar authoring.

## Phase 2 — language server (real diagnostics, not approximated ones)

The actual leverage point for "it's JS": an LSP server is a Node
process, so it can `require("exprforge")`'s real `expr.js`/`fn.js`
`Parser`/`tokenizeSegment` directly and report the exact same parse
errors the tag functions already throw — not a second, regex-based
approximation of correctness.

- Needs: `vscode-languageserver`/`vscode-languageclient` scaffolding, a
  document-sync handler, a diagnostics publisher, and a small amount of
  glue mapping each token's existing `pos` (a character offset into the
  reconstructed source string — see `expr.js`'s tokenizer) to LSP
  line/column positions.
- Real payoff: parse errors, and potentially hover-info/go-to-def for
  `let`-bound names, show up as-you-type, sourced from the one true
  parser instead of a second implementation that could drift from it.
- Only worth doing after 1a/1b prove the grammar/scoping is stable —
  building the server against a shifting client-side grammar is wasted
  churn.
- **Effort: a few days**, most of it protocol scaffolding rather than
  anything specific to this grammar.

## Open decision before starting

~~Phase 1a and 1b solve different problems... worth deciding which one
(or both) actually matters before committing effort~~ -- resolved by
building both: 1b needs 1a's grammar file to exist first anyway (reused,
not duplicated, see `vscode-extension/syntaxes/exprforge.injection.json`'s
own `{"include": "source.exprforge"}`), so there was no real cost to
shipping 1a alongside 1b rather than picking one.
