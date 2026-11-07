import { StreamLanguage } from "@codemirror/language";
import { fortran } from "@codemirror/legacy-modes/mode/fortran";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 150,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: StreamLanguage.define(fortran),
};

export default plugin;
