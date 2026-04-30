import { createContext, useContext } from "react";
import { loadResource } from "./resourceLoader";
import { FONTS, DEFAULT_FONT_ID } from "./fontConfig";
import { THEMES, DEFAULT_THEME_ID } from "./themeConfig";

const FONT_KEY = "noteyard_font";
const THEME_KEY = "noteyard_theme";

export function loadSavedSettings(): { fontId: string; themeId: string } {
  return {
    fontId: localStorage.getItem(FONT_KEY) ?? DEFAULT_FONT_ID,
    themeId: localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME_ID,
  };
}

export function saveFont(id: string): void {
  localStorage.setItem(FONT_KEY, id);
}

export function saveTheme(id: string): void {
  localStorage.setItem(THEME_KEY, id);
}

/** Called synchronously in main.tsx before createRoot to prevent FOUC. */
export function initSettings(): void {
  const { fontId, themeId } = loadSavedSettings();

  const fontEntry = FONTS.find((f) => f.id === fontId) ?? FONTS.find((f) => f.id === DEFAULT_FONT_ID)!;
  const themeEntry = THEMES.find((t) => t.id === themeId) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;

  // Apply local resources synchronously; remote resources load async (no FOUC for defaults)
  if (fontEntry.type === "local") {
    void loadResource(fontEntry);
  } else {
    // Apply default first, then async override when remote loads
    void loadResource(FONTS.find((f) => f.id === DEFAULT_FONT_ID)!);
    void loadResource(fontEntry);
  }

  if (themeEntry.type === "local") {
    void loadResource(themeEntry);
  } else {
    void loadResource(THEMES.find((t) => t.id === DEFAULT_THEME_ID)!);
    void loadResource(themeEntry);
  }
}

// ── React context for theme (used by BlockNoteView) ───────────────

export interface SettingsContextValue {
  fontId: string;
  themeId: string;
  setFont: (id: string) => Promise<{ fromCache?: boolean; fallbackUsed?: boolean }>;
  setTheme: (id: string) => Promise<{ fromCache?: boolean; fallbackUsed?: boolean }>;
}

export const SettingsContext = createContext<SettingsContextValue>({
  fontId: DEFAULT_FONT_ID,
  themeId: DEFAULT_THEME_ID,
  setFont: async () => ({}),
  setTheme: async () => ({}),
});

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
