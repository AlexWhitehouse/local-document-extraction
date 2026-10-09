import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, readThemePreference, resolveTheme } from "./theme.js";

function mockSystemTheme(isLight) {
  vi.stubGlobal("matchMedia", (query) => ({ matches: isLight && query === "(prefers-color-scheme: light)" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.removeItem("studio.theme");
});

describe("theme preference", () => {
  it("defaults to dark when nothing valid is stored", () => {
    expect(readThemePreference()).toBe("dark");
    window.localStorage.setItem("studio.theme", "sepia");
    expect(readThemePreference()).toBe("dark");
  });

  it("reads a stored preference", () => {
    window.localStorage.setItem("studio.theme", "system");
    expect(readThemePreference()).toBe("system");
  });

  it("resolves system to the operating system theme", () => {
    mockSystemTheme(true);
    expect(resolveTheme("system")).toBe("light");
    mockSystemTheme(false);
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("sets the resolved theme on the document", () => {
    mockSystemTheme(true);
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
