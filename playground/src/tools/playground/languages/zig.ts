// codemirror-lang-zig by jared-hughes: a genuine Lezer-grammar
// LanguageSupport (same shape as the official lang-* packages), MIT-licensed,
// checked directly (npm view, actual .d.ts exports) before being trusted.
// There is no official @codemirror/lang-zig.
import { zig } from "codemirror-lang-zig";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 160,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: zig(),
};

export default plugin;
