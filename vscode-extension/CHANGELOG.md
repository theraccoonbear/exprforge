# Changelog

## 0.1.0

Initial release.

- Standalone `.expr`/`.fn` file syntax highlighting, mirroring `expr.js`'s
  own tokenizer rule-for-rule.
- Inline syntax highlighting for `` expr`...` ``/`` fn`...` `` tagged
  templates inside `.js`/`.ts` source, with `${...}` interpolation
  switching back to real JS/TS highlighting.
- Highlighting only — no diagnostics yet. See the root README's "Editor
  support" section and `docs/editor-support-spec.md` for what a real
  parser-backed language server (Phase 2) would add.
