import { StreamLanguage } from "@codemirror/language";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 50,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: StreamLanguage.define(csharp),
};

export default plugin;
