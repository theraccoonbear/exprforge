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
    ruby: require("./ruby.js"),
    php: require("./php.js"),
    julia: require("./julia.js"),
    r: require("./r.js"),
    fortran: require("./fortran.js"),
    zig: require("./zig.js"),
    scheme: require("./scheme.js"),
    cobol: require("./cobol.js"),
    matlab: require("./matlab.js"),
    expr: require("./exprsyntax.js"),
    latex: require("./latex.js"),
};

// Each emitters/<lang>.js sets its own `lang` (its registered key) so it
// also works standalone, outside this registry -- base.js's emitExpr uses
// this.lang to resolve an extern (see loadExtern() in macros.js). The
// registry only asserts that the two agree.
for (const [lang, emitter] of Object.entries(emitters)) {
    if (emitter.lang !== lang) {
        throw new Error(`emitters/registry.js: emitter registered as "${lang}" has lang "${emitter.lang}"`);
    }
}

module.exports = emitters;
