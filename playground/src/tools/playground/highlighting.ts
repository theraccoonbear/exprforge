// Per-target syntax highlighting for the emitted-source cards. Each target's
// extension lives in ./languages/<registry key>.ts (real dedicated CodeMirror
// language packages where they exist, @codemirror/legacy-modes StreamParser
// ports for the rest) and is discovered through languageMeta.ts, so this file
// has no per-language list.
import type { Extension } from "@codemirror/state";
import { LANGUAGE_PLUGINS } from "./languageMeta";

export function highlightExtensionFor(languageId: string): Extension[] {
    const ext = LANGUAGE_PLUGINS[languageId]?.highlight;
    return ext ? [ext] : [];
}
