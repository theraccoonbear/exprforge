import { StreamLanguage } from "@codemirror/language";
import { scheme } from "@codemirror/legacy-modes/mode/scheme";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 170,
    defaultOn: true,
    defaultOnMobile: false,
    highlight: StreamLanguage.define(scheme),
};

export default plugin;
