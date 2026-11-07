#!/usr/bin/env node
// exprforge/scripts/sync-docs.js
//
// Rewrites the generated regions of the docs from the emitter registry and
// each emitter's `meta` (see emitters/meta.js), so target counts, ratio
// sentences, per-language lists and tables are never maintained by hand.
//
//   node scripts/sync-docs.js            rewrite the regions in place
//   node scripts/sync-docs.js --check    exit 1 and list stale files
//
// A region is delimited by comment markers:
//
//   <!-- exprforge:count:executable -->20<!-- /exprforge -->
//
// Inline keys keep their region on one line. Block keys (the tables and
// the badge list) get their own lines between the markers. The list of
// keys is the object returned by docFacts() in emitters/meta.js. The
// package.json "description" is regenerated too.
const fs = require("node:fs");
const path = require("node:path");
const { docFacts, packageDescription } = require("../emitters/meta.js");

const ROOT = path.join(__dirname, "..");
const MARKER = /<!-- exprforge:([\w:-]+) -->([\s\S]*?)<!-- \/exprforge -->/g;
const BLOCK_KEYS = new Set(["badges", "table:toolchains"]);

function markdownFiles() {
    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".md")) out.push(full);
        }
    };
    for (const f of ["README.md", "CLAUDE.md"]) out.push(path.join(ROOT, f));
    walk(path.join(ROOT, "docs"));
    return out;
}

// Fenced code blocks are left alone so docs can show a marker as an example.
function renderMarkdown(text, facts, file) {
    return text
        .split(/(^[ \t]*```[\s\S]*?^[ \t]*```$)/m)
        .map((part, i) => (i % 2 === 1 ? part : renderRegions(part, facts, file)))
        .join("");
}

function renderRegions(text, facts, file) {
    return text.replace(MARKER, (_all, key) => {
        if (!(key in facts)) throw new Error(`${file}: unknown exprforge marker "${key}"`);
        const open = `<!-- exprforge:${key} -->`;
        const close = "<!-- /exprforge -->";
        return BLOCK_KEYS.has(key) ? `${open}\n${facts[key]}\n${close}` : `${open}${facts[key]}${close}`;
    });
}

function renderPackageJson(text) {
    const re = /^(\s*"description":\s*)"(?:[^"\\]|\\.)*"(,?)$/m;
    if (!re.test(text)) throw new Error("package.json: no description field found");
    return text.replace(re, (_m, pre, comma) => `${pre}${JSON.stringify(packageDescription())}${comma}`);
}

// Returns [{ file, before, after }] for every file whose content changes.
function computeChanges() {
    const facts = docFacts();
    const changes = [];
    for (const file of markdownFiles()) {
        const before = fs.readFileSync(file, "utf8");
        const after = renderMarkdown(before, facts, path.relative(ROOT, file));
        if (after !== before) changes.push({ file, before, after });
    }
    const pkg = path.join(ROOT, "package.json");
    const pkgBefore = fs.readFileSync(pkg, "utf8");
    const pkgAfter = renderPackageJson(pkgBefore);
    if (pkgAfter !== pkgBefore) changes.push({ file: pkg, before: pkgBefore, after: pkgAfter });
    return changes;
}

function main(argv) {
    const check = argv.includes("--check");
    const changes = computeChanges();
    const rel = (f) => path.relative(ROOT, f);
    if (check) {
        if (changes.length) {
            console.error(`Generated doc regions are stale in: ${changes.map((c) => rel(c.file)).join(", ")}`);
            console.error("Run `npm run docs:sync` and commit the result.");
            process.exit(1);
        }
        console.log("docs are in sync with the emitter registry");
        return;
    }
    for (const c of changes) fs.writeFileSync(c.file, c.after);
    console.log(changes.length ? `updated: ${changes.map((c) => rel(c.file)).join(", ")}` : "docs already in sync");
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { computeChanges, renderMarkdown, renderPackageJson, markdownFiles };
