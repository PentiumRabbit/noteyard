// Shared utilities for database views (DatabaseView, KanbanView, GalleryView)

export interface SelectOption { value: string; colorIdx: number }

export const TAG_COLORS = [
  { bg: "#f3f0ff", color: "#6e5fd6" },
  { bg: "#e8f4fd", color: "#2383e2" },
  { bg: "#edfaf3", color: "#0f9b5c" },
  { bg: "#fff3e0", color: "#d9730d" },
  { bg: "#fce8e8", color: "#eb5757" },
  { bg: "#f0f0f0", color: "#6b7280" },
  { bg: "#fdf4e3", color: "#b07d28" },
  { bg: "#eef0ff", color: "#4361c2" },
];

export function tagColor(val: string): { bg: string; color: string } {
  let h = 0;
  for (let i = 0; i < val.length; i++) h = (h * 31 + val.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}

export function parseOptions(raw: string): SelectOption[] {
  try {
    const arr = JSON.parse(raw ?? "[]");
    if (!Array.isArray(arr)) return [];
    return arr.map((item: unknown) => {
      if (typeof item === "string") return { value: item, colorIdx: 0 };
      if (typeof item === "object" && item !== null && "value" in item) {
        const o = item as { value: string; colorIdx?: number };
        return { value: o.value, colorIdx: o.colorIdx ?? 0 };
      }
      return { value: String(item), colorIdx: 0 };
    });
  } catch {
    return [];
  }
}

export function serializeOptions(opts: SelectOption[]): string {
  return JSON.stringify(opts);
}
