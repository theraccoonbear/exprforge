// exprforge/yaml.js
// Optional (de)serialization to/from YAML text. Every AST node built by
// ast.js's functions is already plain, JSON-serializable data -- these two
// functions just add a YAML encoding on top, for storage, diffing, or a
// non-JS producer/consumer of formula definitions. They are NOT an
// alternative authoring surface: composing letIn/select/forComponents
// programmatically is real code (loops, shared bindings, templates) that
// plain YAML data has no way to express.
//
// js-yaml is an OPTIONAL peer dependency, lazily required only when these
// functions are actually called, so the rest of the package (building and
// emitting ASTs) stays dependency-free, matching the README's "no parser,
// no dependencies" for everything except this opt-in pair.

function loadYamlLib() {
    try {
        return require("js-yaml");
    } catch {
        throw new Error(
            'exprforge: toYAML()/fromYAML() need the optional "js-yaml" package -- run `npm install js-yaml` to use them.',
        );
    }
}

const NODE_TYPES = new Set(["num", "var", "bin", "call", "let", "cmp", "select"]);
const BIN_OPS = new Set(["+", "-", "*", "/"]);
const CMP_OPS = new Set([">", "<", ">=", "<=", "==", "!="]);

function fail(path, message) {
    throw new Error(`exprforge: invalid AST at ${path}: ${message}`);
}

// Structural validation for data arriving from outside JS's correct-by-
// construction builder functions (ast.js) -- hand-written or externally
// generated YAML has no compiler to catch a typo'd field name or a missing
// operand before it fails confusingly deep inside an emitter.
function validateNode(node, path) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
        fail(path, `expected a node object, got ${JSON.stringify(node)}`);
    }
    if (!NODE_TYPES.has(node.type)) {
        fail(path, `unknown node type ${JSON.stringify(node.type)} (expected one of ${[...NODE_TYPES].join(", ")})`);
    }
    switch (node.type) {
        case "num":
            if (typeof node.value !== "number") fail(path, `"num" needs a numeric "value"`);
            return;
        case "var":
            if (typeof node.name !== "string" || !node.name) fail(path, `"var" needs a non-empty string "name"`);
            return;
        case "bin":
            if (!BIN_OPS.has(node.op)) {
                fail(path, `"bin" op must be one of ${[...BIN_OPS].join(" ")}, got ${JSON.stringify(node.op)}`);
            }
            validateNode(node.left, `${path}.left`);
            validateNode(node.right, `${path}.right`);
            return;
        case "call":
            if (typeof node.name !== "string" || !node.name) fail(path, `"call" needs a non-empty string "name"`);
            if (!Array.isArray(node.args)) fail(path, `"call" needs an "args" array`);
            node.args.forEach((a, i) => validateNode(a, `${path}.args[${i}]`));
            return;
        case "let":
            if (typeof node.name !== "string" || !node.name) fail(path, `"let" needs a non-empty string "name"`);
            validateNode(node.value, `${path}.value`);
            validateNode(node.body, `${path}.body`);
            return;
        case "cmp":
            if (!CMP_OPS.has(node.op)) {
                fail(path, `"cmp" op must be one of ${[...CMP_OPS].join(" ")}, got ${JSON.stringify(node.op)}`);
            }
            validateNode(node.left, `${path}.left`);
            validateNode(node.right, `${path}.right`);
            return;
        case "select":
            validateNode(node.cond, `${path}.cond`);
            if (node.cond.type !== "cmp") fail(`${path}.cond`, `"select" cond must be a "cmp" node`);
            validateNode(node.then, `${path}.then`);
            validateNode(node.else, `${path}.else`);
            return;
    }
}

// Validates one function definition: { name, params, body }.
function validateFn(fn, path) {
    if (fn === null || typeof fn !== "object" || Array.isArray(fn)) {
        fail(path, "expected a function definition object");
    }
    if (typeof fn.name !== "string" || !fn.name) fail(path, `needs a non-empty string "name"`);
    if (!Array.isArray(fn.params) || !fn.params.every((p) => typeof p === "string")) {
        fail(path, `"params" must be an array of strings`);
    }
    validateNode(fn.body, `${path}.body`);
}

/**
 * Serialize one function definition ({name, params, body}) or an array of
 * them to a YAML string.
 */
function toYAML(astOrList) {
    const yaml = loadYamlLib();
    return yaml.dump(astOrList, { noRefs: true, lineWidth: -1, sortKeys: false });
}

/**
 * Parse a YAML string back into one function definition or an array of
 * them, whichever shape it contains. Validates structure and throws with a
 * path-qualified message on the first problem found, rather than letting a
 * malformed tree fail confusingly deep inside an emitter.
 */
function fromYAML(text) {
    const yaml = loadYamlLib();
    const data = yaml.load(text);
    if (Array.isArray(data)) {
        data.forEach((fn, i) => validateFn(fn, `[${i}]`));
    } else {
        validateFn(data, "<root>");
    }
    return data;
}

module.exports = { toYAML, fromYAML };
