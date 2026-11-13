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
// - runQb64(): runs a compiled QB64 test binary headless and bounded: an
//   allowlisted environment with no route to the desktop, its own process
//   group killed as a whole, a timeout, an output cap, and failure on any
//   "Runtime error" line (details at its definition below).

const { execFileSync, spawnSync } = require("node:child_process");
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
//
// Every QB64 source the suite builds (emitted code plus harness) passes
// through here, so this is also where `ON ERROR GOTO 0` is refused: it
// switches QB64_ERROR_HANDLER off and restores QB64-PE's interactive
// error prompt (see runQb64 below).
const QB64_PROMPT_RESET = /\bON\s+ERROR\s+GOTO\s+0\b/i;

function compileQb64(srcPath, outPath) {
    if (QB64_PROMPT_RESET.test(fs.readFileSync(srcPath, "utf8"))) {
        throw new Error(`${srcPath} contains ON ERROR GOTO 0, which restores QB64-PE's interactive error prompt; return to the program's handler (ON ERROR GOTO ef_err) instead`);
    }
    return withFileLock(qb64LockPath(), () => {
        try {
            return execFileSync("qb64pe", ["-x", srcPath, "-o", outPath], { stdio: ["ignore", "pipe", "pipe"], env: compileEnv() });
        } catch (e) {
            throw new Error(qb64Diagnostics(e));
        }
    });
}

// --- Bounded, headless QB64 binary execution ---------------------------------
//
// QB64-PE has no switch to turn off its unhandled-runtime-error prompt (e.g.
// #9 "Subscript out of range"). Through tinyfiledialogs it opens a dialog
// when a display is reachable and, when stdout is not a terminal, starts a
// terminal emulator (xterm, konsole, ...) through `sh -c` to ask
// "Continue?". That terminal reaches the desktop through any of DISPLAY,
// WAYLAND_DISPLAY, XDG_RUNTIME_DIR (the default Wayland socket) or the
// session bus, survives a SIGKILL sent to the binary alone, and waits for
// a keypress. Once the prompt returns, the binary exits 0. So:
//
// - Test programs install QB64_ERROR_PROLOGUE / QB64_ERROR_HANDLER, a
//   program-level fail-fast handler: a handleable error prints
//   "Runtime error <n>: <message> (line <n>)" to stderr and exits 1.
//   A test program must never contain `ON ERROR GOTO 0`, which restores
//   the prompt.
// - runQb64() runs the binary with an allowlisted environment that has no
//   route to a desktop session, stdin ignored, a 20 s timeout, an output
//   cap, the binary's directory as working directory, and in its own
//   process group, which is SIGKILLed as a whole on timeout, on exceeding
//   the cap and after the binary exits (see qb64-group-run.js).
// - runQb64() fails a run whose output has a line starting with
//   "Runtime error" even when it exits 0: QB64-PE exits 0 after its own
//   error report (an unhandled error, or a critical one no handler sees).

const QB64_RUN_TIMEOUT_MS = 20000;
const QB64_OUTPUT_CAP = 1 << 20;
const QB64_GROUP_RUNNER = path.join(__dirname, "qb64-group-run.js");

const QB64_ERROR_PROLOGUE = "ON ERROR GOTO ef_err\n";
const QB64_ERROR_HANDLER =
    "ef_err:\n" +
    'ef_err_msg$ = "Runtime error " + LTRIM$(STR$(ERR)) + ": " + _ERRORMESSAGE$ + " (line " + LTRIM$(STR$(_ERRORLINE)) + ")"\n' +
    "$IF WIN THEN\n" +
    "    PRINT ef_err_msg$\n" +
    "$ELSE\n" +
    "    ef_err_fh& = FREEFILE\n" +
    '    OPEN "/dev/stderr" FOR OUTPUT AS #ef_err_fh&\n' +
    "    PRINT #ef_err_fh&, ef_err_msg$\n" +
    "    CLOSE #ef_err_fh&\n" +
    "$END IF\n" +
    "SYSTEM 1\n";

// Variables through which a process reaches the desktop session: the X
// display and its cookie, the Wayland socket (named, or the default one in
// XDG_RUNTIME_DIR), the session type Qt/GTK use to pick a backend, and the
// session bus.
const DESKTOP_ENV_KEYS = ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "XDG_SESSION_TYPE", "DBUS_SESSION_BUS_ADDRESS"];

// Environment of a compiled QB64 test binary: an allowlist, so nothing from
// the developer's session reaches the binary or any helper QB64-PE's runtime
// starts. A $CONSOLE:ONLY binary needs none of it; PATH, HOME, the locale
// (LANG, LC_*) and TMPDIR are kept.
function headlessEnv() {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (["PATH", "HOME", "LANG", "TMPDIR"].includes(k) || k.startsWith("LC_")) env[k] = v;
    }
    return env;
}

// Environment of the qb64pe compiler: the inherited one minus the desktop
// variables. The compiler runs make and g++ and needs whatever toolchain
// setup the machine has (CC, CXX, ccache, include and library paths), which
// an allowlist would drop; it is itself a QB64-PE program with the same
// error prompt, so it gets no route to the desktop either.
function compileEnv() {
    const env = { ...process.env };
    for (const k of DESKTOP_ENV_KEYS) delete env[k];
    return env;
}

// Synchronous: a helper node process (qb64-group-run.js) owns the process
// group; this waits for its one-line JSON report. The outer timeout is a
// backstop in case the helper itself is stuck.
function runQb64(binPath, args = []) {
    const helperArgs = [QB64_GROUP_RUNNER, String(QB64_RUN_TIMEOUT_MS), String(QB64_OUTPUT_CAP), path.resolve(binPath), ...args];
    const r = spawnSync(process.execPath, helperArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        env: headlessEnv(),
        timeout: QB64_RUN_TIMEOUT_MS + 15000,
        killSignal: "SIGKILL",
        maxBuffer: 4 * QB64_OUTPUT_CAP,
    });
    let res;
    try {
        res = JSON.parse(r.stdout.toString("utf8"));
    } catch {
        const err = r.stderr ? r.stderr.toString("utf8").slice(0, 300) : "";
        throw new Error(`QB64 run helper failed for ${binPath} (status ${r.status}, signal ${r.signal}); output: ${JSON.stringify(err)}`);
    }
    const stdout = Buffer.from(res.stdout, "base64");
    const all = Buffer.concat([stdout, Buffer.from(res.stderr, "base64")]);
    let why = null;
    if (res.reason === "ETIMEDOUT") why = `timed out after ${QB64_RUN_TIMEOUT_MS}ms`;
    else if (res.reason === "ENOBUFS") why = "exceeded the output limit";
    else if (res.reason) why = `could not be started (${res.reason})`;
    else if (res.signal) why = `was killed by ${res.signal}`;
    else if (res.status !== 0) why = `exited with status ${res.status}`;
    else if (/^Runtime error/m.test(all.toString("utf8"))) why = "reported a runtime error with exit status 0";
    if (why) {
        const out = all.subarray(0, 300).toString("utf8");
        throw new Error(`QB64 binary ${binPath} ${why}; output: ${JSON.stringify(out)}`);
    }
    return stdout;
}

module.exports = {
    runQb64,
    headlessEnv,
    DESKTOP_ENV_KEYS,
    QB64_ERROR_PROLOGUE,
    QB64_ERROR_HANDLER,
    KEEP_TMP,
    tmpDir,
    removeTmpDir,
    withFileLock,
    hasQb64,
    compileQb64,
};
