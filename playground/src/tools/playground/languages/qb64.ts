// QB64 has no CodeMirror mode of its own -- but it's a classic
// DIM/AS-typed, END-block-terminated BASIC dialect, and legacy-modes' "vb"
// mode (VB.NET-flavored) already covers exactly that vocabulary (dim, as,
// function/end function, double, integer, ...). Not a perfect match
// (VB.NET-only keywords like "namespace"/"imports" never appear in real
// QB64 output), but an honest improvement over no highlighting at all.
import { StreamLanguage } from "@codemirror/language";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import type { LanguagePlugin } from "../languagePlugin";

const plugin: LanguagePlugin = {
    order: 190,
    defaultOn: false,
    defaultOnMobile: false,
    highlight: StreamLanguage.define(vb),
};

export default plugin;
