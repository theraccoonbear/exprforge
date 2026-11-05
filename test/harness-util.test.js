"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { tmpDir, removeTmpDir, withFileLock } = require("./harness-util.js");

const UTIL = path.join(__dirname, "harness-util.js");

test("tmpDir: returns distinct fresh directories", () => {
    const a = tmpDir("ef-util-");
    const b = tmpDir("ef-util-");
    assert.notStrictEqual(a, b);
    assert.ok(fs.statSync(a).isDirectory());
    assert.ok(a.startsWith(os.tmpdir()));
    removeTmpDir(a);
    removeTmpDir(b);
    assert.ok(!fs.existsSync(a));
});

function leakedDirFromChild(env) {
    const script = `const { tmpDir } = require(${JSON.stringify(UTIL)}); process.stdout.write(tmpDir("ef-leak-"));`;
    const res = spawnSync(process.execPath, ["-e", script], {
        env: { ...process.env, EXPRFORGE_KEEP_TMP: "", ...env },
        encoding: "utf8",
    });
    return { dir: res.stdout.trim(), stderr: res.stderr };
}

test("tmpDir: directories left behind are removed at process exit", () => {
    const { dir } = leakedDirFromChild({});
    assert.ok(dir.length > 0);
    assert.ok(!fs.existsSync(dir));
});

test("tmpDir: EXPRFORGE_KEEP_TMP=1 keeps leftover directories", () => {
    const { dir, stderr } = leakedDirFromChild({ EXPRFORGE_KEEP_TMP: "1" });
    try {
        assert.ok(fs.existsSync(dir));
        assert.match(stderr, /EXPRFORGE_KEEP_TMP: kept/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("withFileLock: concurrent processes never overlap in the critical section", async () => {
    const dir = tmpDir("ef-lock-");
    const lock = path.join(dir, "x.lock");
    const log = path.join(dir, "log");
    const script = `
        const fs = require("node:fs");
        const { withFileLock } = require(${JSON.stringify(UTIL)});
        for (let i = 0; i < 5; i++) {
            withFileLock(${JSON.stringify(lock)}, () => {
                fs.appendFileSync(${JSON.stringify(log)}, "in\\n");
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
                fs.appendFileSync(${JSON.stringify(log)}, "out\\n");
            });
        }`;
    const procs = Array.from({ length: 4 }, () =>
        new Promise((resolve, reject) => {
            const p = spawn(process.execPath, ["-e", script], { stdio: "inherit" });
            p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`child exited ${code}`))));
        }),
    );
    await Promise.all(procs);
    const lines = fs.readFileSync(log, "utf8").trim().split("\n");
    assert.strictEqual(lines.length, 40);
    lines.forEach((l, i) => assert.strictEqual(l, i % 2 === 0 ? "in" : "out"));
    assert.ok(!fs.existsSync(lock));
    removeTmpDir(dir);
});

test("withFileLock: a lock left by a dead process is taken over", () => {
    const dir = tmpDir("ef-lock-");
    const lock = path.join(dir, "stale.lock");
    const dead = spawnSync(process.execPath, ["-e", ""]);
    assert.strictEqual(dead.status, 0);
    // The child's pid is gone by now; pids are not reused immediately.
    fs.writeFileSync(lock, String(dead.pid));
    let ran = false;
    withFileLock(lock, () => {
        ran = true;
        assert.strictEqual(fs.readFileSync(lock, "utf8"), String(process.pid));
    });
    assert.ok(ran);
    assert.ok(!fs.existsSync(lock));
    removeTmpDir(dir);
});

test("withFileLock: releases the lock when the callback throws", () => {
    const dir = tmpDir("ef-lock-");
    const lock = path.join(dir, "throw.lock");
    assert.throws(() => withFileLock(lock, () => { throw new Error("boom"); }), /boom/);
    assert.ok(!fs.existsSync(lock));
    removeTmpDir(dir);
});
