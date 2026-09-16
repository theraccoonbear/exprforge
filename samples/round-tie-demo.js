// exprforge/samples/round-tie-demo.js
//
// Demonstrates, and locks in via a real compiled/executed conformance
// test, a genuine and PERMANENT cross-language divergence: round()'s
// behavior at an exact ".5" tie is not one convention, it's three,
// directly inherited from each target's own native rounding primitive
// with zero normalization by this library:
//
//   - half-up (ties toward +Infinity): JS, TypeScript, Java, Lua
//       round(-0.5) == 0, round(-1.5) == -1
//   - half away from zero: C, Rust, Go, Perl, Zig, Fortran, COBOL,
//     Julia, PHP (PHP's documented PHP_ROUND_HALF_UP default -- not
//     independently run here, no php toolchain in this project's CI/dev
//     setup, taken from PHP's own manual)
//       round(-0.5) == -1, round(-1.5) == -2
//   - half to even ("banker's rounding"): Python, Scheme, QB64, C# (.NET's
//     documented Math.Round(double) default -- not independently run
//     here, this project's sandbox has a pre-existing broken `dotnet
//     build`, see test/conformance.test.js's own C# notes; taken from
//     Microsoft's own docs)
//       round(-0.5) == 0, round(-1.5) == -2
//
// Every value above except the PHP/C# pair was confirmed directly
// against a real compiler/interpreter for this file, not assumed from
// memory or documentation.
//
// This is DELIBERATELY left as-is, not unified to one convention --
// see the root README's "round() at exact .5 boundaries" section for
// the full reasoning (matches the project's existing precedent for a
// real, demonstrated divergence: QB64's select()-always-evaluates-both-
// branches div-by-zero behavior in samples/... see normalizeX in
// test/conformance.test.js). kitchen-sink.js's own inputs deliberately
// AVOID landing on an exact .5 value for exactly this reason -- this
// file is the one place that deliberately does NOT avoid it, so the
// divergence is demonstrated and regression-tested, not just avoided.
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
