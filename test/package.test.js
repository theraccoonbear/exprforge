// exprforge/test/package.test.js
//
// Confirms the published package actually works when installed the way a
// real consumer gets it -- not just "the source files exist in this
// checkout". Catches exactly the class of bug that already happened for
// real once: expr.js was added and require()'d from index.js, but never
// added to package.json's "files" allowlist, so `npm pack` silently
// omitted it from the tarball -- `require("exprforge")` would have
// hard-crashed (MODULE_NOT_FOUND) for every real consumer of the
// published package, caught only by a human manually thinking to run
// `npm pack --dry-run` before shipping.
//
// This runs as part of `npm test`, and "test" is what `prepublishOnly`
// already runs before every `npm publish` (see package.json) -- so this
// specific class of bug can no longer reach a real release without a
// human explicitly overriding a failing test suite. Every other test
// file in this project proves a claim by actually running something
// (compiling, executing, comparing output) rather than reasoning about
// whether it should work; this is that same discipline applied to
// packaging itself, not just the code inside it.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROJECT_ROOT = path.join(__dirname, "..");

// `npm pack --json`'s own output SHAPE isn't stable across npm major
// versions -- confirmed the hard way (a real, though harmless, CI
// failure): npm 10.x returns an array (`[{...}]`), npm 12.x returns a
// plain object keyed by package name (`{"exprforge": {...}}`), both
// with the same inner fields otherwise. Normalizing here once, rather
// than destructuring `[0]` directly at each call site, so this doesn't
// need re-diagnosing the next time some CI job's npm version moves.
function parseNpmPackJson(output) {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
}

test("the packed tarball installs and require()s cleanly, with the real exports actually callable", () => {
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-pack-"));
    const consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-consumer-"));
    try {
        // --json, not just --dry-run text, so the exact tarball filename
        // (versioned, e.g. exprforge-0.3.0.tgz) doesn't need duplicating
        // or guessing here.
        const packOutput = execFileSync(
            "npm",
            ["pack", "--pack-destination", packDir, "--json"],
            { cwd: PROJECT_ROOT },
        ).toString();
        const { filename } = parseNpmPackJson(packOutput);
        const tarball = path.join(packDir, filename);

        // A minimal, unrelated consumer project -- installing a local
        // tarball (not the registry) needs no network access and stays
        // fast, but otherwise goes through the exact same npm install
        // path a real `npm install exprforge` would.
        fs.writeFileSync(
            path.join(consumerDir, "package.json"),
            JSON.stringify({ name: "exprforge-package-test-consumer", private: true }),
        );
        execFileSync("npm", ["install", tarball, "--no-audit", "--no-fund"], {
            cwd: consumerDir,
            stdio: "ignore",
        });

        // Exercises both export paths (require("exprforge") and
        // require("exprforge/math")) and actually CALLS a representative
        // function from each, plus emitAll -- not just checks that
        // requiring doesn't throw, since a missing file inside a
        // subdirectory that's otherwise present (e.g. one emitter) would
        // only surface once that specific code path runs.
        const script = `
            const { expr, v, add, mul, emitAll, emitters } = require("exprforge");
            const { safeDiv, dot3 } = require("exprforge/math");
            const assert = require("node:assert");
            assert.deepStrictEqual(expr\`a + b * c\`, add(v("a"), mul(v("b"), v("c"))));
            assert.strictEqual(typeof safeDiv, "function");
            assert.strictEqual(typeof dot3, "function");
            const out = emitAll({ name: "t", params: ["x"], body: expr\`x * 2\` });
            assert.strictEqual(Object.keys(out).length, Object.keys(emitters).length);
            console.log("OK");
        `;
        const scriptPath = path.join(consumerDir, "check.js");
        fs.writeFileSync(scriptPath, script);
        const result = execFileSync("node", [scriptPath], { cwd: consumerDir }).toString().trim();
        assert.strictEqual(result, "OK");
    } finally {
        fs.rmSync(packDir, { recursive: true, force: true });
        fs.rmSync(consumerDir, { recursive: true, force: true });
    }
});

// A second, narrower check that fails with a much more specific message
// ("X is missing from package.json's files") than the broad test above
// would (a bare MODULE_NOT_FOUND) -- every local (`./`-relative) require
// reachable from index.js must resolve to a path npm actually packs.
// Doesn't replace the real install-and-run test above (which is the only
// thing that can catch, say, a genuinely broken export at runtime); this
// just makes the common failure mode -- "added a file, forgot to list
// it" -- point straight at the fix.
test("every local module index.js requires is included in package.json's \"files\"", () => {
    const packOutput = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: PROJECT_ROOT }).toString();
    const { files } = parseNpmPackJson(packOutput);
    const packedPaths = new Set(files.map((f) => f.path));

    const seen = new Set();
    const toVisit = ["index.js"];
    while (toVisit.length > 0) {
        const relPath = toVisit.pop();
        if (seen.has(relPath)) continue;
        seen.add(relPath);

        assert.ok(packedPaths.has(relPath), `${relPath} is required (directly or transitively) from index.js but missing from package.json's "files"`);

        const absPath = path.join(PROJECT_ROOT, relPath);
        const source = fs.readFileSync(absPath, "utf8");
        const requireRe = /require\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g;
        let match;
        while ((match = requireRe.exec(source)) !== null) {
            const resolved = path.join(path.dirname(relPath), match[1]);
            const withExt = resolved.endsWith(".js") ? resolved : `${resolved}.js`;
            toVisit.push(withExt);
        }
    }
});
