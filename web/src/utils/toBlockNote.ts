import type { Block } from "../types";
import type { BNBlock } from "../types/blocknote";
import { BLOCK_TYPES } from "../types/blockTypes";

function buildBlock(b: Block, allBlocks: Block[]): BNBlock {
  // ── columnList: build children tree from flat blocks ──
  if (b.type === BLOCK_TYPES.COLUMN_LIST) {
    const columnChildren = allBlocks
      .filter((c) => c.parent_block_id === b.id && c.type === BLOCK_TYPES.COLUMN)
      .sort((a, z) => a.order_index - z.order_index)
      .map((col) => {
        let colProps: Record<string, unknown> = {};
        try {
          if (col.props && col.props !== "null") {
            const parsed = JSON.parse(col.props) as Record<string, unknown>;
            if (parsed !== null && typeof parsed === "object") colProps = parsed;
          }
        } catch (e) { console.warn('[toBlockNote] parse failed for block', col.id, e); }

        const colChildren = allBlocks
          .filter((inner) => inner.parent_block_id === col.id)
          .sort((a, z) => a.order_index - z.order_index)
          .map((inner) => buildBlock(inner, allBlocks));

        // column must have at least one child — BlockNote rejects empty column nodes
        const safeChildren = colChildren.length > 0
          ? colChildren
          : [{ id: `${col.id}-placeholder`, type: BLOCK_TYPES.PARAGRAPH, props: {}, content: [], children: [] }];
        return { id: col.id, type: BLOCK_TYPES.COLUMN, props: colProps, content: undefined, children: safeChildren };
      });
    return { id: b.id, type: BLOCK_TYPES.COLUMN_LIST, props: {}, content: undefined, children: columnChildren };
  }

  // ── columns (old format): fallback — parse columnsData from content, return empty columnList structure ──
  if (b.type === BLOCK_TYPES.COLUMNS) {
    let rawProps: Record<string, unknown> = {};
    try { rawProps = JSON.parse(b.content) as Record<string, unknown>; } catch (e) { console.warn('[toBlockNote] parse failed for block', b.id, e); }
    // If old columnsData prop exists, degrade to empty columnList (no crash)
    if (rawProps && rawProps.columnsData !== undefined) {
      const cols = typeof rawProps.cols === "string" ? parseInt(rawProps.cols, 10) : 2;
      const count = Number.isFinite(cols) && cols > 0 ? cols : 2;
      // column must have at least one child — BlockNote rejects empty column nodes
      const emptyColumns = Array.from({ length: count }, (_, i) => ({
        id: `${b.id}-col-${i}`,
        type: BLOCK_TYPES.COLUMN,
        props: {},
        content: undefined,
        children: [{ id: `${b.id}-col-${i}-placeholder`, type: BLOCK_TYPES.PARAGRAPH, props: {}, content: [], children: [] }],
      }));
      return { id: b.id, type: BLOCK_TYPES.COLUMN_LIST, props: {}, content: undefined, children: emptyColumns };
    }
    // No columnsData — treat as generic props-as-content block
    return { id: b.id, type: b.type, props: rawProps, content: undefined, children: [] };
  }

  // ── props-as-content block types ──
  if (
    b.type === BLOCK_TYPES.DATABASE ||
    b.type === BLOCK_TYPES.SUBPAGE ||
    b.type === BLOCK_TYPES.FILE_ATTACH ||
    b.type === BLOCK_TYPES.BOOKMARK ||
    b.type === BLOCK_TYPES.EMBED ||
    b.type === BLOCK_TYPES.PDF ||
    b.type === BLOCK_TYPES.BUTTON
  ) {
    let props: Record<string, unknown> = {};
    try { props = JSON.parse(b.content) as Record<string, unknown>; } catch (e) { console.warn('[toBlockNote] parse failed for block', b.id, e); }
    return { id: b.id, type: b.type, props, content: undefined, children: [] };
  }

  // ── standard content blocks ──
  let content: unknown[] = [];
  try { content = JSON.parse(b.content) as unknown[]; } catch (e) { console.warn('[toBlockNote] parse failed for block', b.id, e); }
  let props: Record<string, unknown> = {};
  try { if (b.props && b.props !== "null") props = JSON.parse(b.props) as Record<string, unknown>; } catch (e) { console.warn('[toBlockNote] parse failed for block', b.id, e); }
  if (props === null || typeof props !== "object") props = {};
  return { id: b.id, type: b.type, props, content: content as BNBlock["content"], children: [] };
}

export function toBlockNote(blocks: Block[]): BNBlock[] {
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
