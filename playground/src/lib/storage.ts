// Small, defensive localStorage wrappers -- every read/write is wrapped
// in try/catch, since storage can be unavailable (private browsing in
// some browsers throws on access entirely), full, or disabled by policy.
// Losing persistence silently is fine; losing the app to an uncaught
// exception over it isn't. Keys are namespaced so this never collides
// with anything else that might share the deployed origin.
const PREFIX = "exprforge-playground:";

export function readStorageString(key: string): string | null {
    try {
        return window.localStorage.getItem(PREFIX + key);
    } catch {
        return null;
    }
}

export function writeStorageString(key: string, value: string): void {
    try {
        window.localStorage.setItem(PREFIX + key, value);
    } catch {
        // Quota exceeded, storage disabled, private-browsing throw, ...
    }
}

export function readStorageJSON<T>(key: string): T | null {
    const raw = readStorageString(key);
    if (raw === null) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export function writeStorageJSON(key: string, value: unknown): void {
    try {
        writeStorageString(key, JSON.stringify(value));
    } catch {
        // Same defensive posture as writeStorageString.
    }
}
