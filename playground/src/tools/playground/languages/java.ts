import { java } from "@codemirror/lang-java";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 40,
    defaultOn: true,
    defaultOnMobile: true,
    highlight: java(),
};

export default plugin;
