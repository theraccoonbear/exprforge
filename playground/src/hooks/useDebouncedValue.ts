import { useEffect, useState } from "react";

// Small, generic debounce -- keeps the editor itself perfectly
// responsive (it's never debounced) while the somewhat-more-expensive
// "parse + emit to 18 targets" work waits for a short pause in typing,
// so error states don't flicker on every single keystroke of an
// in-progress identifier.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const handle = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(handle);
    }, [value, delayMs]);

    return debounced;
}
