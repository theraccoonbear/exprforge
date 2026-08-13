// exprforge/emitters/registry.js
// Add a new language: write emitters/<lang>.js exporting an Emitter instance,
// then add one line here. Nothing else in the project needs to change.
const emitters = {
    js: require("./js.js"),
    ts: require("./typescript.js"),
    qb64: require("./qb64.js"),
    c: require("./c.js"),
    java: require("./java.js"),
    go: require("./go.js"),
    rust: require("./rust.js"),
    csharp: require("./csharp.js"),
    python: require("./python.js"),
    lua: require("./lua.js"),
    perl: require("./perl.js"),
    php: require("./php.js"),
    julia: require("./julia.js"),
    fortran: require("./fortran.js"),
    zig: require("./zig.js"),
    scheme: require("./scheme.js"),
    cobol: require("./cobol.js"),
    expr: require("./exprsyntax.js"),
};

// Each emitter learns its own registered key here, once -- base.js's
// emitExpr uses this.lang to resolve an extern (see loadExtern() in
// macros.js), and this is the one place that already knows the
// name<->instance mapping, so it's the only file that needs to change
// for this instead of every emitters/<lang>.js.
for (const [lang, emitter] of Object.entries(emitters)) {
    emitter.lang = lang;
}

module.exports = emitters;
