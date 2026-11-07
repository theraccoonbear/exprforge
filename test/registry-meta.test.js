// exprforge/test/registry-meta.test.js
//
// Guards the registry-driven design: every emitter carries a complete
// `meta` object (see emitters/meta.js), the CI workflow it names exists,
// and the generated doc regions (counts, ratio sentences, per-language
// lists, the toolchain table, the README badges, package.json's
// description) match what the registry says. A stale doc fails here with
// the one-line fix.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const emitters = require("../emitters/registry.js");
const { targets, validateMeta, docFacts } = require("../emitters/meta.js");
const { computeChanges, renderMarkdown, markdownFiles } = require("../scripts/sync-docs.js");

const ROOT = path.join(__dirname, "..");
const WORKFLOWS = path.join(ROOT, ".github", "workflows");

// Workflows that test the project as a whole rather than one target.
const NON_TARGET_WORKFLOWS = ["test-coverage.yml", "test-vscode-syntax.yml"];

test("every registered emitter has complete, valid metadata", () => {
    const problems = targets().flatMap(({ lang, meta }) => validateMeta(lang, meta));
    assert.deepStrictEqual(problems, []);
});

test("emitter display names and conformance labels are unique", () => {
    const names = targets().map((t) => t.meta.displayName);
    assert.strictEqual(new Set(names).size, names.length);
    const labels = targets().map((t) => t.meta.testTarget).filter(Boolean);
    assert.strictEqual(new Set(labels).size, labels.length);
});

test("every emitter's CI workflow exists and runs that target's conformance label", () => {
    for (const { lang, meta } of targets()) {
        if (!meta.ci) continue;
        const file = path.join(WORKFLOWS, meta.ci.workflow);
        assert.ok(fs.existsSync(file), `${lang}: .github/workflows/${meta.ci.workflow} does not exist`);
        if (meta.testTarget) {
            const text = fs.readFileSync(file, "utf8");
            assert.ok(
                text.includes(`EXPRFORGE_TEST_TARGETS=${meta.testTarget}`),
                `${lang}: ${meta.ci.workflow} should run EXPRFORGE_TEST_TARGETS=${meta.testTarget} npm test`,
            );
        }
    }
});

test("every test-*.yml workflow belongs to a registered emitter", () => {
    const claimed = new Set(targets().map((t) => t.meta.ci && t.meta.ci.workflow).filter(Boolean));
    for (const file of fs.readdirSync(WORKFLOWS)) {
        if (!/^test-.*\.yml$/.test(file) || NON_TARGET_WORKFLOWS.includes(file)) continue;
        assert.ok(claimed.has(file), `${file} is not named by any emitter's meta.ci.workflow`);
    }
});

test("every emitter with toolchain probes documents its toolchain row", () => {
    for (const { lang, meta } of targets()) {
        if (meta.toolchain && meta.toolchain.probes) {
            assert.ok(meta.toolchain.docs, `${lang}: toolchain.docs is required next to toolchain.probes`);
        }
    }
});

test("generated doc regions are in sync with the registry (run `npm run docs:sync` to fix)", () => {
    const stale = computeChanges().map((c) => path.relative(ROOT, c.file));
    assert.deepStrictEqual(stale, [], `stale generated regions in: ${stale.join(", ")} -- run \`npm run docs:sync\``);
});

test("the core generated regions are present in the docs", () => {
    const used = new Set();
    for (const file of markdownFiles()) {
        for (const m of fs.readFileSync(file, "utf8").matchAll(/<!-- exprforge:([\w:-]+) -->/g)) used.add(m[1]);
    }
    for (const key of ["count:executable", "count:outputs", "table:toolchains", "badges"]) {
        assert.ok(used.has(key), `no doc uses the ${key} region`);
    }
});

test("an unknown marker key is rejected rather than silently kept", () => {
    assert.throws(() => renderMarkdown("<!-- exprforge:count:nope -->1<!-- /exprforge -->", docFacts(), "x.md"), /unknown/);
});

test("the ratio facts partition the executable targets", () => {
    const facts = docFacts();
    const exec = targets().filter((t) => t.meta.kind === "executable").length;
    assert.strictEqual(Number(facts["count:round-away"]) + Number(facts["count:round-other"]), exec);
    assert.strictEqual(Number(facts["count:select-eager"]) + Number(facts["count:select-lazy"]), exec);
    assert.strictEqual(Number(facts["count:outputs"]), Object.keys(emitters).length);
});
