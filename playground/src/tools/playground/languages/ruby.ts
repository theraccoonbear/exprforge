import { StreamLanguage } from "@codemirror/language";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 105,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: StreamLanguage.define(ruby),
};

export default plugin;
