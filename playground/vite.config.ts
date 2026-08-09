import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// GH Pages serves this as a PROJECT site (the repo isn't named
// "theraccoonbear.github.io"), so every asset URL in the built output
// needs the "/exprforge/" prefix or they 404 once deployed -- a classic,
// silent GH Pages mistake if this base only gets tested by running the
// dev server, which serves from "/" regardless. Only applied for the
// production build; local `npm run dev` stays at "/" so it's not
// annoying to develop against.

// The one true source of "exprforge": "file:.." (see package.json) --
// used both to tell chokidar what to watch (below) and, separately, in
// preserveSymlinks reasoning: Vite/Rollup by default follow the
// node_modules/exprforge symlink through to this exact path.
const EXPRFORGE_ROOT = path.resolve(__dirname, "..");

// Forces a full dev-server restart -- with a FORCED re-optimization,
// not a plain one -- whenever a file inside the linked exprforge
// package changes. Confirmed necessary the hard way, across three
// failed attempts before this one:
//   1. Doing nothing: Vite's esbuild-based dependency pre-bundler
//      caches exprforge's CJS->ESM conversion once and only invalidates
//      that cache when exprforge's own package.json/lockfile changes --
//      never on edits to its source files. `npm run dev`, edit
//      emitters/exprsyntax.js, reload -- stale output, silently.
//   2. optimizeDeps.exclude + server.watch.ignored: excluding it from
//      pre-bundling skips the CJS->ESM conversion entirely (exprforge
//      IS plain CommonJS), so the browser hit a raw `require()` call
//      and threw "require is not defined" -- worse than the original
//      bug, caught by an actual page load, not assumed.
//   3. optimizeDeps.include + server.watch.ignored alone: keeps the
//      conversion working, and un-ignoring the linked package's path
//      does make chokidar emit real fs events for it -- but Vite's
//      *dependency optimizer cache* isn't wired to invalidate on
//      generic watched-file-change events the way HMR for the app's own
//      src/ is; only a small, closed set of triggers (package.json/
//      lockfile hash, --force) re-run it. Confirmed by an actual live
//      edit-while-running test: no restart, no fresh output.
//   4. server.restart() with no argument: this DOES restart the dev
//      server process (a real "[vite] server restarted" log line), but
//      still served stale output -- because restart()'s own cache-
//      validity check is the SAME package.json/lockfile hash from
//      attempt 3, which a linked-file edit never touches, so it just
//      reused the still-"valid" on-disk node_modules/.vite/deps cache.
//      Confirmed by directly inspecting the served output right after
//      the restart log appeared: old margins, not the edited ones.
// server.restart(true) is the actual fix -- Vite's own API for
// unconditionally forcing re-optimization regardless of the hash check
// (the programmatic equivalent of the --force CLI flag / manually
// deleting node_modules/.vite). This is the real, commonly-used pattern
// for exactly this "linked local package" scenario (same shape as the
// small community plugins that exist for it). Verified end-to-end
// against a real running server, for real this time: edited
// emitters/cobol.js's indentation while already running, with NO manual
// restart or --force, confirmed stale output first with attempt #4's
// plain restart(), then confirmed the fix by checking served output
// again after switching to restart(true) -- the new margins appeared.
function watchLinkedExprforge(): Plugin {
    return {
        name: "watch-linked-exprforge",
        configureServer(server) {
            server.watcher.add(EXPRFORGE_ROOT);
            server.watcher.on("change", (file) => {
                if (
                    file.startsWith(EXPRFORGE_ROOT) &&
                    !file.includes(`${path.sep}playground${path.sep}`) &&
                    !file.includes(`${path.sep}node_modules${path.sep}`)
                ) {
                    server.restart(true);
                }
            });
        },
    };
}

export default defineConfig(({ command }) => ({
    base: command === "build" ? "/exprforge/" : "/",
    plugins: [react(), watchLinkedExprforge()],
    // "exprforge": "file:.." resolves to a symlink in node_modules -- by
    // default Vite/Rollup follow that symlink through to its real path
    // (outside node_modules entirely), which puts it outside the
    // commonjs plugin's default include patterns. The result, confirmed
    // against a real build: index.js itself gets processed, but its OWN
    // internal require()s to sibling files (ast.js, expr.js,
    // emitters/*.js, ...) survive untouched as literal runtime
    // `require(...)` calls -- which then throw "ReferenceError: require
    // is not defined" the moment the bundle actually runs in a browser,
    // since nothing catches that at build time. preserveSymlinks makes
    // Vite treat the package at its node_modules/exprforge path instead
    // of resolving through the symlink, so it's processed like any
    // normally-installed dependency.
    resolve: {
        preserveSymlinks: true,
    },
    optimizeDeps: {
        include: ["exprforge"],
    },
}));
