// One file per target in ./languages/<registry key>.ts, discovered by
// languageMeta.ts and highlighting.ts via import.meta.glob -- there is no
// central list to edit when a language is added. A target with no file
// here still appears in the playground (label from the library's own
// emitter metadata), just unhighlighted and off by default.
import type { Extension } from "@codemirror/state";

export interface LanguagePlugin {
    // Position in the toggle chips and cards; lower comes first. Targets
    // without a file sort last, in registry order.
    order: number;
    // Shown immediately on a first visit (desktop / narrow viewport).
    defaultOn: boolean;
    defaultOnMobile: boolean;
    // CodeMirror extension used to highlight the emitted source.
    highlight?: Extension;
    // Only needed to override the library's meta.displayName.
    label?: string;
}
