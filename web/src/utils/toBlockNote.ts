import type { Block } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toBlockNote(blocks: Block[]): any[] {
  return blocks.map((b) => {
    if (b.type === "database" || b.type === "columns" || b.type === "subpage" || b.type === "fileAttach") {
      let props: Record<string, unknown> = {};
      try { props = JSON.parse(b.content) as Record<string, unknown>; } catch { /* empty */ }
      return { id: b.id, type: b.type, props, content: undefined, children: [] };
    }
    let content: unknown[] = [];
    try { content = JSON.parse(b.content) as unknown[]; } catch { /* empty */ }
    let props: Record<string, unknown> = {};
    try { if (b.props && b.props !== "null") props = JSON.parse(b.props) as Record<string, unknown>; } catch { /* empty */ }
    if (props === null || typeof props !== "object") props = {};
    return { id: b.id, type: b.type, props, content, children: [] };
  });
}
