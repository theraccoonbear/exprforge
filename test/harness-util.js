"use strict";

// Shared helpers for the compile-and-run conformance harnesses, so that
// several `npm test` invocations (and the several test files inside one
// invocation, which node --test runs as parallel processes) can run at
// the same time on one machine without interfering.
//
// - tmpDir(): every scratch directory is a fresh fs.mkdtemp directory under
//   os.tmpdir(); anything still present at process exit is removed unless
//   EXPRFORGE_KEEP_TMP=1 is set (then leftovers, i.e. the directories of
//   failed cases, are kept and listed on stderr).
// - hasQb64() / compileQb64(): QB64-PE compiles inside its own install
//   directory (internal/temp, internal/c, ...), which is shared by every
//   compile of that install. Detection is a PATH lookup that executes
//   nothing, and the compile step is serialised by a cross-process lock.
// - withFileLock(): the lock primitive (O_EXCL lock file, retry with
//   backoff, stale-holder detection).

const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const KEEP_TMP = process.env.EXPRFORGE_KEEP_TMP === "1";

// --- Temp directories -------------------------------------------------------

const liveDirs = new Set();
let exitHooked = false;

function cleanupTmpDirs() {
    for (const dir of liveDirs) {
        if (!fs.existsSync(dir)) continue;
        if (KEEP_TMP) {
            process.stderr.write(`EXPRFORGE_KEEP_TMP: kept ${dir}\n`);
        } else {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    liveDirs.clear();
}

function hookExit() {
    if (exitHooked) return;
    exitHooked = true;
    process.on("exit", cleanupTmpDirs);
    for (const sig of ["SIGINT", "SIGTERM"]) {
        process.on(sig, () => {
            cleanupTmpDirs();
            process.exit(128 + (sig === "SIGINT" ? 2 : 15));
        });
    }
}

function tmpDir(prefix) {
    hookExit();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    liveDirs.add(dir);
    return dir;
}

// Callers that already remove their directory on success can keep doing so.
function removeTmpDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    liveDirs.delete(dir);
}

// --- Cross-process lock -----------------------------------------------------

const LOCK_STALE_AGE_MS = 5 * 60 * 1000;
const LOCK_MAX_WAIT_MS = 15 * 60 * 1000;

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e.code === "EPERM";
    }
}

function readLockPid(lockPath) {
    try {
        return Number.parseInt(fs.readFileSync(lockPath, "utf8"), 10);
    } catch {
        return null;
    }
}

// A holder that is gone is stale; so is a lock older than any real compile.
// An empty/garbled file means the holder is between create and write (or
// died there), so it gets a short grace period. A lock that disappears
// while being examined was released, not stale.
function lockIsStale(lockPath) {
    let st;
    try {
        st = fs.statSync(lockPath);
    } catch {
        return false;
    }
    const age = Date.now() - st.mtimeMs;
    const pid = readLockPid(lockPath);
    if (!Number.isInteger(pid)) return age > 2000;
    return !pidAlive(pid) || age > LOCK_STALE_AGE_MS;
}

// Removing a stale lock must not delete a fresh lock that another process
// created after the staleness check. Breakers are serialised by a second
// exclusive-create file, and staleness is re-checked while holding it:
// acquirers only create the lock when it is absent and a live holder only
// removes its own, so under the breaker lock the file judged stale cannot be
// replaced before it is removed. A breaker that cannot get the breaker lock
// simply keeps waiting; a breaker lock abandoned by a crash is discarded
// after a short while.
function breakStaleLock(lockPath) {
    const breaker = `${lockPath}.breaker`;
    let fd;
    try {
        fd = fs.openSync(breaker, "wx");
    } catch (e) {
        if (e.code === "EEXIST") {
            sleepSync(5);
            try {
                if (Date.now() - fs.statSync(breaker).mtimeMs > 30000) fs.rmSync(breaker, { force: true });
            } catch {
                // already gone
            }
        }
        return;
    }
    try {
        fs.closeSync(fd);
        if (lockIsStale(lockPath)) fs.rmSync(lockPath, { force: true });
    } finally {
        fs.rmSync(breaker, { force: true });
    }
}

function acquireLock(lockPath) {
    const start = Date.now();
    let delay = 10;
    for (;;) {
        try {
            const fd = fs.openSync(lockPath, "wx");
            fs.writeSync(fd, String(process.pid));
            fs.closeSync(fd);
            return;
        } catch (e) {
            if (e.code !== "EEXIST") throw e;
        }
        if (lockIsStale(lockPath)) {
            breakStaleLock(lockPath);
            continue;
        }
        if (Date.now() - start > LOCK_MAX_WAIT_MS) {
            throw new Error(`timed out waiting for lock ${lockPath}`);
        }
        sleepSync(delay + Math.floor(Math.random() * delay));
        delay = Math.min(delay * 2, 250);
    }
}

function releaseLock(lockPath) {
    if (readLockPid(lockPath) === process.pid) fs.rmSync(lockPath, { force: true });
}

function withFileLock(lockPath, fn) {
    acquireLock(lockPath);
    try {
        return fn();
    } finally {
        releaseLock(lockPath);
    }
}

// --- QB64-PE ----------------------------------------------------------------

let qb64Cache;

// Locates qb64pe on PATH without executing it (an invocation is itself a
// compiler run that touches the shared install, and its exit status was an
// unreliable presence signal).
function findQb64() {
    if (qb64Cache !== undefined) return qb64Cache;
    qb64Cache = null;
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
        if (!dir) continue;
        const candidate = path.join(dir, "qb64pe");
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            if (!fs.statSync(candidate).isFile()) continue;
            qb64Cache = { bin: candidate, real: fs.realpathSync(candidate) };
            break;
        } catch {
            // not here
        }
    }
    return qb64Cache;
}

function hasQb64() {
    return findQb64() !== null;
}

function qb64LockPath() {
    const real = findQb64().real;
    const key = crypto.createHash("sha1").update(real).digest("hex").slice(0, 12);
    return path.join(os.tmpdir(), `exprforge-qb64pe-${key}.lock`);
}

// qb64pe reports compile errors on stdout (mixed with progress bars) and
// leaves the C++ compiler's output in the install's own compilelog.txt.
function qb64Diagnostics(e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`
        .split("\n")
        .filter((l) => !/^\[\.*\s*\]/.test(l))
        .join("\n");
    let log = "";
    try {
        const file = path.join(path.dirname(findQb64().real), "internal", "temp", "compilelog.txt");
        log = `\n--- ${file} (tail) ---\n${fs.readFileSync(file, "utf8").split("\n").slice(-40).join("\n")}`;
    } catch {
        // no log available
    }
    return `${e.message.split("\n")[0]}\n${out}${log}`;
}

// qb64pe works inside <install>/internal/temp* and shares that tree between
// every compile, so concurrent compiles corrupt each other (wrong or empty
// binaries, spurious C++ errors). Only the compile is serialised; running
// the produced binaries stays parallel.
function compileQb64(srcPath, outPath) {
    return withFileLock(qb64LockPath(), () => {
        try {
            return execFileSync("qb64pe", ["-x", srcPath, "-o", outPath], { stdio: ["ignore", "pipe", "pipe"] });
        } catch (e) {
            throw new Error(qb64Diagnostics(e));
        }
    });
}

// --- Bounded, headless QB64 binary execution ---------------------------------
//
// A QB64 runtime error (e.g. #9 "Subscript out of range") in a compiled
// binary either opens a blocking tinyfiledialogs dialog when a display is
// reachable, or loops printing "Continue? y/n:" when it is not. Either one
// hangs the test run, and the binary is orphaned if the parent dies. So
// binaries run with no display variables, no stdin, a hard timeout and an
// output cap; and the test drivers install QB64_ERROR_HANDLER so a runtime
// error exits immediately with a message instead.

const QB64_RUN_TIMEOUT_MS = 20000;

const QB64_ERROR_PROLOGUE = "ON ERROR GOTO ef_err\n";
const QB64_ERROR_HANDLER =
    "ef_err:\n" +
    'PRINT "EF_RUNTIME_ERROR " + LTRIM$(STR$(ERR)) + " line " + LTRIM$(STR$(_ERRORLINE))\n' +
    "SYSTEM 1\n";

function headlessEnv() {
    const env = { ...process.env };
    for (const k of ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY"]) delete env[k];
    return env;
}

function runQb64(binPath, args = []) {
    try {
        return execFileSync(binPath, args, {
            timeout: QB64_RUN_TIMEOUT_MS,
            killSignal: "SIGKILL",
            maxBuffer: 1 << 20,
            stdio: ["ignore", "pipe", "pipe"],
            env: headlessEnv(),
        });
    } catch (e) {
        const out = Buffer.concat([e.stdout, e.stderr].map((b) => (b ? Buffer.from(b) : Buffer.alloc(0))))
            .subarray(0, 300)
            .toString("utf8");
        let why = `exited with status ${e.status}`;
        if (e.code === "ETIMEDOUT") why = `timed out after ${QB64_RUN_TIMEOUT_MS}ms`;
        else if (e.code === "ENOBUFS") why = "exceeded the output limit";
        else if (e.signal) why = `was killed by ${e.signal}`;
        throw new Error(`QB64 binary ${binPath} ${why}; output: ${JSON.stringify(out)}`);
    }
}

module.exports = {
    runQb64,
    QB64_ERROR_PROLOGUE,
    QB64_ERROR_HANDLER,
    KEEP_TMP,
    tmpDir,
    removeTmpDir,
    withFileLock,
    hasQb64,
    compileQb64,
};
