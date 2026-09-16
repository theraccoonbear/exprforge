// exprforge/samples/number-extremes-demo.js
//
// Extreme-magnitude numeric literals (1e25, 1e-25) against every real
// compiled/interpreted target -- not previously locked into a permanent
// conformance sample, despite this exact class of risk having already
// bitten this project once: QB64's formatNumber has a dedicated fix for
// exponential notation (JS's `1e-9` needs to become `1D-9`, not `1e-9#`
// -- "Invalid expression" on a real compiler otherwise, see qb64.js's own
// comment), found and fixed during development but never turned into a
// real-compiler regression test -- the same "found once, caught only by
// hand, not by CI" pattern that let the ==/!= operator-translation bug
// ship (see samples/comparison-ops-demo.js). This exists so a REGRESSION
// to any target's formatNumber at these magnitudes fails a real compile,
// not just a human's memory of having checked it once.
//
// This WAS 1e250/1e-250 -- dialed back to 1e25/1e-25 after actually
// finding two DIFFERENT real things at that original magnitude, not one:
// (1) c.js/rust.js/go.js/java.js's formatNumber all had the identical
// bug (unconditionally appending ".0"/".0f64" to an integer-valued
// number, even once JS's own String() has already rendered it in
// exponential form -- "1e+250.0" is a genuine syntax error on every one
// of those four real compilers, confirmed and fixed, see each file's own
// formatNumber comment); (2) separately, QB64 itself -- not this
// project's emitter -- has a real, confirmed upstream bug/limitation at
// truly astronomical magnitudes: `PRINT 1D+250` alone, no ExprForge code
// involved at all, prints `1D+249` on a real qb64pe compile (off by
// exactly one order of magnitude). 1e25 sits safely past the ~1e21
// threshold where JS's String() switches to exponential notation (so it
// still exercises the real, fixable bug above) while staying well inside
// the range QB64 handles correctly (confirmed directly: `PRINT 1D+25`
// and `PRINT 1D+21` both print correctly). No known real use of this
// library needs 1e250-scale values, so that upstream QB64 limitation is
// noted here and left alone, not chased further.
const { v, num, add } = require("../ast.js");

const x = v("x");

const numberExtremesAst = {
    name: "numberExtremes",
    params: ["x"],
    // The 1e-25 term is expected to round away entirely once added to
    // 1e25 (ordinary float64 behavior, not a bug) -- it's still included
    // so a target that fails to even PARSE that literal (rather than
    // just losing it to rounding) shows up as a compile error, not
    // silently.
    body: add(add(x, num(1e25)), num(1e-25)),
};

module.exports = { numberExtremesAst };
