import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { getNearestBlockPos } from "@blocknote/core";

const SIDE_THRESHOLD = 0.15;
const OVERLAY_ID = "bn-drop-overlay-el";

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

export function dropOverlayPlugin(): Plugin {
  return new Plugin({
    key: dropOverlayKey,
    view(editorView) {
      return new DropOverlayView(editorView);
    },
  });
}
