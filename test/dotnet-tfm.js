// exprforge/test/dotnet-tfm.js
//
// Target-framework detection shared by every test that writes a csproj.
// EXPRFORGE_DOTNET_TFM (e.g. "net8.0") overrides; otherwise the highest
// installed SDK major from `dotnet --list-sdks` is used, so the harness
// builds on whatever SDK the host has instead of a hard-coded version.
// The newest SDK's own runtime is always installed alongside it, so the
// built dll launches under `dotnet <dll>`.

const { execFileSync } = require("node:child_process");

function detectDotnetTfm() {
    const override = process.env.EXPRFORGE_DOTNET_TFM;
    if (override) return override;
    let out = "";
    try {
        out = execFileSync("dotnet", ["--list-sdks"], { encoding: "utf8" });
    } catch {
        return null;
    }
    const majors = out
        .split("\n")
        .map((l) => /^(\d+)\./.exec(l.trim()))
        .filter(Boolean)
        .map((m) => Number(m[1]));
    if (majors.length === 0) return null;
    return `net${Math.max(...majors)}.0`;
}

const DOTNET_TFM = detectDotnetTfm();

module.exports = { DOTNET_TFM, detectDotnetTfm };
