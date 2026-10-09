import { useCallback, useState } from "react";

// A per-browser preference, like the sidebar: appearance is a display choice, not account state.
const THEME_STORAGE_KEY = "studio.theme";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

export const THEME_PREFERENCES = ["system", "light", "dark"];

export const DEFAULT_THEME_PREFERENCE = "dark";

export function readThemePreference() {
  // Reading window.localStorage itself can throw (blocked site data), so it stays inside the try.
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);

    return THEME_PREFERENCES.includes(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function resolveTheme(preference) {
  if (preference !== "system") return preference;

  return window.matchMedia?.(LIGHT_QUERY).matches ? "light" : "dark";
}

let appliedPreference = DEFAULT_THEME_PREFERENCE;

// Sets the token set on <html>. styles.css keys the light tokens off data-theme="light".
export function applyTheme(preference) {
  appliedPreference = preference;
  document.documentElement.dataset.theme = resolveTheme(preference);
}

// Applies the stored preference and, while it is "system", follows the operating system.
export function startThemeSync() {
  applyTheme(readThemePreference());
  window.matchMedia?.(LIGHT_QUERY).addEventListener?.("change", () => applyTheme(appliedPreference));
}

export function useThemePreference() {
  const [preference, setPreference] = useState(readThemePreference);

  const update = useCallback((next) => {
    if (!THEME_PREFERENCES.includes(next)) return;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private windows, blocked site data); the theme still applies.
    }

    applyTheme(next);
    setPreference(next);
  }, []);

  return [preference, update];
}
