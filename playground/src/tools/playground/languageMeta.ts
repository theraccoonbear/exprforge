// Display metadata for each emitters/registry.js key, derived rather than
// listed: the label comes from the library's own emitter metadata
// (emitter.meta.displayName), and the highlighting extension, default
// visibility and ordering come from ./languages/<key>.ts, discovered with
// import.meta.glob. A new target therefore shows up here the moment it is
// registered in the library.
//
// Defaults are deliberately a small curated set rather than every target at
// once ("easily see multiple toggleable outputs, not overwhelmed by all of
// them"); the full set is always one click away via the toggle chips.
import { ExprForge } from "../../lib/exprforge";
import type { LanguagePlugin } from "./languagePlugin";

export interface LanguageMeta {
    label: string;
    defaultOn: boolean;
    // Smaller still, for narrow viewports -- "pared down" mobile default.
    defaultOnMobile: boolean;
}

const modules = import.meta.glob<{ default: LanguagePlugin }>("./languages/*.ts", { eager: true });

export const LANGUAGE_PLUGINS: Record<string, LanguagePlugin> = {};
for (const [path, mod] of Object.entries(modules)) {
    const key = path.replace(/^.*\//, "").replace(/\.ts$/, "");
    LANGUAGE_PLUGINS[key] = mod.default;
}

const registered = Object.keys(ExprForge.emitters);
const rank = (id: string) => LANGUAGE_PLUGINS[id]?.order ?? Number.MAX_SAFE_INTEGER;

export const LANGUAGE_META: Record<string, LanguageMeta> = Object.fromEntries(
    registered
        .map((id, index) => ({ id, index }))
        .sort((a, b) => rank(a.id) - rank(b.id) || a.index - b.index)
        .map(({ id }) => {
            const plugin = LANGUAGE_PLUGINS[id];
            const meta = ExprForge.emitters[id].meta;
            return [
                id,
                {
                    label: plugin?.label ?? meta?.displayName ?? id,
                    defaultOn: plugin?.defaultOn ?? false,
                    defaultOnMobile: plugin?.defaultOnMobile ?? false,
                },
            ];
        }),
);
