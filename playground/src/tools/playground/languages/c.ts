import { cpp } from "@codemirror/lang-cpp";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 60,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: cpp(),
};

export default plugin;
