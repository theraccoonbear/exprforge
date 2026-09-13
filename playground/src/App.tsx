import { useState } from "react";
import { TOOLS } from "./tools";

const TOOL_PARAM = "tool";

// A shared link (?tool=<id>) should land on the tool it was copied
// from, not always default to TOOLS[0] -- see each tool's own
// copyLink(), which sets this same param (values sourced from
// tools/ids.ts on both sides so they can't drift apart). Falls back to
// TOOLS[0]'s id for a bare visit (no ?tool= at all, including every
// link copied before this existed) or an id that doesn't match any
// registered tool.
function initialActiveId(): string {
    const fromUrl = new URLSearchParams(window.location.search).get(TOOL_PARAM);
    return TOOLS.some((t) => t.id === fromUrl) ? (fromUrl as string) : TOOLS[0].id;
}

export function App() {
    const [activeId, setActiveId] = useState(initialActiveId);
    const active = TOOLS.find((t) => t.id === activeId) ?? TOOLS[0];
    const ActiveComponent = active.component;

    return (
        <div className="shell">
            <header className="shell-header">
                <div className="shell-brand">
                    <span className="shell-logo" aria-hidden="true">
                        🔢🔨
                    </span>
                    <span className="shell-title">ExprForge</span>
                </div>
                <nav className="shell-nav" aria-label="Tools">
                    {TOOLS.map((tool) => (
                        <button
                            key={tool.id}
                            type="button"
                            className={tool.id === activeId ? "shell-nav-item shell-nav-item--active" : "shell-nav-item"}
                            onClick={() => setActiveId(tool.id)}
                            title={tool.description}
                        >
                            {tool.label}
                        </button>
                    ))}
                </nav>
                <a
                    className="shell-github-link"
                    href="https://github.com/theraccoonbear/exprforge"
                    target="_blank"
                    rel="noreferrer"
                >
                    GitHub
                </a>
            </header>
            <main className="shell-main">
                <ActiveComponent />
            </main>
        </div>
    );
}
