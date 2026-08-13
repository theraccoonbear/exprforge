// exprforge/samples/macro-demo.js
// Not a worked example -- a conformance-test fixture for macros.js,
// same role samples/kitchen-sink.js plays for the core Math primitives
// and samples/math-demo.js plays for exprforge/math: exists purely so
// test/conformance.test.js can prove macro-expanded code agrees across
// every real target, not just evaluate() (which is blind to codegen --
// see the two macros registered below, both AST-fn-def-shaped
// (fn`...`-based via loadMacro), NOT plain-JS-function macros like
// math/index.js's (already covered by mathDemo). That distinction is
// the whole point of this file: an AST-fn-def macro's own "let"
// statements get automatically alpha-renamed on every call (see
// macros.js's toMacro/substituteAndRename), and a gensym'd name that
// isn't a valid identifier in every target once slipped past every
// check here and only broke Fortran (a leading underscore -- see
// substituteAndRename's own comment). hypotSq is called TWICE in one
// function specifically to prove two different calls' gensym'd names
// don't collide with each other either.
const { v, letIn, call, field, add } = require("../ast.js");
const { fn } = require("../fn.js");
const { loadMacro } = require("../macros.js");

// Single-value macro with its own internal "let" -- the gensym path.
loadMacro("hypotSq", fn(["hypotSq(a, b): let sq = a * a + b * b; return sq;"]));

// Multi-output macro whose outputs() is wrapped in its own let-chain --
// the exact shape that was originally misdetected as a single value
// before that got fixed (see toMacro's own comment in macros.js).
// Field access (.rx/.ry) on its result is exercised below.
loadMacro(
    "rotate90",
    fn([
        `rotate90(x, y):
  let rx = 0 - y;
  let ry = x;
  return { rx, ry };
`,
    ]),
);

// "byy", not "by": BY is a reserved COBOL keyword -- same reason
// math-demo.js's MATH_DEMO_PARAMS uses it, see that file's own comment.
const macroDemoAst = {
    name: "macroDemo",
    params: ["ax", "ay", "bx", "byy"],
    body: letIn(
        "hSq1",
        call("hypotSq", v("ax"), v("ay")),
        letIn(
            "hSq2",
            call("hypotSq", v("bx"), v("byy")),
            letIn("r", call("rotate90", v("ax"), v("ay")), add(v("hSq1"), v("hSq2"), field(v("r"), "rx"), field(v("r"), "ry"))),
        ),
    ),
};

module.exports = { macroDemoAst };
