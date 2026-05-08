import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Slice } from "prosemirror-model";
import { getNearestBlockPos, getBlockInfo, nodeToBlock, UniqueID } from "@blocknote/core";
import type { BlockNoteEditor } from "@blocknote/core";

// ISS-048: side is determined from dragover (not drop) coordinates to avoid
// the drag handle's left-edge X position triggering unintended column creation.
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

// ── Shared helper: find a block by ID in the BlockNote document tree ─────────
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

  // If the hit block is inside a column, lift up to the columnList level so that
  // side detection uses the full row width and regular drops exit the column structure.
  try {
    const resolved = view.state.doc.resolve(posBeforeNode);
    if (resolved.parent.type.name === "column" && resolved.depth >= 1) {
      const colListPos = resolved.before(resolved.depth - 1);
      const colListResolved = view.state.doc.resolve(colListPos);
      posBeforeNode = colListResolved.pos;
      node = colListResolved.nodeAfter ?? node;
    }
  } catch {
    return false;
  }

  // Resolve the dragged block by ID from editor.document — shared by all drop paths.
  // nodeToBlock(slice...) returns a new-ID copy that causes removeBlocks to throw.
  const html = event.dataTransfer?.getData("blocknote/html") ?? "";
  const idMatch = html.match(/data-id="([^"]+)"/);
  if (!idMatch) return false;
  const draggedId = idMatch[1];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draggedBlock: any = findBlockById(editor.document as any[], draggedId);
  if (!draggedBlock) return false;

  const schema = editor.schema;

  // Use the side recorded during the last dragover event, not the drop coordinate.
  // The drag handle sits on the left edge so the drop X always lands near rectLeft,
  // which would falsely trigger "left" (column creation) on every regular drag.
  const side = lastDragoverSide;
  lastDragoverSide = "regular"; // reset for next drag

  const domEl = view.nodeDOM(posBeforeNode) as HTMLElement | null;
  if (!domEl) return false;
  const rect = domEl.getBoundingClientRect();
  if (side === "regular") {
    // Resolve the target block. When the drop lands on a columnList node, use the
    // columnList itself as the target (via its ID from the node attrs) so that we
    // move blocks relative to the whole columnList, not a block inside a column.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let targetBlock: any;
    if (node.type.name === "columnList") {
      const colListId = node.attrs?.id as string | undefined;
      if (!colListId) return false;
      targetBlock = findBlockById(editor.document as any[], colListId);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let nearestBlock: any;
      try {
        nearestBlock = getNearestBlockPos(view.state.doc, posBeforeNode + 1);
      } catch {
        return false;
      }
      const targetInfo = getBlockInfo(nearestBlock);
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
    }
    if (!targetBlock) return false;

    if (targetBlock.id === draggedBlock.id) {
      event.preventDefault();
      return true;
    }

    const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    event.preventDefault();
    editor.removeBlocks([draggedBlock]);
    editor.insertBlocks([draggedBlock], targetBlock, placement);
    return true;
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

  // If drop lands on a columnList itself (not inside a column), add a new column.
  if (node.type.name === "columnList") {
    const colListId = node.attrs?.id as string | undefined;
    if (!colListId) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const columnListBlock: any = findBlockById(editor.document as any[], colListId);
    if (!columnListBlock) return false;
    if (columnListBlock.id === draggedBlock.id) return false;
    const insertIdx = side === "left" ? 0 : columnListBlock.children.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newChildren = columnListBlock.children.filter((col: any) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      !col.children.some((b: any) => b.id === draggedBlock.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ).filter((col: any) => col.children.length > 0);
    newChildren.splice(insertIdx, 0, {
      type: "column",
      children: [draggedBlock],
      props: { width: 1 },
      content: undefined,
      id: UniqueID.options.generateID(),
    });
    event.preventDefault();
    editor.removeBlocks([draggedBlock]);
    editor.updateBlock(columnListBlock, { children: newChildren });
    return true;
  }

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

// Shared state: dragover sets this so handleDrop reads the intent from hover position,
// not from the drop coordinate (which can land on the drag handle edge unintentionally).
let lastDragoverSide: "left" | "right" | "regular" = "regular";

class DropOverlayView {
  // ── HTML5 drag handlers (ISS-048 path) ──────────────────────────────────────
  private handlers: { name: string; handler: (e: Event) => void }[];

  // ── Pointer events state (REQ-086 T1 + T2) ──────────────────────────────────
  private isDragging = false;
  private sourceBlockEl: HTMLElement | null = null;
  private sourceBlockPos = 0;
  private sourceBlockId: string | null = null;
  private sourceBlockHeight = 0;
  private ghostEl: HTMLElement | null = null;
  private dragHandleEl: HTMLElement | null = null; // handle whose draggable we disabled
  private dropLineEl: HTMLElement | null = null;
  private currentTargetPos: number | null = null;
  private currentPlacement: "before" | "after" | null = null;
  private currentSide: "left" | "right" | "regular" = "regular";
  private pointerId: number | null = null;
  private rafId: number | null = null;

  // Latest pointer coordinates for rAF callback
  private latestPointerX = 0;
  private latestPointerY = 0;

  // Ghost offset: pointer position relative to block top-left, recorded at pointerdown.
  // Subtracted from clientX/Y in pointermove so the ghost stays at a fixed offset from the pointer.
  private ghostOffsetX = 0;
  private ghostOffsetY = 0;

  // Bound handler references for removal in destroy()
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerUpBound: (e: PointerEvent) => void;
  private onPointerCancelBound: (e: PointerEvent) => void;
  private onDragStartBound!: EventListener;
  private onKeyDownBound: (e: KeyboardEvent) => void;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private editorView: EditorView, private editor: BlockNoteEditor<any, any, any>) {
    // ── HTML5 drag listeners (ISS-048 path, preserved) ───────────────────────
    const names = ["dragover", "dragend", "drop", "dragleave"] as const;
    this.handlers = names.map((name) => {
      const handler = (e: Event) => this.handleEvent(name, e as DragEvent);
      editorView.dom.addEventListener(name, handler);
      return { name, handler };
    });

    // ── Pointer event listeners (REQ-086 path) ───────────────────────────────
    this.onPointerDownBound = (e) => this.onPointerDown(e);
    this.onPointerMoveBound = (e) => this.onPointerMove(e);
    this.onPointerUpBound = (e) => this.onPointerUp(e);
    this.onPointerCancelBound = (e) => this.onPointerCancel(e);

    // pointerdown must be on document because BlockNote's side menu (drag handle)
    // is rendered outside editorView.dom. Use CAPTURE phase so we receive the
    // event before BlockNote/ProseMirror handlers can stopPropagation().
    document.addEventListener("pointerdown", this.onPointerDownBound, true);
    // pointermove/up/cancel on document with CAPTURE phase so we receive
    // events before ProseMirror/BlockNote handlers can stopPropagation().
    document.addEventListener("pointermove", this.onPointerMoveBound, true);
    document.addEventListener("pointerup", this.onPointerUpBound, true);
    document.addEventListener("pointercancel", this.onPointerCancelBound, true);

    // Block dragstart on the drag handle so the browser doesn't take over HTML5 drag.
    this.onDragStartBound = (e: DragEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[draggable="true"]')?.closest(".bn-side-menu")) {
        e.preventDefault();
      }
    };
    document.addEventListener("dragstart", this.onDragStartBound as EventListener);

    // ── Escape key cancels drag (REQ-087 T1) ──────────────────────────────
    this.onKeyDownBound = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.isDragging) {
        e.preventDefault();
        this.cleanupDrag();
      }
    };
    document.addEventListener("keydown", this.onKeyDownBound);
  }

  // ── Pointer events implementation (REQ-086 T1) ──────────────────────────────

  private onPointerDown(e: PointerEvent) {
    console.log("[drag] POINTERDOWN target=%s", (e.target as HTMLElement)?.tagName);
    const target = e.target as HTMLElement | null;
    if (!target) { console.log("[drag] POINTERDOWN no target"); return; }
    const handle = target.closest('[draggable="true"]') as HTMLElement | null;
    if (!handle) { console.log("[drag] POINTERDOWN no draggable handle"); return; }
    if (!handle.closest(".bn-side-menu")) { console.log("[drag] POINTERDOWN not in side-menu"); return; }

    const sideMenuEl = handle.closest(".bn-side-menu") as HTMLElement | null;
    const sideMenuRect = sideMenuEl?.getBoundingClientRect();
    const probeX = sideMenuRect ? sideMenuRect.right + 20 : e.clientX + 40;
    const probeY = e.clientY;
    const blockOuter = (document.elementFromPoint(probeX, probeY) as HTMLElement | null)
      ?.closest("[data-node-type='blockOuter']") as HTMLElement | null;
    if (!blockOuter) return;

    const rect = blockOuter.getBoundingClientRect();
    this.ghostOffsetX = e.clientX - rect.left;
    this.ghostOffsetY = e.clientY - rect.top;
    this.sourceBlockHeight = rect.height;

    const blockId = blockOuter.getAttribute("data-id");
    if (!blockId) { console.log("[drag] POINTERDOWN no data-id on blockOuter"); return; }

    // Validate the block exists in the document and store its ID.
    const block = findBlockById(this.editor.document as any[], blockId);
    if (!block) { console.log("[drag] POINTERDOWN block not found in document"); return; }
    this.sourceBlockId = blockId;

    // Find the ProseMirror position of the source block by searching the doc.
    let foundPos = -1;
    this.editorView.state.doc.descendants((node, pos) => {
      if (node.attrs?.id === blockId) {
        foundPos = pos;
        return false;
      }
    });
    if (foundPos === -1) { console.log("[drag] POINTERDOWN block pos not found in doc"); return; }

    // Disable HTML5 drag on the handle.
    handle.draggable = false;
    this.dragHandleEl = handle;

    this.sourceBlockEl = blockOuter;
    this.sourceBlockPos = foundPos;
    this.isDragging = true;
    this.pointerId = e.pointerId;

    // Dim the source block as a placeholder — it stays in the document.
    blockOuter.style.opacity = "0.3";
    blockOuter.style.transition = "opacity 150ms ease";

    // Create ghost element: clone of the source block, fixed-positioned.
    const ghost = blockOuter.cloneNode(true) as HTMLElement;
    ghost.className = (ghost.className ? ghost.className + " " : "") + "bn-drag-ghost";
    ghost.style.cssText = [
      "position: fixed",
      "pointer-events: none",
      "opacity: 0.85",
      "z-index: 100",
      `left: ${rect.left}px`,
      `top: ${rect.top}px`,
      `width: ${rect.width}px`,
    ].join("; ");
    document.body.appendChild(ghost);
    this.ghostEl = ghost;

    document.body.style.userSelect = "none";
    console.log("[drag] START blockId=%s pos=%d height=%d", blockId, foundPos, this.sourceBlockHeight);
    console.log("[drag] START ghostOffset=(%d,%d) rect=(%d,%d,%d,%d)", this.ghostOffsetX, this.ghostOffsetY, rect.left, rect.top, rect.width, rect.height);
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.isDragging) return;
    console.log("[drag] POINTERMOVE x=%d y=%d", e.clientX, e.clientY);

    this.latestPointerX = e.clientX;
    this.latestPointerY = e.clientY;

    if (this.rafId !== null) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.isDragging || !this.ghostEl) return;

      const clientX = this.latestPointerX;
      const clientY = this.latestPointerY;

      // Update ghost position.
      this.ghostEl.style.left = `${clientX - this.ghostOffsetX}px`;
      this.ghostEl.style.top = `${clientY - this.ghostOffsetY}px`;

      // Hit-test for target block.
      const editorRect = this.editorView.dom.getBoundingClientRect();
      // When source is inside a column, use actual pointer X so the user can
      // target blocks in adjacent columns (cross-column drag).
      const sourceInColumn = !!this.sourceBlockEl?.closest("[data-node-type='column']");
      const hitX = sourceInColumn
        ? Math.max(editorRect.left + 1, Math.min(editorRect.right - 1, clientX))
        : editorRect.left + editorRect.width / 2;
      const hitY = Math.max(editorRect.top + 1, Math.min(editorRect.bottom - 1, clientY));
      const targetResult = getBlockPosFromPoint(this.editorView, hitX, hitY);
      if (!targetResult) {
        this._clearYieldTransforms();
        this._hideDropLine();
        removeOverlay();
        this.currentTargetPos = null;
        this.currentPlacement = null;
        this.currentSide = "regular";
        return;
      }

      const targetPos = targetResult.posBeforeNode;

      // Find target block's DOM element.
      const rawDom = this.editorView.nodeDOM(targetPos);
      let targetBlockOuter: HTMLElement | null = null;
      const allBlockOuters = Array.from(
        this.editorView.dom.querySelectorAll("[data-node-type='blockOuter']")
      ) as HTMLElement[];

      function findBoInSnapshot(raw: Element | null): HTMLElement | null {
        if (!raw) return null;
        const boEl = raw.closest("[data-node-type='blockOuter']") as HTMLElement | null;
        if (!boEl) return null;
        const id = boEl.getAttribute("data-id");
        if (id) return allBlockOuters.find(b => b.getAttribute("data-id") === id) ?? null;
        return allBlockOuters.find(b => b === boEl) ?? null;
      }

      targetBlockOuter = findBoInSnapshot(rawDom instanceof Element ? rawDom : null);
      if (!targetBlockOuter) {
        const elAtHit = document.elementFromPoint(hitX, hitY) as HTMLElement | null;
        targetBlockOuter = findBoInSnapshot(elAtHit);
      }
      if (!targetBlockOuter) {
        this._clearYieldTransforms();
        this._hideDropLine();
        removeOverlay();
        this.currentTargetPos = null;
        this.currentPlacement = null;
        this.currentSide = "regular";
        return;
      }

      // ── Side detection (column creation) ────────────────────────────────
      // Only for top-level blocks. When source is inside a column, the user
      // is doing cross-column reorder, not column creation.
      const SIDE_PX = 80;
      let side: "left" | "right" | "regular" = "regular";
      let sideRect: DOMRect | null = null;
      if (!sourceInColumn) {
        sideRect = targetBlockOuter.getBoundingClientRect();
        if (sideRect.width > 0) {
          if (clientX <= sideRect.left + SIDE_PX) {
            side = "left";
          } else if (clientX >= sideRect.right - SIDE_PX) {
            side = "right";
          }
        }
      }
      this.currentSide = side;

      // Side mode: show column overlay, no squeeze.
      if ((side === "left" || side === "right") && sideRect) {
        this.currentTargetPos = targetPos;
        this.currentPlacement = null;
        this._clearYieldTransforms();
        this._hideDropLine();
        showOverlay(sideRect, side);
        return;
      }

      // ── Regular mode: vertical reorder ──────────────────────────────────
      removeOverlay();

      const targetRect = targetBlockOuter.getBoundingClientRect();
      const placement: "before" | "after" = clientY < targetRect.top + targetRect.height / 2 ? "before" : "after";

      // Resolve source block ID early (needed for skip check and squeeze).
      const sourceId = this.sourceBlockEl?.getAttribute("data-id");

      // Skip if hovering over the source block itself (no gap needed).
      const targetBlockId = targetBlockOuter.getAttribute("data-id");
      if (targetBlockId && sourceId && targetBlockId === sourceId) {
        this.currentTargetPos = null;
        this.currentPlacement = null;
        this.currentSide = "regular";
        this._clearYieldTransforms();
        this._hideDropLine();
        return;
      }

      this.currentTargetPos = targetPos;
      this.currentPlacement = placement;

      // ── Squeeze animation (top-level blocks only) ───────────────────────
      // When source or target is inside a column, skip squeeze and just show
      // the drop line — column layout makes margin animation unreliable.
      const currentTopLevel = Array.from(
        this.editorView.dom.querySelectorAll("[data-node-type='blockOuter']")
      ).filter(b => !b.closest("[data-node-type='column']")) as HTMLElement[];

      let sourceIdx = -1;
      if (sourceId) {
        sourceIdx = currentTopLevel.findIndex(b => b.getAttribute("data-id") === sourceId);
        if (sourceIdx !== -1) {
          this.sourceBlockEl = currentTopLevel[sourceIdx];
        }
      }

      const targetIdx = currentTopLevel.indexOf(targetBlockOuter);

      if (targetIdx >= 0 && sourceIdx >= 0) {
        // Both top-level: do margin-based squeeze animation.
        const insertIdx = placement === "before" ? targetIdx : targetIdx + 1;

        for (const el of currentTopLevel) {
          el.style.marginTop = "";
          el.style.marginBottom = "";
          el.style.opacity = "";
          el.style.transition = "";
        }

        // Phase 1: hide source, pull blocks below up.
        const srcEl = currentTopLevel[sourceIdx];
        srcEl.style.opacity = "0";
        srcEl.style.marginBottom = `-${this.sourceBlockHeight}px`;
        srcEl.style.transition = "margin-bottom 150ms ease, opacity 150ms ease";

        // Phase 2: open gap at insert position.
        if (insertIdx < currentTopLevel.length) {
          const insEl = currentTopLevel[insertIdx];
          insEl.style.marginTop = `${this.sourceBlockHeight}px`;
          insEl.style.transition = "margin-top 150ms ease";
        } else if (currentTopLevel.length > 0) {
          const lastEl = currentTopLevel[currentTopLevel.length - 1];
          lastEl.style.marginBottom = `${this.sourceBlockHeight}px`;
          lastEl.style.transition = "margin-bottom 150ms ease";
        }

        console.log("[drag] MOVE srcIdx=%d tgtIdx=%d insIdx=%d placement=%s", sourceIdx, targetIdx, insertIdx, placement);
      } else {
        // Source or target inside a column: skip squeeze, just clear.
        this._clearYieldTransforms();
      }

      // Show drop placeholder box (same size as source block).
      if (!this.dropLineEl) {
        const box = document.createElement("div");
        box.className = "bn-drop-placeholder";
        document.body.appendChild(box);
        this.dropLineEl = box;
      }

      const outerRect = targetBlockOuter.getBoundingClientRect();
      const boxTop = placement === "before" ? targetRect.top : targetRect.bottom;

      this.dropLineEl.style.cssText = [
        `left: ${outerRect.left}px`,
        `top: ${boxTop}px`,
        `width: ${outerRect.width}px`,
        `height: ${this.sourceBlockHeight}px`,
        "display: block",
      ].join("; ");
    });
  }

  // ── T2 helpers ──────────────────────────────────────────────────────────────

  private _clearYieldTransforms() {
    const allBlockOuters = Array.from(
      this.editorView.dom.querySelectorAll("[data-node-type='blockOuter']")
    ) as HTMLElement[];
    for (const el of allBlockOuters) {
      el.style.marginTop = "";
      el.style.marginBottom = "";
      el.style.transition = "";
      el.style.opacity = "";
    }
  }

  private _hideDropLine() {
    if (this.dropLineEl) {
      if (this.dropLineEl.isConnected) {
        this.dropLineEl.parentNode?.removeChild(this.dropLineEl);
      }
      this.dropLineEl = null;
    }
  }

  // ── Drag cleanup ─────────────────────────────────────────────────────────────

  private cleanupDrag() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.ghostEl) {
      if (this.ghostEl.isConnected) {
        this.ghostEl.parentNode?.removeChild(this.ghostEl);
      }
      this.ghostEl = null;
    }

    this._clearYieldTransforms();
    this._hideDropLine();
    removeOverlay();

    if (this.dragHandleEl) {
      this.dragHandleEl.draggable = true;
      this.dragHandleEl = null;
    }

    this.sourceBlockEl = null;
    this.sourceBlockId = null;
    document.body.style.userSelect = "";

    this.isDragging = false;
    this.sourceBlockPos = 0;
    this.pointerId = null;
    this.currentTargetPos = null;
    this.currentPlacement = null;
    this.currentSide = "regular";
  }

  private onPointerUp(_e: PointerEvent) {
    if (!this.isDragging) return;
    console.log("[drag] POINTERUP targetPos=%d placement=%s side=%s", this.currentTargetPos, this.currentPlacement, this.currentSide);

    const targetPos = this.currentTargetPos;
    const placement = this.currentPlacement;
    const side = this.currentSide;
    const sourceBlockId = this.sourceBlockId;
    // Capture before cleanupDrag() nulls sourceBlockEl.
    const sourceInColumn = !!this.sourceBlockEl?.closest("[data-node-type='column']");

    // Resolve source block fresh from the document (matching HTML5 drag path).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sourceBlock: any = sourceBlockId
      ? findBlockById(this.editor.document as any[], sourceBlockId)
      : null;

    // Clean up visual state (ghost, transforms, opacity, drop line).
    this.cleanupDrag();

    if (!sourceBlock) return;

    // No valid drop target — source block returns to normal (cleanupDrag cleared transforms).
    if (targetPos === null) return;

    // ── Column drop path ──────────────────────────────────────────────────
    if (side === "left" || side === "right") {
      // Resolve target node for _commitColumnDrop.
      let targetNode: ReturnType<typeof this.editorView.state.doc.nodeAt> = null;
      let adjustedTargetPos = targetPos;
      try {
        const resolved = this.editorView.state.doc.resolve(targetPos);
        if (resolved.parent.type.name === "column" && resolved.depth >= 1) {
          const colListPos = resolved.before(resolved.depth - 1);
          const colListResolved = this.editorView.state.doc.resolve(colListPos);
          adjustedTargetPos = colListResolved.pos;
          targetNode = colListResolved.nodeAfter;
        } else {
          targetNode = resolved.nodeAfter;
        }
      } catch { /* keep original */ }
      this._commitColumnDrop(adjustedTargetPos, targetNode, sourceBlock, side);
      return;
    }

    // ── Regular (vertical) drop path ──────────────────────────────────────
    if (placement === null) return;

    // Resolve target block for insertBlocks.
    // Cross-column move: keep target inside its column so the block lands
    // in the adjacent column. Top-level→column: lift to columnList so the
    // block lands as a sibling of the column structure.
    let targetNode: ReturnType<typeof this.editorView.state.doc.nodeAt> = null;
    let adjustedTargetPos = targetPos;
    try {
      const resolved = this.editorView.state.doc.resolve(targetPos);
      if (resolved.parent.type.name === "column" && resolved.depth >= 1) {
        if (sourceInColumn) {
          // Cross-column: keep target inside the column.
          targetNode = resolved.nodeAfter;
        } else {
          // Top-level → column area: lift to columnList.
          const colListPos = resolved.before(resolved.depth - 1);
          const colListResolved = this.editorView.state.doc.resolve(colListPos);
          adjustedTargetPos = colListResolved.pos;
          targetNode = colListResolved.nodeAfter;
        }
      } else {
        targetNode = resolved.nodeAfter;
      }
    } catch { /* keep original */ }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let targetBlock: any = null;
    if (targetNode?.type.name === "columnList") {
      const colListId = targetNode.attrs?.id as string | undefined;
      if (colListId) {
        targetBlock = findBlockById(this.editor.document as any[], colListId);
      }
    }

    if (!targetBlock) {
      try {
        const nearestBlock = getNearestBlockPos(this.editorView.state.doc, adjustedTargetPos + 1);
        const targetInfo = getBlockInfo(nearestBlock);
        targetBlock = nodeToBlock(
          targetInfo.bnBlock.node,
          this.editor.schema.blockSchema,
          this.editor.schema.inlineContentSchema,
          this.editor.schema.styleSchema
        );
      } catch { /* fall through */ }
    }

    if (!targetBlock) return;
    if (sourceBlock.id === targetBlock.id) return;

    // Commit: remove from original position, insert at target.
    try {
      console.log("[drag] COMMIT src=%s tgt=%s placement=%s", sourceBlock.id, targetBlock.id, placement);
      this.editor.removeBlocks([sourceBlock]);
      this.editor.insertBlocks([sourceBlock], targetBlock, placement);
      console.log("[drag] COMMIT ok");
    } catch (err) {
      console.error("[drag] COMMIT failed", err);
    }
  }

  /**
   * Commit a column-creation drop: dragged block is placed beside the target
   * block in a new or existing columnList.
   * Mirrors the logic in handleMultiColumnDrop (HTML5 drag path) but reads
   * side from pointer-event state instead of lastDragoverSide.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _commitColumnDrop(targetPos: number, targetNode: any, sourceBlock: any, side: "left" | "right") {
    const schema = this.editor.schema;

    // If target lands on a columnList node, append a new column.
    if (targetNode?.type.name === "columnList") {
      const colListId = targetNode.attrs?.id as string | undefined;
      if (!colListId) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const columnListBlock: any = findBlockById(this.editor.document as any[], colListId);
      if (!columnListBlock) return;
      if (columnListBlock.id === sourceBlock.id) return;
      const insertIdx = side === "left" ? 0 : columnListBlock.children.length;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newChildren = columnListBlock.children.filter((col: any) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        !col.children.some((b: any) => b.id === sourceBlock.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ).filter((col: any) => col.children.length > 0);
      newChildren.splice(insertIdx, 0, {
        type: "column",
        children: [sourceBlock],
        props: { width: 1 },
        content: undefined,
        id: UniqueID.options.generateID(),
      });
      try {
        this.editor.removeBlocks([sourceBlock]);
        this.editor.updateBlock(columnListBlock, { children: newChildren });
      } catch { /* ignore */ }
      return;
    }

    // Resolve block info at the target position.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nearestBlock: any;
    try {
      nearestBlock = getNearestBlockPos(this.editorView.state.doc, targetPos + 1);
    } catch { return; }
    const blockInfo = getBlockInfo(nearestBlock);

    if (blockInfo.blockNoteType === "column") {
      // Target is already inside a column — append a new column to the columnList.
      const columnListNode = this.editorView.state.doc.resolve(blockInfo.bnBlock.beforePos).node();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let columnListBlock: any;
      try {
        columnListBlock = nodeToBlock(
          columnListNode,
          schema.blockSchema,
          schema.inlineContentSchema,
          schema.styleSchema
        );
      } catch { return; }

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
          children: col.children.filter((b: any) => b.id !== sourceBlock.id),
        }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((col: any) => col.children.length > 0);

      const insertIdx = side === "left" ? targetColIndex : targetColIndex + 1;
      newChildren.splice(insertIdx < 0 ? newChildren.length : insertIdx, 0, {
        type: "column",
        children: [sourceBlock],
        props: { width: 1 },
        content: undefined,
        id: UniqueID.options.generateID(),
      });

      try {
        this.editor.removeBlocks([sourceBlock]);
        this.editor.updateBlock(columnListBlock, { children: newChildren });
      } catch { /* ignore */ }
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
      } catch { return; }

      if (targetBlock.id === sourceBlock.id) return; // dragging onto itself

      const ordered = side === "left"
        ? [sourceBlock, targetBlock]
        : [targetBlock, sourceBlock];

      try {
        this.editor.removeBlocks([sourceBlock]);
        this.editor.replaceBlocks([targetBlock], [
          {
            type: "columnList",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            children: ordered.map((b: any) => ({ type: "column", children: [b] })),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ]);
      } catch { /* ignore */ }
    }
  }

  private onPointerCancel(_e: PointerEvent) {
    if (!this.isDragging) return;
    // Cancel: clean up visual state, source block returns to normal.
    this.cleanupDrag();
  }

  // ── HTML5 drag event handler (ISS-048 path, preserved) ──────────────────────

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
    let colListPos: number | null = null;
    let nodeType = "unknown";
    try {
      const info = getNearestBlockPos(this.editorView.state.doc, pos.pos);
      let resolved = this.editorView.state.doc.resolve(info.posBeforeNode);
      if (resolved.parent.type.name === "column" && resolved.depth >= 1) {
        // Remember the column pos for side detection, lift to columnList for overlay.
        colListPos = resolved.before(resolved.depth - 1);
        resolved = this.editorView.state.doc.resolve(colListPos);
      }
      blockPos = resolved.pos;
      nodeType = resolved.nodeAfter?.type.name ?? "unknown";
    } catch {
      return;
    }

    const blockEl = this.editorView.nodeDOM(blockPos) as HTMLElement | null;
    if (!blockEl) return;

    const rect = blockEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // For side detection: when inside a column use the column's DOM rect so that
    // dragging to the edge of a column correctly reads as left/right.
    // Use ProseMirror node DOM instead of elementFromPoint (which is blocked by drag image).
    let sideRect = rect;
    if (colListPos !== null) {
      try {
        const $pos = this.editorView.state.doc.resolve(colListPos);
        // colListPos is before the columnList; walk into the column that contains the cursor.
        // Find the column child whose DOM contains the x coordinate.
        const colListNode = $pos.nodeAfter;
        if (colListNode) {
          let colOffset = $pos.pos + 1; // start of columnList content
          for (let ci = 0; ci < colListNode.childCount; ci++) {
            const colNode = colListNode.child(ci);
            const colDom = this.editorView.nodeDOM(colOffset) as HTMLElement | null;
            if (colDom) {
              const cr = colDom.getBoundingClientRect();
              if (e.clientX >= cr.left && e.clientX <= cr.right) {
                if (cr.width > 0) sideRect = cr;
                break;
              }
            }
            colOffset += colNode.nodeSize;
          }
        }
      } catch { /* ignore */ }
    }

    let position: "left" | "right" | "regular";
    if (e.clientX <= sideRect.left + sideRect.width * SIDE_THRESHOLD) {
      position = "left";
    } else if (e.clientX >= sideRect.right - sideRect.width * SIDE_THRESHOLD) {
      position = "right";
    } else {
      position = "regular";
    }

    // Can't nest columnLists — treat left/right on a columnList as regular.
    if ((position === "left" || position === "right") && nodeType === "columnList") {
      position = "regular";
    }

    lastDragoverSide = position;
    showOverlay(rect, position);
  }

  destroy() {
    // Remove HTML5 drag listeners (ISS-048 path).
    this.handlers.forEach(({ name, handler }) =>
      this.editorView.dom.removeEventListener(name, handler)
    );
    removeOverlay();

    // Remove pointer event listeners (REQ-086 path).
    document.removeEventListener("pointerdown", this.onPointerDownBound, true);
    document.removeEventListener("pointermove", this.onPointerMoveBound, true);
    document.removeEventListener("pointerup", this.onPointerUpBound, true);
    document.removeEventListener("pointercancel", this.onPointerCancelBound, true);
    document.removeEventListener("dragstart", this.onDragStartBound);
    document.removeEventListener("keydown", this.onKeyDownBound);

    // Full cleanup of any in-progress drag.
    if (this.isDragging) {
      this.cleanupDrag();
    }
  }
}

const dropOverlayKey = new PluginKey("dropOverlay");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dropOverlayPlugin(editor: BlockNoteEditor<any, any, any>): Plugin {
  return new Plugin({
    key: dropOverlayKey,
    view(editorView) {
      return new DropOverlayView(editorView, editor);
    },
    props: {
      handleDrop(view, event, slice, _moved) {
        return handleMultiColumnDrop(view, event as DragEvent, slice, editor);
      },
    },
  });
}
