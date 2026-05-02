import { create } from "zustand";

interface SidebarState {
  renamingPageId: string | null;
  setRenamingPageId: (id: string | null) => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  renamingPageId: null,
  setRenamingPageId: (id) => set({ renamingPageId: id }),
}));
