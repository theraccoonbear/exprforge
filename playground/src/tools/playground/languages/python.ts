import { python } from "@codemirror/lang-python";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 30,
    defaultOn: true,
    defaultOnMobile: false,
    highlight: python(),
};

export default plugin;
