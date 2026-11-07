// Our own printer output -- the real mode (exprForgeMode.ts), same one the
// main editor uses, not a borrowed approximation.
import { exprForgeLanguage } from "../exprForgeMode";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 200,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: exprForgeLanguage,
};

export default plugin;
