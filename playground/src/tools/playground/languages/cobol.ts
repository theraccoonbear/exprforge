import { StreamLanguage } from "@codemirror/language";
import { cobol } from "@codemirror/legacy-modes/mode/cobol";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 180,
    defaultOn: true,
    defaultOnMobile: true,
    highlight: StreamLanguage.define(cobol),
};

export default plugin;
