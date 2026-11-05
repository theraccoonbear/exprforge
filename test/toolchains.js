// exprforge/test/toolchains.js
//
// Shared toolchain detection for the tests that compile or interpret
// emitted code. Which commands a target needs is declared once, next to
// the emitter, as meta.toolchain.probes (see emitters/meta.js); this file
// only probes PATH. A target counts as available when every one of its
// probes finds a working candidate command.
//
//   TOOLS[lang]   true/false for a target with probes (undefined for a
//                 target that needs none, like JS, LaTeX and expr)
//   bin(lang, i)  the resolved command of probe i (default 0), for the
//                 harnesses that must call the same binary the probe found
//                 (Guile and Lua binary names vary across distros)
//   hasTool       the raw probe, for one-off checks
//
// Toolchains are never project dependencies: they are looked up on PATH
// and the tests that need one skip when it is absent.
const { execFileSync } = require("node:child_process");
const { targets } = require("../emitters/meta.js");

function hasTool(cmd, args) {
    try {
        execFileSync(cmd, args, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

function resolveTool(candidates, args) {
    for (const cmd of candidates) {
        if (hasTool(cmd, args)) return cmd;
    }
    return null;
}

const bins = {};
const available = {};
for (const { lang, meta } of targets()) {
    const probes = meta.toolchain && meta.toolchain.probes;
    if (!probes) continue;
    bins[lang] = probes.map((p) => resolveTool(p.candidates, p.args));
    available[lang] = bins[lang].every((b) => b !== null);
}

// Records which targets a test file actually asked about, so a file can
// assert it has coverage for every toolchain-backed target.
const queried = new Set();
const TOOLS = new Proxy(available, {
    get(target, prop) {
        if (typeof prop === "string") queried.add(prop);
        return target[prop];
    },
});

function bin(lang, i = 0) {
    return bins[lang][i];
}

module.exports = { TOOLS, bin, hasTool, resolveTool, queried };
