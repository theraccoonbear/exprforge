import { go } from "@codemirror/lang-go";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 70,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: go(),
};

export default plugin;
