import { php } from "@codemirror/lang-php";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 110,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: php(),
};

export default plugin;
