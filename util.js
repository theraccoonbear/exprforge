// exprforge/util.js
// Authoring conveniences — NOT AST primitives (see ast.js for those). These
// don't return Nodes and the emitters never see them; they just help you
// write the { name, params, body } function definitions exprforge already
// understands, without hand-duplicating near-identical ones.

// Expands a template into one function definition per axis. Purely
// `axes.map(templateFn)` under a name that signals intent: this is a vector
// operation expanded component-wise, not an arbitrary loop. See
// samples/spline-frame.js for a real call site (SpMakeFrame's R/U vectors).
function forComponents(axes, templateFn) {
    return axes.map(templateFn);
}

module.exports = { forComponents };
