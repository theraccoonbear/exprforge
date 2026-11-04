const test = require("node:test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("qb64 division probe", () => {
    try {
        execFileSync("qb64pe", ["-v"], { stdio: "ignore" });
    } catch {
        return;
    }
    const src = [
        "$CONSOLE:ONLY",
        "ON ERROR GOTO h",
        "DIM a AS DOUBLE, z AS DOUBLE, nz AS DOUBLE, r AS DOUBLE",
        "a = VAL(COMMAND$(1)): z = VAL(COMMAND$(2)): nz = z * -.5#",
        "r = a / z: PRINT \"a/z=\"; r",
        "r = a / nz: PRINT \"a/nz=\"; r",
        "r = z / z: PRINT \"z/z=\"; r",
        "r = -a / z: PRINT \"-a/z=\"; r",
        "PRINT \"str nz=\"; STR$(nz)",
        "SYSTEM",
        "h:",
        "PRINT \"ERR\"; ERR",
        "SYSTEM",
    ].join("\n");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-probe-"));
    const f = path.join(dir, "main.bas");
    fs.writeFileSync(f, src);
    const bin = path.join(dir, "bin");
    execFileSync("qb64pe", ["-x", f, "-o", bin]);
    const out = execFileSync(bin, ["5", "0"], { timeout: 20000 }).toString();
    console.log("QB64PROBE " + execFileSync("qb64pe", ["-v"]).toString().trim() + "\n" + out);
    try {
        const c = fs.readdirSync(path.join(path.dirname(execFileSync("which", ["qb64pe"]).toString().trim())));
        console.log("QB64PROBE dir " + c.slice(0, 5).join(","));
    } catch {}
});
