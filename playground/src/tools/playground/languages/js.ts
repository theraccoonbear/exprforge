import { javascript } from "@codemirror/lang-javascript";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 10,
    defaultOn: true,
    defaultOnMobile: true,
    highlight: javascript(),
};

export default plugin;
