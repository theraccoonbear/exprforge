const test = require("node:test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { divisionByZeroAst } = require("../index.js");
const emitters = require("../emitters/registry.js");

test("qb64 division probe", () => {
    try {
        execFileSync("qb64pe", ["-v"], { stdio: "ignore" });
    } catch {
        return;
    }
    const names = Object.keys(divisionByZeroAst.body.fields);
    const source = emitters.qb64.emitFunction(divisionByZeroAst);
    const harness =
        `$CONSOLE:ONLY\n${source}\nDIM x AS DOUBLE : x = VAL(COMMAND$(1))\nDIM zeroSrc AS DOUBLE : zeroSrc = VAL(COMMAND$(2))\n` +
        `DIM ${names.join(" AS DOUBLE, ")} AS DOUBLE\n` +
        `CALL divisionByZero(x, zeroSrc, ${names.join(", ")})\n` +
        names.map((n) => `PRINT ${n}`).join("\n") +
        `\nSYSTEM\n`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-probe-"));
    const f = path.join(dir, "main.bas");
    fs.writeFileSync(f, harness);
    const bin = path.join(dir, "bin");
    execFileSync("qb64pe", ["-x", f, "-o", bin]);
    const out = execFileSync(bin, ["5", "0"], { timeout: 20000 }).toString();
    console.log("QB64PROBE " + JSON.stringify(out));
});
