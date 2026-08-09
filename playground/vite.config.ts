import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GH Pages serves this as a PROJECT site (the repo isn't named
// "theraccoonbear.github.io"), so every asset URL in the built output
// needs the "/exprforge/" prefix or they 404 once deployed -- a classic,
// silent GH Pages mistake if this base only gets tested by running the
// dev server, which serves from "/" regardless. Only applied for the
// production build; local `npm run dev` stays at "/" so it's not
// annoying to develop against.
export default defineConfig(({ command }) => ({
    base: command === "build" ? "/exprforge/" : "/",
    plugins: [react()],
    // "exprforge": "file:.." (see package.json) resolves to a symlink in
    // node_modules -- by default Vite/Rollup follow that symlink through
    // to its real path (outside node_modules entirely), which puts it
    // outside the commonjs plugin's default include patterns. The
    // result, confirmed against a real build: index.js itself gets
    // processed, but its OWN internal require()s to sibling files
    // (ast.js, expr.js, emitters/*.js, ...) survive untouched as literal
    // runtime `require(...)` calls -- which then throw
    // "ReferenceError: require is not defined" the moment the bundle
    // actually runs in a browser, since nothing catches that at build
    // time. preserveSymlinks makes Vite treat the package at its
    // node_modules/exprforge path instead of resolving through the
    // symlink, so it's processed like any normally-installed dependency.
    resolve: {
        preserveSymlinks: true,
    },
}));
