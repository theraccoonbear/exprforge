import { StreamLanguage } from "@codemirror/language";
import { r } from "@codemirror/legacy-modes/mode/r";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 130,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: StreamLanguage.define(r),
};

export default plugin;
