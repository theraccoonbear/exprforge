import { rust } from "@codemirror/lang-rust";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 80,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: rust(),
};

export default plugin;
