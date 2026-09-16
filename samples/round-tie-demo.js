// exprforge/samples/round-tie-demo.js
//
// Locks in, via a real compiled/executed conformance test, that round()'s
// behavior at an exact ".5" tie is IDENTICAL across every one of this
// project's 18 targets -- round half AWAY FROM ZERO, unconditionally.
//
// This wasn't true before, and the discrepancy was real: each target's
// `round` calls-table entry used to delegate straight to that language's
// own native rounding primitive, and those natively disagree in three
// distinct ways (directly verified against a real compiler/interpreter
// for each, not assumed):
//
//   - half-up (ties toward +Infinity): JS, TypeScript, Java, Lua
//   - half away from zero: C, Rust, Go, Perl, Zig, Fortran, COBOL, Julia
//   - half to even ("banker's rounding"): Python, Scheme, QB64, C#
//
// Initially documented and demonstrated as a deliberate, permanent
// divergence (matching this project's precedent for QB64's select()
// div-by-zero behavior). Revisited: unlike that precedent, this one had
// a real, sound, already-majority convention to converge on instead of
// just living with -- away-from-zero is what 8 of the (then-)17 non-JS-
// family targets already did NATIVELY, and Julia's own emitter already
// made a deliberate, precedent-setting choice to match it
// (RoundNearestTiesAway, not Julia's own ties-to-even default) before
// this file existed at all. So the 8 targets that DIDN'T already agree
// (js.js, typescript.js, java.js, lua.js, python.js, scheme.js, qb64.js,
// csharp.js) had their `round` calls-table entry replaced with an
// explicit `sign(x) * floor(abs(x) + 0.5)` formula -- built entirely
// from primitives that already agreed everywhere (floor/sign/abs),
// exactly the formula emitters/cobol.js's own hand-written round: entry
// already used. Every one of the 8 replacements confirmed against a
// real compiler/interpreter, not just written and assumed correct.
//
// This IS a real, deliberate behavior change for round() specifically,
// on those 8 targets, for anyone relying on their native tie-breaking --
// accepted as worth it: this library's entire value proposition is
// "author once, identical behavior everywhere," and round() was the one
// primitive quietly not living up to that.
const { v, num, cmp, select, call } = require("../ast.js");

const which = v("which");

// which selects one of four probe values via chained select() (also
// exercising nested/chained select against a real compiler on every
// target, same shape as samples/nested-select-demo.js) -- 0: -0.5,
// 1: -1.5, 2: 0.5, 3: 1.5.
const roundTieBoundaryAst = {
    name: "roundTieBoundary",
    params: ["which"],
    body: select(
        cmp(which, "==", num(0)),
        call("round", num(-0.5)),
        select(
            cmp(which, "==", num(1)),
            call("round", num(-1.5)),
            select(
                cmp(which, "==", num(2)),
                call("round", num(0.5)),
                call("round", num(1.5)),
            ),
        ),
    ),
};

module.exports = { roundTieBoundaryAst };
