// emitters/latex.js output is math-mode content, so the math-mode variant
// of legacy-modes' TeX mode, not the document-level one.
import { StreamLanguage } from "@codemirror/language";
import { stexMath } from "@codemirror/legacy-modes/mode/stex";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 210,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: StreamLanguage.define(stexMath),
};

export default plugin;
