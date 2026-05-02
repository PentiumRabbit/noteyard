import type { Block } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildBlock(b: Block, allBlocks: Block[]): any {
  // ── columnList: build children tree from flat blocks ──
  if (b.type === "columnList") {
    const columnChildren = allBlocks
      .filter((c) => c.parent_block_id === b.id && c.type === "column")
      .sort((a, z) => a.order_index - z.order_index)
      .map((col) => {
        let colProps: Record<string, unknown> = {};
        try {
          if (col.props && col.props !== "null") {
            const parsed = JSON.parse(col.props) as Record<string, unknown>;
            if (parsed !== null && typeof parsed === "object") colProps = parsed;
          }
        } catch { /* empty */ }

        const colChildren = allBlocks
          .filter((inner) => inner.parent_block_id === col.id)
          .sort((a, z) => a.order_index - z.order_index)
          .map((inner) => buildBlock(inner, allBlocks));

        // column must have at least one child — BlockNote rejects empty column nodes
        const safeChildren = colChildren.length > 0
          ? colChildren
          : [{ id: `${col.id}-placeholder`, type: "paragraph", props: {}, content: [], children: [] }];
        return { id: col.id, type: "column", props: colProps, content: undefined, children: safeChildren };
      });
    return { id: b.id, type: "columnList", props: {}, content: undefined, children: columnChildren };
  }

  // ── columns (old format): fallback — parse columnsData from content, return empty columnList structure ──
  if (b.type === "columns") {
    let rawProps: Record<string, unknown> = {};
    try { rawProps = JSON.parse(b.content) as Record<string, unknown>; } catch { /* empty */ }
    // If old columnsData prop exists, degrade to empty columnList (no crash)
    if (rawProps && rawProps.columnsData !== undefined) {
      const cols = typeof rawProps.cols === "string" ? parseInt(rawProps.cols, 10) : 2;
      const count = Number.isFinite(cols) && cols > 0 ? cols : 2;
      // column must have at least one child — BlockNote rejects empty column nodes
      const emptyColumns = Array.from({ length: count }, (_, i) => ({
        id: `${b.id}-col-${i}`,
        type: "column",
        props: {},
        content: undefined,
        children: [{ id: `${b.id}-col-${i}-placeholder`, type: "paragraph", props: {}, content: [], children: [] }],
      }));
      return { id: b.id, type: "columnList", props: {}, content: undefined, children: emptyColumns };
    }
    // No columnsData — treat as generic props-as-content block
    return { id: b.id, type: b.type, props: rawProps, content: undefined, children: [] };
  }

  // ── props-as-content block types ──
  if (
    b.type === "database" ||
    b.type === "subpage" ||
    b.type === "fileAttach" ||
    b.type === "bookmark" ||
    b.type === "embed" ||
    b.type === "pdf" ||
    b.type === "button"
  ) {
    let props: Record<string, unknown> = {};
    try { props = JSON.parse(b.content) as Record<string, unknown>; } catch { /* empty */ }
    return { id: b.id, type: b.type, props, content: undefined, children: [] };
  }

  // ── standard content blocks ──
  let content: unknown[] = [];
  try { content = JSON.parse(b.content) as unknown[]; } catch { /* empty */ }
  let props: Record<string, unknown> = {};
  try { if (b.props && b.props !== "null") props = JSON.parse(b.props) as Record<string, unknown>; } catch { /* empty */ }
  if (props === null || typeof props !== "object") props = {};
  return { id: b.id, type: b.type, props, content, children: [] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toBlockNote(blocks: Block[]): any[] {
  // Only process top-level blocks (no parent_block_id, or parent is a page not a block)
  // Top-level = parent_block_id is null or not present in the blocks array
  const blockIds = new Set(blocks.map((b) => b.id));
  const topLevel = blocks.filter(
    (b) => b.parent_block_id === null || b.parent_block_id === undefined || !blockIds.has(b.parent_block_id)
  );
  return topLevel
    .sort((a, z) => a.order_index - z.order_index)
    .map((b) => buildBlock(b, blocks));
}
