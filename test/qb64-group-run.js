"use strict";

// Child-process half of runQb64() in harness-util.js (not a test file; it
// does nothing when `node --test` loads it without arguments).
//
//   node qb64-group-run.js <timeoutMs> <maxOutputBytes> <binary> [args...]
//
// Runs <binary> as the leader of a new process group, with stdin ignored,
// its working directory set to the binary's own directory and this
// process's environment (runQb64 passes the restricted one). Helpers the
// binary starts (QB64-PE's unhandled-error path shells out to a terminal
// emulator) join that group, so the whole group is SIGKILLed on timeout,
// on exceeding the output cap, after the binary exits and if this process
// is stopped, so nothing it started outlives the run. Node's synchronous
// child_process API cannot do this itself: it has no `detached` option and
// its timeout signals only the direct child.
//
// stderr goes to a regular file, not a Node pipe: Node's stdio pipes are
// socketpairs, and QB64-PE cannot OPEN "/dev/stderr" when fd 2 is a socket
// (error 64, "Bad file name"), which the harness error handler does. The
// file's size counts towards the output cap.
//
// Prints one JSON line: { status, signal, reason, stdout, stderr } with
// the output base64-encoded; reason is null, "ETIMEDOUT", "ENOBUFS" or a
// spawn error code.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const POLL_MS = 50;

function killGroup(pid) {
    if (!pid) return;
    try {
        process.kill(-pid, "SIGKILL");
    } catch {
        // group already empty
    }
}

function main(argv) {
    const [timeoutArg, capArg, bin, ...args] = argv;
    const timeoutMs = Number(timeoutArg);
    const cap = Number(capArg);

    const errDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-qb64-run-"));
    const errFd = fs.openSync(path.join(errDir, "stderr"), "w+");
    let child = null;
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        killGroup(child && child.pid);
        try {
            fs.closeSync(errFd);
        } catch {
            // already closed
        }
        fs.rmSync(errDir, { recursive: true, force: true });
    };
    process.on("exit", finish);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
        process.on(sig, () => process.exit(128));
    }

    let reported = false;
    const report = (result) => {
        if (reported) return;
        reported = true;
        process.stdout.write(`${JSON.stringify(result)}\n`);
    };

    child = spawn(bin, args, {
        cwd: path.dirname(bin),
        detached: true,
        stdio: ["ignore", "pipe", errFd],
    });

    let reason = null;
    const stop = (why) => {
        if (!reason) reason = why;
        killGroup(child.pid);
    };
    const stdout = [];
    let stdoutSize = 0;
    const errSize = () => fs.fstatSync(errFd).size;
    child.stdout.on("data", (chunk) => {
        if (reason) return;
        stdout.push(chunk);
        stdoutSize += chunk.length;
        if (stdoutSize + errSize() > cap) stop("ENOBUFS");
    });
    const poll = setInterval(() => {
        if (stdoutSize + errSize() > cap) stop("ENOBUFS");
    }, POLL_MS);
    const timer = setTimeout(() => stop("ETIMEDOUT"), timeoutMs);

    child.on("error", (e) => {
        clearTimeout(timer);
        clearInterval(poll);
        report({ status: null, signal: null, reason: e.code || "ESPAWN", stdout: "", stderr: Buffer.from(e.message).toString("base64") });
        finish();
    });
    let exitInfo = { status: null, signal: null };
    child.on("exit", (status, signal) => {
        exitInfo = { status, signal };
        clearTimeout(timer);
        clearInterval(poll);
        killGroup(child.pid);
    });
    child.on("close", () => {
        if (finished) return;
        const errLen = Math.min(errSize(), cap);
        const errBuf = Buffer.alloc(errLen);
        fs.readSync(errFd, errBuf, 0, errLen, 0);
        const outBuf = Buffer.concat(stdout).subarray(0, cap);
        report({ ...exitInfo, reason, stdout: outBuf.toString("base64"), stderr: errBuf.toString("base64") });
        finish();
    });
}

if (require.main === module && process.argv.length > 2) main(process.argv.slice(2));
