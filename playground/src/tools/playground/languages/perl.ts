import { StreamLanguage } from "@codemirror/language";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 100,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: StreamLanguage.define(perl),
};

export default plugin;
