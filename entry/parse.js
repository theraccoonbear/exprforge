// exprforge/parse -- readable-syntax front end (expr`...` and fn`...`).
// Loads ast.js, primitives.js and macros.js transitively; no emitters or node:fs.
module.exports = { ...require("../expr.js"), ...require("../fn.js") };
