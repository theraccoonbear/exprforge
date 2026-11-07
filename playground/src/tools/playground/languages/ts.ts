import { javascript } from "@codemirror/lang-javascript";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 20,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: javascript({ typescript: true }),
};

export default plugin;
