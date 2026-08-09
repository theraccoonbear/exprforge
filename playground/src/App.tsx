import { useState } from "react";
import { TOOLS } from "./tools";

export function App() {
    const [activeId, setActiveId] = useState(TOOLS[0].id);
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
