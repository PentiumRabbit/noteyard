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
  private sourceOverlayEl: HTMLElement | null = null; // dim overlay over source block
  private ghostEl: HTMLElement | null = null;
  private dropLineEl: HTMLElement | null = null;
  private currentTargetPos: number | null = null;
  private currentPlacement: "before" | "after" | null = null;
  private pointerId: number | null = null;
  private rafId: number | null = null;

  // Latest pointer coordinates for rAF callback
  private latestPointerX = 0;
  private latestPointerY = 0;

  // Bound handler references for removal in destroy()
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerUpBound: (e: PointerEvent) => void;
  private onPointerCancelBound: (e: PointerEvent) => void;
  private onDragStartBound!: EventListener;

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
    // is rendered outside editorView.dom.
    document.addEventListener("pointerdown", this.onPointerDownBound);
    // pointermove/up/cancel on document so we keep receiving events during drag.
    document.addEventListener("pointermove", this.onPointerMoveBound);
    document.addEventListener("pointerup", this.onPointerUpBound);
    document.addEventListener("pointercancel", this.onPointerCancelBound);

    // Block dragstart on the drag handle so the browser doesn't take over HTML5 drag.
    this.onDragStartBound = (e: DragEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[draggable="true"]')?.closest(".bn-side-menu")) {
        e.preventDefault();
      }
    };
    document.addEventListener("dragstart", this.onDragStartBound as EventListener);
  }

  // ── Pointer events implementation (REQ-086 T1) ──────────────────────────────

  private onPointerDown(e: PointerEvent) {
    // Only activate on the BlockNote drag handle button.
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // BlockNote's drag handle is the draggable="true" button inside .bn-side-menu.
    // It does not have a stable data attribute, so we detect it by draggable + side menu parent.
    const handle = target.closest('[draggable="true"]') as HTMLElement | null;
    if (!handle) return;
    if (!handle.closest(".bn-side-menu")) return;

    // Find the blockOuter wrapper: side menu sits outside blockOuter, use posAtCoords.
    const sideMenuEl = handle.closest(".bn-side-menu") as HTMLElement | null;
    const sideMenuRect = sideMenuEl?.getBoundingClientRect();
    // blockOuter is to the right of the side menu at the same Y level
    const probeX = sideMenuRect ? sideMenuRect.right + 20 : e.clientX + 40;
    const probeY = e.clientY;
    const blockOuter = (document.elementFromPoint(probeX, probeY) as HTMLElement | null)
      ?.closest("[data-node-type='blockOuter']") as HTMLElement | null;
    if (!blockOuter) return;

    // Resolve the ProseMirror position of this block via getBlockPosFromPoint.
    // Use the center of the blockOuter rect to avoid edge-case misses.
    const rect = blockOuter.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const blockPos = getBlockPosFromPoint(this.editorView, cx, cy);
    if (!blockPos) return;

    // Prevent the browser from taking over with HTML5 drag-and-drop.
    // Without this, draggable="true" causes the browser to fire dragstart and
    // stop delivering pointermove events to us.
    e.preventDefault();

    this.sourceBlockEl = blockOuter;
    this.sourceBlockPos = blockPos.posBeforeNode;
    this.isDragging = true;
    this.pointerId = e.pointerId;

    // Create ghost element: clone of the source block, fixed-positioned.
    const ghost = blockOuter.cloneNode(true) as HTMLElement;
    ghost.className = (ghost.className ? ghost.className + " " : "") + "bn-drag-ghost";
    ghost.style.cssText = [
      "position: fixed",
      "pointer-events: none",
      "opacity: 0.6",
      "z-index: 100",
      `left: ${rect.left}px`,
      `top: ${rect.top}px`,
      `width: ${rect.width}px`,
    ].join("; ");
    document.body.appendChild(ghost);
    this.ghostEl = ghost;

    // Overlay a semi-transparent div over the source block to dim it.
    // Using a separate DOM element avoids React re-render resets on BlockNote's managed DOM.
    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position: fixed",
      "pointer-events: none",
      "z-index: 99",
      "background: rgba(255,255,255,0.55)",
      `left: ${rect.left}px`,
      `top: ${rect.top}px`,
      `width: ${rect.width}px`,
      `height: ${rect.height}px`,
    ].join("; ");
    document.body.appendChild(overlay);
    this.sourceOverlayEl = overlay;

    // Prevent text selection during drag.
    document.body.style.userSelect = "none";

    // Capture pointer so we receive pointermove/pointerup even outside the element.
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Degraded gracefully: pointermove may be lost at edges, but no crash.
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.isDragging) return;

    // Record latest coordinates; actual DOM update is throttled via rAF.
    this.latestPointerX = e.clientX;
    this.latestPointerY = e.clientY;

    if (this.rafId !== null) return; // already scheduled

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.isDragging || !this.ghostEl) return;

      const clientX = this.latestPointerX;
      const clientY = this.latestPointerY;

      // Update ghost position to follow pointer.
      this.ghostEl.style.left = `${clientX}px`;
      this.ghostEl.style.top = `${clientY}px`;

      // ── T2: target-block hit-test ──────────────────────────────────────────
      // Use the editor's horizontal center for hit-testing so we always land
      // inside the editor regardless of where the drag handle is (left of editor).
      // Also clamp Y to editor bounds so we don't miss blocks when dragging past edges.
      const editorRect = this.editorView.dom.getBoundingClientRect();
      const hitX = editorRect.left + editorRect.width / 2;
      const hitY = Math.max(editorRect.top + 1, Math.min(editorRect.bottom - 1, clientY));
      const targetResult = getBlockPosFromPoint(this.editorView, hitX, hitY);
      if (!targetResult || !this.sourceBlockEl) return;

      const targetPos = targetResult.posBeforeNode;

      // Skip if hovering over the source block itself.
      if (targetPos === this.sourceBlockPos) {
        this.currentTargetPos = null;
        this.currentPlacement = null;
        this._clearYieldTransforms();
        this._hideDropLine();
        return;
      }

      // ── T2: translateY yield calculation ──────────────────────────────────
      // Collect all blockOuter elements first (before any DOM mutation).
      // Include all blockOuters for index-based lookup, but yield only top-level ones.
      const allBlockOuters = Array.from(
        this.editorView.dom.querySelectorAll("[data-node-type='blockOuter']")
      ) as HTMLElement[];
      // Top-level blockOuters (not inside a column) are the ones we animate.
      const topLevelBlockOuters = allBlockOuters.filter(
        b => !b.closest("[data-node-type='column']")
      );

      // Find source in topLevel list; re-find by data-id if React re-rendered the DOM.
      let sourceIdx = topLevelBlockOuters.indexOf(this.sourceBlockEl);
      if (sourceIdx === -1 && this.sourceBlockEl) {
        const sourceId = this.sourceBlockEl.getAttribute("data-id");
        if (sourceId) {
          const found = topLevelBlockOuters.find(b => b.getAttribute("data-id") === sourceId)
                     || allBlockOuters.find(b => b.getAttribute("data-id") === sourceId);
          if (found) {
            this.sourceBlockEl = found;
            sourceIdx = topLevelBlockOuters.indexOf(found);
          }
        }
      }
      if (sourceIdx === -1) return;

      // Resolve target blockOuter from the pre-built allBlockOuters snapshot using data-id
      // to avoid React re-render reference mismatches between nodeDOM and querySelectorAll results.
      function findBoInSnapshot(raw: Element | null): HTMLElement | null {
        if (!raw) return null;
        const boEl = raw.closest("[data-node-type='blockOuter']") as HTMLElement | null;
        if (!boEl) return null;
        const id = boEl.getAttribute("data-id");
        if (id) {
          return allBlockOuters.find(b => b.getAttribute("data-id") === id) ?? null;
        }
        return allBlockOuters.find(b => b === boEl) ?? null;
      }

      const rawDom = this.editorView.nodeDOM(targetPos);
      let targetBlockOuter = findBoInSnapshot(rawDom instanceof Element ? rawDom : null);
      if (!targetBlockOuter) {
        const elAtHit = document.elementFromPoint(hitX, hitY) as HTMLElement | null;
        targetBlockOuter = findBoInSnapshot(elAtHit);
      }
      if (!targetBlockOuter) return;

      const targetRect = targetBlockOuter.getBoundingClientRect();
      const placement: "before" | "after" = clientY < targetRect.top + targetRect.height / 2 ? "before" : "after";

      this.currentTargetPos = targetPos;
      this.currentPlacement = placement;

      // Yield animation: use Y-coordinate comparison so we don't depend on
      // snapshot indices that can become stale after React re-renders.
      const sourceRect = this.sourceBlockEl.getBoundingClientRect();
      const sourceTop = sourceRect.top;
      const sourceHeight = sourceRect.height;
      const targetTop = targetRect.top;
      const draggingDown = targetTop > sourceTop;

      // Threshold Y values for yield range
      const yieldAbove = draggingDown ? sourceTop : (placement === "before" ? targetTop : targetTop + targetRect.height);
      const yieldBelow = draggingDown ? (placement === "after" ? targetTop + targetRect.height : targetTop) : sourceTop;

      // Re-query current DOM to get fresh top-level blockOuters
      const currentTopLevel = Array.from(
        this.editorView.dom.querySelectorAll("[data-node-type='blockOuter']")
      ).filter(b => !b.closest("[data-node-type='column']")) as HTMLElement[];

      for (const el of currentTopLevel) {
        if (el === this.sourceBlockEl) continue;
        const elId = el.getAttribute("data-id");
        if (elId && this.sourceBlockEl.getAttribute("data-id") === elId) continue;
        const elRect = el.getBoundingClientRect();
        const elMid = elRect.top + elRect.height / 2;
        const shouldYield = draggingDown
          ? (elMid > sourceTop && elMid <= yieldBelow)
          : (elMid < sourceTop && elMid >= yieldAbove);
        const delta = draggingDown ? -sourceHeight : sourceHeight;
        if (shouldYield) {
          el.style.transform = `translateY(${delta}px)`;
          el.style.transition = "transform 150ms ease";
        } else {
          el.style.transform = "translateY(0px)";
          el.style.transition = "transform 150ms ease";
        }
      }

      // ── T2: drop line indicator ────────────────────────────────────────────
      if (!this.dropLineEl) {
        const line = document.createElement("div");
        line.className = "bn-drop-line";
        document.body.appendChild(line);
        this.dropLineEl = line;
      }

      // Align drop line with the targetBlockOuter's left/width.
      const outerRect = targetBlockOuter.getBoundingClientRect();
      const lineTop = placement === "before" ? targetRect.top : targetRect.bottom;

      this.dropLineEl.style.cssText = [
        `left: ${outerRect.left}px`,
        `top: ${lineTop}px`,
        `width: ${outerRect.width}px`,
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
      el.style.transform = "";
      el.style.transition = "";
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
    // Cancel any pending rAF.
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Remove ghost from DOM.
    if (this.ghostEl) {
      if (this.ghostEl.isConnected) {
        this.ghostEl.parentNode?.removeChild(this.ghostEl);
      }
      this.ghostEl = null;
    }

    // Clear yield transforms and drop line (T2 cleanup).
    this._clearYieldTransforms();
    this._hideDropLine();

    // Remove source dim overlay.
    if (this.sourceOverlayEl) {
      if (this.sourceOverlayEl.isConnected) this.sourceOverlayEl.parentNode?.removeChild(this.sourceOverlayEl);
      this.sourceOverlayEl = null;
    }
    this.sourceBlockEl = null;

    // Restore text selection.
    document.body.style.userSelect = "";

    // Reset state.
    this.isDragging = false;
    this.sourceBlockPos = 0;
    this.pointerId = null;
    this.currentTargetPos = null;
    this.currentPlacement = null;
  }

  private onPointerUp(_e: PointerEvent) {
    if (!this.isDragging) return;

    // Capture commit targets before cleanupDrag() resets state.
    const targetPos = this.currentTargetPos;
    const placement = this.currentPlacement;
    const sourceBlockPos = this.sourceBlockPos;

    // Clean up all visual state first (ghost, transforms, opacity, userSelect).
    this.cleanupDrag();

    // No valid drop target — nothing to commit.
    if (targetPos === null || placement === null) return;

    // Resolve source block from the editor document.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sourceBlock: any = null;
    try {
      const $src = this.editorView.state.doc.resolve(sourceBlockPos + 1);
      for (let d = $src.depth; d >= 0; d--) {
        const node = $src.node(d);
        if (node.attrs?.id) {
          sourceBlock = findBlockById(this.editor.document as any[], node.attrs.id as string);
          if (sourceBlock) break;
        }
      }
    } catch { /* fall through */ }
    if (!sourceBlock) return;

    // Resolve target block from the editor document.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let targetBlock: any = null;
    try {
      const nearestBlock = getNearestBlockPos(this.editorView.state.doc, targetPos + 1);
      const targetInfo = getBlockInfo(nearestBlock);
      targetBlock = nodeToBlock(
        targetInfo.bnBlock.node,
        this.editor.schema.blockSchema,
        this.editor.schema.inlineContentSchema,
        this.editor.schema.styleSchema
      );
    } catch { /* fall through */ }
    if (!targetBlock) return;

    // Guard: no-op if source and target are the same block.
    if (sourceBlock.id === targetBlock.id) return;

    // Commit the ProseMirror transaction via BlockNote API.
    try {
      this.editor.removeBlocks([sourceBlock]);
      this.editor.insertBlocks([sourceBlock], targetBlock, placement);
    } catch {
      // Transaction failed — visual state is already cleaned up by cleanupDrag().
      // No further action needed; the block stays in its original position.
    }
  }

  private onPointerCancel(_e: PointerEvent) {
    if (!this.isDragging) return;
    // Cancel: clean up without committing any transaction.
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
    document.removeEventListener("pointerdown", this.onPointerDownBound);
    document.removeEventListener("pointermove", this.onPointerMoveBound);
    document.removeEventListener("pointerup", this.onPointerUpBound);
    document.removeEventListener("pointercancel", this.onPointerCancelBound);
    document.removeEventListener("dragstart", this.onDragStartBound);

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
