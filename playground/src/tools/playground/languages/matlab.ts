import { StreamLanguage } from "@codemirror/language";
import { octave } from "@codemirror/legacy-modes/mode/octave";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 140,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: StreamLanguage.define(octave),
};

export default plugin;
