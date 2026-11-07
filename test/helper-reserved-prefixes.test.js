// exprforge/test/helper-reserved-prefixes.test.js
//
// Registry-wide guard for the reserved identifier prefixes (see
// RESERVED_PREFIXES in ast.js): any emitter helper whose name starts with
// an underscore is a name a user identifier could otherwise shadow, so it
// has to fall under a reserved prefix that the AST builders reject. A new
// emitter with `_`-prefixed helpers is covered the moment it is registered.
const test = require("node:test");
const assert = require("node:assert");
const { v, call, num } = require("../ast.js");
const emitters = require("../emitters/registry.js");

const underscoreHelpers = Object.entries(emitters).flatMap(([lang, emitter]) =>
    Object.keys(emitter.helpers || {})
        .filter((name) => name.startsWith("_"))
        .map((name) => [lang, name]),
);

test("at least one emitter uses underscore-prefixed helpers", () => {
    assert.ok(underscoreHelpers.length > 0);
});

for (const [lang, name] of underscoreHelpers) {
    test(`${lang}: helper ${name} falls under a reserved prefix that v() and call() reject`, () => {
        assert.throws(() => v(name), /reserved prefix/);
        assert.throws(() => call(name, num(1)), /reserved prefix/);
    });
}
