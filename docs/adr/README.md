# Architecture Decision Records

ExprForge's core promise is "author once, get identical behavior
everywhere." In practice, several built-in primitives had real,
per-target divergences that were only found by auditing each target's
actual compiler/interpreter behavior, not by reading documentation or
assuming consistency. Each time that happened, the fix was the same
shape: pick one standard behavior (usually the majority, or the most
defensible one when there wasn't a clean majority), normalize every
target onto it, and document exactly what changed and why.

This directory is the decision log for that recurring pattern. Each ADR
records: what was found, what was chosen instead, why, and what (if
anything) is a confirmed, deliberately-unfixed exception. It doesn't
duplicate the full per-target breakdown — that lives in the relevant
sample file's own header comment (`samples/*.js`) and the corresponding
`test/conformance.test.js` registration, both cited from each ADR. The
root `README.md` carries the user-facing summary of the ones with the
widest practical impact (currently 0001 and 0002); this log is the
fuller, append-only history, including narrower ones that don't warrant
their own README section.

| ADR | Decision |
|---|---|
| [0001](0001-round-tie-breaking.md) | `round()` ties away from zero on every target |
| [0002](0002-domain-error-handling.md) | Out-of-domain math primitives return NaN/Infinity on every target |
| [0003](0003-min-max-nan-propagation.md) | `min()`/`max()` propagate NaN on every target |

When a new one of these is found and fixed, add a new numbered file
here (next sequential number, never reused even if a later decision
supersedes an earlier one — mark the superseded one instead) and link
it from the table above.
