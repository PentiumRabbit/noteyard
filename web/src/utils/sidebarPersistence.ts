export interface RecentItem { id: string; title: string; icon: string | null; visitedAt: number }

const RECENT_KEY = "noteyard:recent";
const FAVORITES_KEY = "noteyard:favorites";
const RECENT_MAX = 10;

export function loadRecent(): RecentItem[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as RecentItem[]; } catch { return []; }
}
export function saveRecent(items: RecentItem[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(items));
}
export function recordVisit(id: string, title: string, icon: string | null) {
  const items = loadRecent().filter(r => r.id !== id);
  items.unshift({ id, title, icon, visitedAt: Date.now() });
  saveRecent(items.slice(0, RECENT_MAX));
}

export function loadFavorites(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}
export function saveFavorites(set: Set<string>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
}
