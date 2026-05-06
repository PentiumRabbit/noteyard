import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Slice } from "prosemirror-model";
import { getNearestBlockPos, getBlockInfo, nodeToBlock, UniqueID } from "@blocknote/core";
import type { BlockNoteEditor } from "@blocknote/core";

const SIDE_THRESHOLD = 0.15;
const OVERLAY_ID = "bn-drop-overlay-el";

// ── ISS-038: DOM-based block position lookup ─────────────────────────────────
// posAtCoords returns null for blocks with content:"none" (database, button,
// subpage, etc.) because ProseMirror sees no text insertion point inside them.
// This helper falls back to elementFromPoint + data-id attribute lookup so we
// can resolve a valid posBeforeNode for any block type.
function getBlockPosFromPoint(
  view: EditorView,
  clientX: number,
  clientY: number
): { posBeforeNode: number; node: ReturnType<typeof view.state.doc.nodeAt> } | null {
  // Try the standard path first.
  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (coords) {
    try {
      const $pos = view.state.doc.resolve(coords.pos);
      for (let d = $pos.depth; d >= 0; d--) {
        const node = $pos.node(d);
        if (node.type.spec.group?.includes("bnBlock")) {
          return { posBeforeNode: $pos.before(d), node };
        }
      }
    } catch { /* fall through */ }
  }

  // posAtCoords failed or found no bnBlock: use DOM reverse-lookup.
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;

  // BlockNote sets data-id on the bn-block-outer wrapper.
  const outer = (el as HTMLElement).closest("[data-node-type='blockOuter']") as HTMLElement | null;
  if (outer) {
    const blockId = outer.getAttribute("data-id");
    if (blockId) {
      let found: { posBeforeNode: number; node: ReturnType<typeof view.state.doc.nodeAt> } | null = null;
      view.state.doc.descendants((node, pos) => {
        if (found) return false;
        if (node.attrs?.id === blockId) {
          found = { posBeforeNode: pos, node };
          return false;
        }
      });
      if (found) return found;
    }
  }

  // Last resort: posAtDOM on the inner blockContainer element.
  const container = (el as HTMLElement).closest(
    "[data-node-type='blockContainer']"
  ) as HTMLElement | null;
  if (!container) return null;
  try {
    const pos = view.posAtDOM(container, 0);
    const $pos = view.state.doc.resolve(pos);
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d);
      if (node.type.spec.group?.includes("bnBlock")) {
        return { posBeforeNode: $pos.before(d), node };
      }
    }
  } catch { /* ignore */ }

  return null;
}

// ── ISS-038: full multiColumn drop handler ───────────────────────────────────
// Replicates xl-multi-column's handleDrop logic but uses getBlockPosFromPoint
// instead of posAtCoords so it works for content:"none" blocks.
function handleMultiColumnDrop(
  view: EditorView,
  event: DragEvent,
  slice: Slice,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: BlockNoteEditor<any, any, any>
): boolean {
  // Only intercept BlockNote internal drags.
  if (!event.dataTransfer?.types.includes("blocknote/html")) return false;

  const blockPos = getBlockPosFromPoint(view, event.clientX, event.clientY);
  if (!blockPos) return false;

  let { posBeforeNode, node } = blockPos;
  if (!node) return false;

  // If the hit block is inside a column, lift up to the column level.
  try {
    const resolved = view.state.doc.resolve(posBeforeNode);
    if (resolved.parent.type.name === "column") {
      const colResolved = view.state.doc.resolve(resolved.before());
      posBeforeNode = colResolved.pos;
      node = colResolved.nodeAfter ?? node;
    }
  } catch {
    return false;
  }

  // Determine drop side via bounding rect.
  const domEl = view.nodeDOM(posBeforeNode) as HTMLElement | null;
  if (!domEl) return false;
  const rect = domEl.getBoundingClientRect();
  let side: "left" | "right" | "regular" = "regular";
  if (event.clientX <= rect.left + rect.width * SIDE_THRESHOLD) side = "left";
  else if (event.clientX >= rect.right - rect.width * SIDE_THRESHOLD) side = "right";
  if (side === "regular") {
    // For regular (non-column-edge) drops, use BlockNote API to move the block.
    // This avoids the ProseMirror default replaceRange path which uses BlockNote's
    // reconstructed slice (openStart=0, openEnd=0) and inserts spurious whitespace.
    // Parse the original block ID from the drag data to find the clean block object
    // in editor.document, avoiding nodeToBlock which returns a new-ID copy that
    // causes removeBlocks to throw and leaves event.preventDefault uncalled.
    const html = event.dataTransfer?.getData("blocknote/html") ?? "";
    const idMatch = html.match(/data-id="([^"]+)"/);
    if (!idMatch) return false;
    const draggedId = idMatch[1];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function findBlockById(blocks: any[], id: string): any {
      for (const b of blocks) {
        if (b.id === id) return b;
        if (b.children?.length) {
          const found = findBlockById(b.children, id);
          if (found) return found;
        }
      }
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draggedBlock: any = findBlockById(editor.document as any[], draggedId);
    if (!draggedBlock) return false;

    const schema = editor.schema;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nearestBlock: any;
    try {
      nearestBlock = getNearestBlockPos(view.state.doc, posBeforeNode + 1);
    } catch {
      return false;
    }
    const targetInfo = getBlockInfo(nearestBlock);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let targetBlock: any;
    try {
      targetBlock = nodeToBlock(
        targetInfo.bnBlock.node,
        schema.blockSchema,
        schema.inlineContentSchema,
        schema.styleSchema
      );
    } catch {
      return false;
    }

    if (targetBlock.id === draggedBlock.id) return true; // dragging onto itself

    // Determine insert placement: above or below the target block midpoint.
    const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";

    editor.removeBlocks([draggedBlock]);
    editor.insertBlocks([draggedBlock], targetBlock, placement);
    return true;
  }

  // Never create nested columnLists.
  if (node.type.name === "columnList") return false;

  // Extract the dragged block from the slice.
  if (!slice.content.childCount) return false;
  const draggedPmNode = slice.content.child(0);
  const schema = editor.schema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let draggedBlock: any;
  try {
    draggedBlock = nodeToBlock(
      draggedPmNode,
      schema.blockSchema,
      schema.inlineContentSchema,
      schema.styleSchema
    );
  } catch {
    return false;
  }

  // Gather block info for the target.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nearestBlock: any;
  try {
    nearestBlock = getNearestBlockPos(view.state.doc, posBeforeNode + 1);
  } catch {
    return false;
  }
  const blockInfo = getBlockInfo(nearestBlock);

  if (blockInfo.blockNoteType === "column") {
    // Target is already inside a column — append a new column to the columnList.
    const columnListNode = view.state.doc.resolve(blockInfo.bnBlock.beforePos).node();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let columnListBlock: any;
    try {
      columnListBlock = nodeToBlock(
        columnListNode,
        schema.blockSchema,
        schema.inlineContentSchema,
        schema.styleSchema
      );
    } catch {
      return false;
    }

    // Normalise column widths.
    let totalWidth = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    columnListBlock.children.forEach((col: any) => { totalWidth += (col.props?.width ?? 1); });
    const avgWidth = totalWidth / (columnListBlock.children.length || 1);
    if (avgWidth < 0.99 || avgWidth > 1.01) {
      const factor = 1 / avgWidth;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      columnListBlock.children.forEach((col: any) => { col.props.width *= factor; });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetColIndex = columnListBlock.children.findIndex((col: any) => col.id === blockInfo.bnBlock.node.attrs.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newChildren = columnListBlock.children
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((col: any) => ({
        ...col,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        children: col.children.filter((b: any) => b.id !== draggedBlock.id),
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((col: any) => col.children.length > 0);

    const insertIdx = side === "left" ? targetColIndex : targetColIndex + 1;
    newChildren.splice(insertIdx < 0 ? newChildren.length : insertIdx, 0, {
      type: "column",
      children: [draggedBlock],
      props: { width: 1 },
      content: undefined,
      id: UniqueID.options.generateID(),
    });

    editor.removeBlocks([draggedBlock]);
    editor.updateBlock(columnListBlock, { children: newChildren });
  } else {
    // Target is not in a column — create a brand new columnList.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let targetBlock: any;
    try {
      targetBlock = nodeToBlock(
        blockInfo.bnBlock.node,
        schema.blockSchema,
        schema.inlineContentSchema,
        schema.styleSchema
      );
    } catch {
      return false;
    }

    if (targetBlock.id === draggedBlock.id) return true; // dragging onto itself

    const ordered = side === "left"
      ? [draggedBlock, targetBlock]
      : [targetBlock, draggedBlock];

    editor.removeBlocks([draggedBlock]);
    editor.replaceBlocks([targetBlock], [
      {
        type: "columnList",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        children: ordered.map((b: any) => ({ type: "column", children: [b] })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);
  }

  return true;
}

function getOrCreateOverlay(): HTMLElement {
  let el = document.getElementById(OVERLAY_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = OVERLAY_ID;
    el.className = "bn-drop-overlay";
    document.body.appendChild(el);
  }
  return el;
}

function removeOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) {
    el.parentNode?.removeChild(el);
  }
}

function showOverlay(rect: DOMRect, position: "left" | "right" | "regular") {
  const el = getOrCreateOverlay();

  let left: number;
  let width: number;

  if (position === "left") {
    left = rect.left;
    width = rect.width / 2;
  } else if (position === "right") {
    left = rect.left + rect.width / 2;
    width = rect.width / 2;
  } else {
    left = rect.left;
    width = rect.width;
  }

  el.style.cssText = [
    "position: fixed",
    "pointer-events: none",
    "z-index: 50",
    `left: ${left}px`,
    `top: ${rect.top}px`,
    `width: ${width}px`,
    `height: ${rect.height}px`,
  ].join("; ");
  el.className = "bn-drop-overlay";
}

class DropOverlayView {
  private handlers: { name: string; handler: (e: Event) => void }[];

  constructor(private editorView: EditorView) {
    const names = ["dragover", "dragend", "drop", "dragleave"] as const;
    this.handlers = names.map((name) => {
      const handler = (e: Event) => this.handleEvent(name, e as DragEvent);
      editorView.dom.addEventListener(name, handler);
      return { name, handler };
    });
  }

  private handleEvent(
    name: "dragover" | "dragend" | "drop" | "dragleave",
    e: DragEvent
  ) {
    if (name === "dragover") {
      this.onDragOver(e);
    } else if (name === "dragleave") {
      if (
        e.target === this.editorView.dom ||
        !this.editorView.dom.contains(e.relatedTarget as Node)
      ) {
        removeOverlay();
      }
    } else {
      removeOverlay();
    }
  }

  private onDragOver(e: DragEvent) {
    const pos = this.editorView.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!pos) return;

    let blockPos: number;
    try {
      const info = getNearestBlockPos(this.editorView.state.doc, pos.pos);
      let resolved = this.editorView.state.doc.resolve(info.posBeforeNode);
      // If inside a column, use the column's position (same logic as multiColumnDropCursor)
      if (resolved.parent.type.name === "column") {
        resolved = this.editorView.state.doc.resolve(resolved.before());
      }
      blockPos = resolved.pos;
    } catch {
      return;
    }

    const blockEl = this.editorView.nodeDOM(blockPos) as HTMLElement | null;
    if (!blockEl) return;

    const rect = blockEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    let position: "left" | "right" | "regular";
    if (e.clientX <= rect.left + rect.width * SIDE_THRESHOLD) {
      position = "left";
    } else if (e.clientX >= rect.right - rect.width * SIDE_THRESHOLD) {
      position = "right";
    } else {
      position = "regular";
    }

    showOverlay(rect, position);
  }

  destroy() {
    this.handlers.forEach(({ name, handler }) =>
      this.editorView.dom.removeEventListener(name, handler)
    );
    removeOverlay();
  }
}

const dropOverlayKey = new PluginKey("dropOverlay");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dropOverlayPlugin(editor: BlockNoteEditor<any, any, any>): Plugin {
  return new Plugin({
    key: dropOverlayKey,
    view(editorView) {
      return new DropOverlayView(editorView);
    },
    props: {
      handleDrop(view, event, slice, _moved) {
        return handleMultiColumnDrop(view, event as DragEvent, slice, editor);
      },
    },
  });
}
