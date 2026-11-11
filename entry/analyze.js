// exprforge/analyze -- range analysis, duplicate detection, differentiation.
// analyze.js inherently loads emitters/exprsyntax.js and emitters/meta.js (not the registry, not node:fs).
module.exports = {
    ...require("../analyze.js"),
    ...require("../duplicates.js"),
    ...require("../differentiate.js"),
};
