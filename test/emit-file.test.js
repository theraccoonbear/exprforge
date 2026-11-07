// exprforge/test/emit-file.test.js
//
// Registry-driven static checks for emitFile(): every registered emitter
// emits a file of three functions that share a helper and an import (sqrt
// in two of them, a division in all) and the result defines each helper
// and each import exactly once. No toolchain needed; the compile-and-run
// coverage per target is in test/multi-function-files.test.js.
const test = require("node:test");
const assert = require("node:assert");
const { v, num, call, div, add } = require("../ast.js");
const emitters = require("../emitters/registry.js");
const { emitFile, emit } = require("../index.js");

const fns = [
    { name: "ga", params: ["x", "y"], body: div(call("sqrt", v("x")), v("y")) },
    { name: "gb", params: ["x", "y"], body: add(call("sqrt", v("y")), div(v("x"), v("y"))) },
    { name: "gc", params: ["x", "y"], body: div(add(v("x"), num(1)), v("y")) },
];

function occurrences(haystack, needle) {
    return haystack.split(needle).length - 1;
}

for (const [lang, emitter] of Object.entries(emitters)) {
    test(`emitFile(${lang}) -- three functions sharing sqrt and division define each helper and import once`, () => {
        const { ext, source } = emitFile(fns, lang);
        assert.strictEqual(ext, emitter.ext);
        for (const fn of fns) {
            assert.ok(source.toLowerCase().includes(fn.name) || lang === "latex", `${fn.name} is present`);
        }
        for (const [name, helper] of Object.entries(emitter.helpers)) {
            assert.ok(occurrences(source, helper.source) <= 1, `helper ${name} defined at most once`);
        }
        for (const [name, imp] of Object.entries(emitter.imports)) {
            assert.ok(occurrences(source, imp.source) <= 1, `import ${name} written at most once`);
        }
        const usedHelpers = Object.values(emitter.helpers).filter((h) => source.includes(h.source));
        const usedImports = Object.values(emitter.imports).filter((i) => source.includes(i.source));
        if (Object.keys(emitter.imports).length > 0) {
            assert.ok(usedImports.length >= 1, "the shared sqrt/division pulls in an import");
        }
        for (const h of usedHelpers) {
            for (const dep of h.deps || []) {
                assert.ok(source.includes(emitter.helpers[dep].source), "a helper's dependency is defined too");
                assert.ok(source.indexOf(emitter.helpers[dep].source) < source.indexOf(h.source), "dependencies come first");
            }
        }
    });

    test(`emitFile(${lang}) -- a one-function file carries only what that function uses`, () => {
        const lone = { name: "lone", params: ["x"], body: add(v("x"), num(1)) };
        const { source } = emitFile([lone], lang);
        for (const h of Object.values(emitter.helpers)) assert.ok(!source.includes(h.source));
        for (const i of Object.values(emitter.imports)) assert.ok(!source.includes(i.source));
    });
}

test("emitFile -- shared helpers come before the first function, imports before any function", () => {
    const py = emitFile(fns, "python").source;
    assert.ok(py.indexOf("import math") < py.indexOf("_exprforge_div"));
    assert.ok(py.indexOf("_exprforge_div") < py.indexOf("def ga("));
    const go = emitFile(fns, "go").source;
    assert.strictEqual(occurrences(go, "package "), 1);
    assert.ok(go.indexOf('import "math"') < go.indexOf("func Ga("));
    const php = emitFile(fns, "php").source;
    assert.strictEqual(occurrences(php, "<?php"), 1);
    const perl = emitFile(fns, "perl").source;
    assert.strictEqual(occurrences(perl, "\n1;\n"), 1);
    assert.ok(perl.endsWith("\n1;\n"));
});

test("emitFile -- a file of one function equals the standalone emit for targets without a wrapper", () => {
    for (const lang of Object.keys(emitters)) {
        if (["java", "csharp", "fortran", "matlab"].includes(lang)) continue;
        assert.strictEqual(emitFile([fns[0]], lang).source, emit(fns[0], lang).source, lang);
    }
});

test("emitFile -- wrapper targets name their wrapper from opts.wrapperName", () => {
    assert.ok(emitFile(fns, "java", undefined, { wrapperName: "Calc" }).source.includes("public final class Calc {"));
    assert.ok(emitFile(fns, "csharp", undefined, { wrapperName: "Calc" }).source.includes("public static class Calc\n"));
    assert.ok(emitFile(fns, "fortran", undefined, { wrapperName: "calc" }).source.includes("module calc\n"));
});
