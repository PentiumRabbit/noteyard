import { useEffect } from "react";
import type { RefObject } from "react";
import type { EditorHandle } from "../components/editor/Editor";

interface UseKeyboardShortcutsOptions {
  editorRef: RefObject<EditorHandle | null>;
  setSearchOpen: (updater: (prev: boolean) => boolean) => void;
  closeSettings: () => void;
}

/**
 * Registers global keyboard shortcuts:
 *   Cmd/Ctrl+K  — toggle search modal
 *   Cmd/Ctrl+S  — flush editor (block browser save dialog)
 *   Escape       — close settings panel (when focus is not in an input)
 */
export function useKeyboardShortcuts({
  editorRef,
  setSearchOpen,
  closeSettings,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(v => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        editorRef.current?.flush();
      }
      if (e.key === "Escape") {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          closeSettings();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // closeSettings is defined inline in App; editorRef is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
