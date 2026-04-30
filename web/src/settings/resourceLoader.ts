import type { ResourceEntry } from "./resourceTypes";

export interface LoadResult {
  success: boolean;
  fallbackUsed?: boolean;
  fromCache?: boolean;
  error?: string;
}

// ── IndexedDB helpers ──────────────────────────────────────────────

const DB_NAME = "noteyard-resources";
const DB_VERSION = 1;
const STORE_NAME = "css-cache";

interface CacheRecord {
  id: string;
  cssText: string;
  hash: string;
  cachedAt: number;
}

function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCacheRecord(id: string): Promise<CacheRecord | null> {
  try {
    const db = await openCacheDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as CacheRecord) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setCacheRecord(record: CacheRecord): Promise<void> {
  try {
    const db = await openCacheDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // silently skip — cache write failure must not affect current load
  }
}

async function hashText(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── DOM helpers ────────────────────────────────────────────────────

function injectStyleTag(id: string, cssText: string): void {
  const existing = document.querySelector(`[data-resource-id="${id}"]`);
  if (existing) return;
  const style = document.createElement("style");
  style.setAttribute("data-resource-id", id);
  style.textContent = cssText;
  document.head.appendChild(style);
}

function applyEntry(entry: ResourceEntry): void {
  if (entry.applyMethod === "css-var" && entry.fontStack) {
    document.documentElement.style.setProperty("--font-body", entry.fontStack);
  } else if (entry.applyMethod === "data-theme") {
    if (entry.id === "default-light") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", entry.id);
    }
  }
}

// ── Fallback ───────────────────────────────────────────────────────

import { FONTS, DEFAULT_FONT_ID } from "./fontConfig";
import { THEMES, DEFAULT_THEME_ID } from "./themeConfig";

function applyFallback(type: "font" | "theme"): void {
  if (type === "font") {
    const def = FONTS.find((f) => f.id === DEFAULT_FONT_ID)!;
    applyEntry(def);
  } else {
    const def = THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
    applyEntry(def);
  }
}

// ── Main loader ────────────────────────────────────────────────────

export async function loadResource(entry: ResourceEntry): Promise<LoadResult> {
  // 1. Local resource — instant apply
  if (entry.type === "local") {
    applyEntry(entry);
    return { success: true };
  }

  // 2. Already injected in DOM — just apply
  if (document.querySelector(`[data-resource-id="${entry.id}"]`)) {
    applyEntry(entry);
    return { success: true };
  }

  const type: "font" | "theme" = entry.applyMethod === "css-var" ? "font" : "theme";

  // 3. Try network fetch (8s timeout)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(entry.url!, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const cssText = await res.text();
    const hash = await hashText(cssText);

    // Update cache only when content changed
    const cached = await getCacheRecord(entry.id);
    if (!cached || cached.hash !== hash) {
      await setCacheRecord({ id: entry.id, cssText, hash, cachedAt: Date.now() });
    }

    injectStyleTag(entry.id, cssText);
    applyEntry(entry);
    return { success: true };
  } catch {
    // Network failed — try local cache
  }

  // 4. Try IndexedDB cache
  const cached = await getCacheRecord(entry.id);
  if (cached) {
    injectStyleTag(entry.id, cached.cssText);
    applyEntry(entry);
    return { success: true, fromCache: true };
  }

  // 5. Nothing worked — fall back to built-in default
  applyFallback(type);
  return { success: false, fallbackUsed: true, error: "网络不可用且无本地缓存" };
}
