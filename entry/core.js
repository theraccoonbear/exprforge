// exprforge/core -- AST builders and the primitive arity table only.
// No emitters, parser, evaluator or node:fs.
module.exports = { ...require("../ast.js"), ...require("../primitives.js") };
