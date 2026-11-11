// exprforge/eval -- the native tree-walking evaluator.
// Loads ast.js, primitives.js and macros.js transitively; no emitters or node:fs.
module.exports = { ...require("../evaluate.js") };
