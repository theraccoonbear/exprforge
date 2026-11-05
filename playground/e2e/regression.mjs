// exprforge/playground/e2e/regression.mjs
//
// A real headless-browser check against the actual BUILT playground
// (playground/dist -- run `npm run build` first), not a unit test of
// isolated logic. Exists specifically because a real incident proved a
// unit test / typecheck alone wouldn't have caught it: a breaking
// grammar change (loadExprSource's "fn"/"macro" export marking, see the
// root README) shipped with green typechecks and a correctly-updated
// bundled example -- but every returning visitor's browser still held
// OLD, now-unparseable content in localStorage (or a shared ?src= link),
// and PlaygroundTool.tsx trusted that content unconditionally. The
// result: a raw, confusing parse error on load, for text nobody typed
// this session, on the live production site. See PlaygroundTool.tsx's
// own `sourceParses`/`initialSource` comments for the actual fix this
// verifies.
//
// Also covers a second real incident of the same shape: DifferentiatorTool's
// "Copy link" wrote a ?src=/?var= URL that nothing ever read back, and
// App.tsx had no way to land on any tab but Playground -- so every
// differentiator share link silently opened Playground instead. See the
// "Share-link tab activation" checks below.
//
// Wired into CI (.github/workflows/deploy-pages.yml and
// deploy-pr-preview.yml) as a hard gate BEFORE deploy -- a regression here
// must never reach the live site again, not just be caught eventually by
// someone noticing.
//
// Requires: `npm run build` already run (this serves playground/dist
// as-is), and `playwright`'s chromium browser available (see
// package.json's own postinstall / CI's explicit `playwright install`
// step -- this script does not install it itself).
import assert from "node:assert";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const PORT = 4310;

// playground/dist's own index.html references /exprforge/assets/... --
// the real production base path (see vite.config.ts's `base`). Serving
// it plain, with that prefix stripped, reproduces the exact same app
// bundle without needing to fight vite's own preview-server base-path
// handling just to serve a directory locally for this one script.
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };

function startServer() {
    const server = createServer(async (req, res) => {
        let reqPath = req.url.split("?")[0].replace(/^\/exprforge\//, "/");
        if (reqPath === "/") reqPath = "/index.html";
        const filePath = path.join(DIST, reqPath);
        try {
            let body = await readFile(filePath, reqPath.endsWith(".html") ? "utf8" : null);
            if (reqPath.endsWith(".html")) body = body.replaceAll("/exprforge/assets/", "/assets/");
            res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
            res.end(body);
        } catch {
            res.writeHead(404);
            res.end("not found");
        }
    });
    return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const STALE_CROSS_LENGTH = `# TWO definitions in one buffer -- crossLength references cross3
# by name below. That reference is inline-expanded at parse time,
# never a real function call in any emitted target -- see the
# README's "Macros and externs" section. Pick which one to run in
# the tabs above the "Try it" panel below.
cross3(ax, ay, az, bx, by, bz):
  let rx = ay * bz - az * by;
  let ry = az * bx - ax * bz;
  let rz = ax * by - ay * bx;
  return { rx, ry, rz };

crossLength(ax, ay, az, bx, by, bz):
  let c = cross3(ax, ay, az, bx, by, bz);
  return sqrt(c.rx^2 + c.ry^2 + c.rz^2);
`;

async function currentError(page) {
    const el = await page.$(".playground-error");
    return el ? await el.textContent() : null;
}

async function main() {
    const server = await startServer();
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    try {
        // --- The actual incident: stale/incompatible saved content ------
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector(".cm-content", { timeout: 15000 });
        await page.evaluate((src) => localStorage.setItem("exprforge-playground:source", src), STALE_CROSS_LENGTH);
        await page.reload();
        await page.waitForSelector(".cm-content", { timeout: 15000 });
        await page.waitForTimeout(300);
        assert.strictEqual(
            await currentError(page),
            null,
            "stale/incompatible localStorage content must fall back to the default example, not surface a raw parse error",
        );

        // --- Every bundled example must load with zero errors -----------
        // Not just the one that broke -- any future grammar change could
        // just as easily break a DIFFERENT example; this closes the whole
        // class, not one instance of it.
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.waitForSelector(".playground-examples select", { timeout: 15000 });
        const exampleIds = await page.$$eval(".playground-examples select option[value]:not([value=''])", (opts) =>
            opts.map((o) => o.value),
        );
        assert.ok(exampleIds.length > 0, "expected at least one bundled example to check");
        for (const id of exampleIds) {
            await page.selectOption(".playground-examples select", id);
            await page.waitForTimeout(400);
            const err = await currentError(page);
            assert.strictEqual(err, null, `bundled example "${id}" must load with no error, got: ${err}`);
        }

        // --- The fix must not swallow REAL errors ------------------------
        // A genuine mistake while actively typing must still surface --
        // this guards against "fixing" the incident above by suppressing
        // every parse error unconditionally instead of only stale-load ones.
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.waitForSelector(".cm-content", { timeout: 15000 });
        await page.click(".cm-content");
        await page.keyboard.press("Control+A");
        await page.keyboard.type("totally not valid syntax (((");
        await page.waitForTimeout(400);
        assert.ok(await currentError(page), "a genuine live-typed syntax error must still surface inline");

        // --- Share-link tab activation ------------------------------------
        // The actual bug this check exists for: DifferentiatorTool's
        // copyLink() used to write ?src=/?var= that nothing ever read back,
        // and App.tsx had no way to land on any tab but Playground
        // regardless of what a copied link pointed at -- so opening a
        // differentiator link silently showed Playground instead, with the
        // differentiator's ?src= sometimes misinterpreted as Playground
        // source (see PlaygroundTool's own ?src= handling).
        await page.evaluate(() => localStorage.clear());
        const DIFF_LINK_SOURCE = "f(x): x^2 + 3*x";
        await page.goto(`http://localhost:${PORT}/?tool=differentiator&src=${encodeURIComponent(DIFF_LINK_SOURCE)}&var=x`);
        await page.waitForSelector(".diff-editor-pane", { timeout: 15000 });
        assert.strictEqual(
            await page.$eval(".shell-nav-item--active", (el) => el.textContent),
            "Differentiation",
            "a differentiator share link must activate the Differentiation tab, not default to Playground",
        );
        assert.ok(
            (await page.$eval(".diff-editor-pane .cm-content", (el) => el.textContent)).includes("x^2"),
            "differentiator share link must restore its ?src= into the editor",
        );

        // A playground share link (the pre-existing, already-working case)
        // must still land on Playground now that ?tool= exists too.
        await page.evaluate(() => localStorage.clear());
        await page.goto(`http://localhost:${PORT}/?tool=playground&src=${encodeURIComponent(DIFF_LINK_SOURCE)}`);
        await page.waitForSelector(".cm-content", { timeout: 15000 });
        assert.strictEqual(
            await page.$eval(".shell-nav-item--active", (el) => el.textContent),
            "Playground",
            "a playground share link must activate the Playground tab",
        );

        // --- Range analysis tab ---------------------------------------------
        // A share link must activate the tab, restore source and ranges, and
        // the analysis must flag the unguarded division, then react to an
        // edited range.
        await page.evaluate(() => localStorage.clear());
        const RANGE_SRC = "f(x, d):\n  return x / d;\n";
        await page.goto(
            `http://localhost:${PORT}/?tool=ranges&src=${encodeURIComponent(RANGE_SRC)}&ranges=${encodeURIComponent(JSON.stringify({ x: "1, 2", d: "-1, 1" }))}`,
        );
        await page.waitForSelector(".ranges-result .ranges-body", { timeout: 15000 });
        assert.strictEqual(
            await page.$eval(".shell-nav-item--active", (el) => el.textContent),
            "Range analysis",
            "a ranges share link must activate the Range analysis tab",
        );
        assert.ok(
            (await page.$eval(".ranges-result", (el) => el.textContent)).includes("div-by-zero"),
            "an unguarded division over a zero-spanning range must be flagged",
        );
        await page.fill('.ranges-input[data-param="d"]', "2, 4");
        await page.waitForTimeout(300);
        const rangesText = await page.$eval(".ranges-result", (el) => el.textContent);
        assert.ok(!rangesText.includes("div-by-zero"), "a nonzero denominator range must clear the warning");
        assert.ok(rangesText.includes("[0.25, 1]"), `expected output range [0.25, 1], got: ${rangesText}`);

        // --- LaTeX card: KaTeX preview and third-party links ---------------
        // Off by default, so enable it via its toggle chip. The links must
        // be plain anchors (never auto-loaded) with the expected prefixes,
        // and a formula too long for a practical URL must degrade to a
        // disabled note rather than a link.
        await page.evaluate(() => localStorage.clear());
        await page.goto(`http://localhost:${PORT}/?tool=playground&src=${encodeURIComponent("f(x): return x^2 + 1/x;")}`);
        await page.waitForSelector(".cm-content", { timeout: 15000 });
        await page.click(".toggle-chip:text-is('LaTeX')");
        await page.waitForSelector(".latex-preview .katex", { timeout: 15000 });
        const links = await page.$$eval(".latex-links a", (as) =>
            as.map((a) => ({ text: a.textContent, href: a.href, target: a.target, rel: a.rel, title: a.title })),
        );
        assert.strictEqual(links.length, 2, "expected CodeCogs and Overleaf links");
        assert.ok(
            (await page.$eval(".latex-preview", (el) => el.textContent)).includes("f"),
            "preview must render the formula",
        );
        assert.ok(
            decodeURIComponent(links[0].href.split("?")[1]).startsWith("f\\left(x\\right) = x^{2}"),
            "the LaTeX card must reflect the typed ?src= formula, not the default example",
        );
        const [cogs, overleaf] = links;
        assert.ok(cogs.href.startsWith("https://latex.codecogs.com/svg.image?"), `CodeCogs href: ${cogs.href}`);
        assert.ok(overleaf.href.startsWith("https://www.overleaf.com/docs?snip="), `Overleaf href: ${overleaf.href}`);
        assert.ok(
            decodeURIComponent(overleaf.href.split("snip=")[1]).startsWith("\\documentclass{article}"),
            "Overleaf link must carry the wrap: document source",
        );
        assert.ok(
            !decodeURIComponent(cogs.href.split("?")[1]).includes("\\documentclass"),
            "CodeCogs link must carry the bare source",
        );
        for (const l of links) {
            assert.strictEqual(l.target, "_blank");
            assert.ok(l.rel.includes("noopener") && l.rel.includes("noreferrer"), `rel: ${l.rel}`);
            assert.ok(/third-party/.test(l.title), `title must note the third-party send: ${l.title}`);
        }
        const longSource = `f(x): return ${Array.from({ length: 900 }, () => "x").join(" + ")};`;
        await page.evaluate((src) => localStorage.setItem("exprforge-playground:source", src), longSource);
        await page.goto(`http://localhost:${PORT}/?tool=playground`);
        await page.waitForSelector(".cm-content", { timeout: 15000 });
        if (!(await page.$(".toggle-chip--active:text-is('LaTeX')"))) await page.click(".toggle-chip:text-is('LaTeX')");
        await page.waitForSelector(".latex-links", { timeout: 15000 });
        assert.strictEqual(await page.$$eval(".latex-links a", (as) => as.length), 0, "over-long formulas must not render link anchors");
        assert.strictEqual(await page.$$eval(".latex-link--disabled", (e) => e.length), 2, "both links must render disabled for an over-long formula");

        assert.strictEqual(pageErrors.length, 0, `unexpected uncaught page error(s): ${pageErrors.join("; ")}`);

        console.log(`playground e2e regression: all checks passed (${exampleIds.length} examples + stale-content + live-error + share-link-tab + LaTeX preview/link checks)`);
    } finally {
        await browser.close();
        server.close();
    }
}

main().catch((err) => {
    console.error("playground e2e regression FAILED:", err.message);
    process.exit(1);
});
