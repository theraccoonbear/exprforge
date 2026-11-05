import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 90,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: StreamLanguage.define(lua),
};

export default plugin;
