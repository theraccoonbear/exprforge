# ExprForge 🔢🔨

Author a math expression once, as a small AST, and emit verified,
identical-behavior implementations in JavaScript, QB64, C, Java, Go, and Rust.

No parser, no dependencies. You build the AST directly with plain JS
functions; the same tree is walked once per target language.

## Why

Codegen tools like SymPy already turn math expressions into code for
mainstream languages. This exists for two things SymPy doesn't do:

- Targets like QB64/BASIC that no general codegen project supports.
- A conformance test harness that actually proves the emitted targets
  agree numerically, not just that they compile.

## Install

```
npm install exprforge
```

## Usage

```js
const { num, v, bin, mul, add, sub, emitAll } = require("exprforge");

const fn = {
    name: "lerp",
    params: ["a", "b", "t"],
    body: add(v("a"), mul(sub(v("b"), v("a")), v("t"))),
};

const outputs = emitAll(fn);
console.log(outputs.rust.source);
console.log(outputs.c.source);
```

## Supported Math functions

`sqrt abs pow sin cos tan asin acos atan atan2 log log2 log10 exp
floor ceil round trunc sign min max hypot`

Add more by extending a target's `calls` table in `emitters/<lang>.js`.
Requesting an unmapped function throws at build time, not silently.

## Adding a language

Write `emitters/<lang>.js` exporting an `Emitter` instance (see any
existing file as a template), then add one line to
`emitters/registry.js`. Nothing else changes.

## What this deliberately doesn't do

- No control flow (loops, branches, calling other generated functions) —
  this is an expression AST, not a program AST.
- No RNG — can't be made to produce identical output across languages,
  so it isn't offered as if it could.
- No arbitrary precision / complex numbers — float64 only, for now.

## Testing

```
npm test
```

Runs `node --test`, including a conformance check that compiles the C
output and diffs it against the JS output for the same inputs.

## License

MIT — see [LICENSE](./LICENSE).
