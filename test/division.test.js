// exprforge/test/division.test.js
//
// Static per-emitter checks for division by a possibly-zero denominator,
// locking in the form each target emits. See
// docs/adr/0004-division-by-zero.md for the decision (IEEE 754 on every
// target where achievable) and samples/division-by-zero-demo.js plus the
// "divisionByZero" registration in test/conformance.test.js for the real
// compiled/executed coverage these string checks complement.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { v, num, div, add, call } = require("../ast.js");
const emitters = require("../emitters/registry.js");

function emitBody(lang, body, params = ["x", "y"]) {
    return emitters[lang].emitFunction({ name: "f", params, body });
}

// The exact text each target prints for div(x, y) with a variable
// denominator. Targets whose native division is already IEEE 754 keep the
// plain infix form.
const VARIABLE_DENOMINATOR = {
    js: "(x / y)",
    ts: "(x / y)",
    c: "(x / y)",
    java: "(x / y)",
    go: "(x / y)",
    rust: "(x / y)",
    csharp: "(x / y)",
    lua: "(x / y)",
    julia: "(x / y)",
    ruby: "(x / y)",
    fortran: "(x / y)",
    zig: "(x / y)",
    qb64: "(x / y)",
    scheme: "(/ x y)",
    python: "_exprforge_div(x, y)",
    perl: "_exprforge_div($x, $y)",
    php: "fdiv($x, $y)",
    cobol: "(x / y)",
    matlab: "(x / y)",
};

// LaTeX is typeset, not executed, so there is no runtime behavior to
// observe: the check is on the rendered fraction.
const TYPESET = {
    latex: "\\frac{x}{y}",
};

for (const [lang, expected] of Object.entries(TYPESET)) {
    test(`${lang}: division by a variable denominator is typeset as ${expected}`, () => {
        assert.ok(emitters[lang], `no emitter registered for ${lang}`);
        assert.ok(emitBody(lang, div(v("x"), v("y"))).includes(expected));
    });
}

for (const [lang, expected] of Object.entries(VARIABLE_DENOMINATOR)) {
    test(`${lang}: division by a variable denominator is emitted as ${expected}`, () => {
        assert.ok(emitters[lang], `no emitter registered for ${lang}`);
        assert.ok(emitBody(lang, div(v("x"), v("y"))).includes(expected));
    });
}

test("every registered emitter is covered by the division table above", () => {
    const covered = new Set([...Object.keys(VARIABLE_DENOMINATOR), ...Object.keys(TYPESET), "expr"]);
    for (const lang of Object.keys(emitters)) {
        assert.ok(covered.has(lang), `emitter "${lang}" has no division check in test/division.test.js`);
    }
});

// The three targets whose native "/" raises on a zero denominator get a
// guarded form, but only when the denominator could be zero: a nonzero
// numeric literal keeps the plain, readable operator.
const GUARDED = {
    python: { plain: "(x / 2)", helperCall: "_exprforge_div(" },
    perl: { plain: "($x / 2)", helperCall: "_exprforge_div(" },
    php: { plain: "($x / 2)", helperCall: "fdiv(" },
};

for (const [lang, { plain, helperCall }] of Object.entries(GUARDED)) {
    test(`${lang}: a nonzero literal denominator stays plain division`, () => {
        const out = emitBody(lang, div(v("x"), num(2)), ["x"]);
        assert.ok(out.includes(plain), out);
        const bodyLine = out.split("\n").find((l) => l.includes("return") && !l.includes("return $x / $y"));
        assert.ok(!bodyLine.includes(helperCall), bodyLine);
    });

    test(`${lang}: a literal zero denominator uses the guarded form`, () => {
        const out = emitBody(lang, div(v("x"), num(0)), ["x"]);
        assert.ok(out.includes(helperCall), out);
    });

    test(`${lang}: each operand of a guarded division is emitted exactly once`, () => {
        const numerator = call("sin", v("p"));
        const denominator = call("cos", v("q"));
        const out = emitBody(lang, div(numerator, denominator), ["p", "q"]);
        const body = out.split("\n").filter((l) => l.includes("return") && l.includes("sin")).join("\n");
        assert.strictEqual(body.split("sin").length - 1, 1, body);
        assert.strictEqual(body.split("cos").length - 1, 1, body);
    });
}

test("python: includeHelpers false omits the division helper", () => {
    const fn = { name: "f", params: ["x", "y"], body: div(v("x"), v("y")) };
    assert.ok(emitters.python.emitFunction(fn).includes("def _exprforge_div("));
    assert.ok(!emitters.python.emitFunction(fn, undefined, { includeHelpers: false }).includes("def _exprforge_div("));
});

test("perl: includeHelpers false omits the division helper", () => {
    const fn = { name: "f", params: ["x", "y"], body: div(v("x"), v("y")) };
    assert.ok(emitters.perl.emitFunction(fn).includes("sub _exprforge_div {"));
    assert.ok(!emitters.perl.emitFunction(fn, undefined, { includeHelpers: false }).includes("sub _exprforge_div {"));
});

test("targets with native IEEE division emit no helper", () => {
    for (const lang of ["js", "c", "go", "rust", "lua", "qb64", "matlab"]) {
        const out = emitBody(lang, div(v("x"), v("y")));
        assert.ok(!out.includes("_exprforge_div"), `${lang} should not use a division helper`);
    }
});

// The concatenated-file pattern (docs/multi-function-files.md) with a real
// interpreter: the helper is defined once, and both functions work,
// including the zero-denominator case.
function hasTool(cmd, args) {
    try {
        execFileSync(cmd, args, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

const fnA = { name: "fa", params: ["x", "y"], body: div(v("x"), v("y")) };
const fnB = { name: "fb", params: ["x", "y"], body: add(div(v("x"), v("y")), num(1)) };

test("python: two concatenated functions share one division helper", { skip: !hasTool("python3", ["--version"]) && "python3 not available" }, () => {
    const src =
        emitters.python.emitFunction(fnA) +
        "\n\n" +
        emitters.python.emitFunction(fnB, undefined, { includeHelpers: false }) +
        "\nprint(fa(1.0, 0.0), fb(-1.0, 0.0), fa(1.0, 4.0))\n";
    assert.strictEqual(src.split("def _exprforge_div(").length - 1, 1);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-div-py-"));
    const file = path.join(dir, "main.py");
    fs.writeFileSync(file, src);
    const out = execFileSync("python3", [file]).toString().trim();
    fs.rmSync(dir, { recursive: true, force: true });
    assert.strictEqual(out, "inf -inf 0.25");
});

test("perl: two concatenated functions share one division helper", { skip: !hasTool("perl", ["-v"]) && "perl not available" }, () => {
    const src =
        emitters.perl.emitFunction(fnA) +
        "\n" +
        emitters.perl.emitFunction(fnB, undefined, { includeHelpers: false }) +
        "\nprint join(' ', fa(1.0, 0.0), fb(-1.0, 0.0), fa(1.0, 4.0)), \"\\n\";\n";
    assert.strictEqual(src.split("sub _exprforge_div {").length - 1, 1);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-div-pl-"));
    const file = path.join(dir, "main.pl");
    fs.writeFileSync(file, src);
    const out = execFileSync("perl", ["-w", file]).toString().trim();
    fs.rmSync(dir, { recursive: true, force: true });
    assert.strictEqual(out, "Inf -Inf 0.25");
});
