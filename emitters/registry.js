// exprforge/emitters/registry.js
// Add a new language: write emitters/<lang>.js exporting an Emitter instance,
// then add one line here. Nothing else in the project needs to change.
module.exports = {
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
};
