import type { Block } from "../types";
import type { BNBlock } from "../types/blocknote";
import { BLOCK_TYPES } from "../types/blockTypes";
import { API_BASE } from "../api/client";

const LOCALHOST_UPLOADS_RE = /^http:\/\/localhost:\d+\/uploads\//;

function normalizeUploadUrl(url: string): string {
  if (LOCALHOST_UPLOADS_RE.test(url)) {
    return API_BASE + "/uploads/" + url.split("/uploads/")[1];
  }
  return url;
}

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
    // Normalize localhost upload URLs for fileAttach / pdf blocks (ISS-037)
    if (
      (b.type === BLOCK_TYPES.FILE_ATTACH || b.type === BLOCK_TYPES.PDF) &&
      typeof props.url === "string"
    ) {
      props = { ...props, url: normalizeUploadUrl(props.url) };
    }
    return { id: b.id, type: b.type, props, content: undefined, children: [] };
  }

  // ── standard content blocks ──
  let content: unknown[] = [];
  try { content = JSON.parse(b.content) as unknown[]; } catch (e) { console.warn('[toBlockNote] parse failed for block', b.id, e); }
  // Migrate legacy "strikethrough" style key to BlockNote's canonical "strike"
  content = content.map((node) => {
    if (node && typeof node === "object" && "styles" in node) {
      const s = (node as Record<string, unknown>).styles as Record<string, unknown>;
      if (s && "strikethrough" in s) {
        const { strikethrough, ...rest } = s;
        return { ...node as object, styles: { ...rest, strike: strikethrough } };
      }
    }
    return node;
  });
  // Normalize localhost upload URLs in inline image nodes (ISS-037)
  content = content.map((node) => {
    if (node && typeof node === "object") {
      const n = node as Record<string, unknown>;
      if (n.type === "image") {
        const props = n.props as Record<string, unknown> | undefined;
        if (props?.url && typeof props.url === "string") {
          return { ...n, props: { ...props, url: normalizeUploadUrl(props.url) } };
        }
      }
    }
    return node;
  });
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
