import { StreamLanguage } from "@codemirror/language";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 120,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: StreamLanguage.define(julia),
};

export default plugin;
