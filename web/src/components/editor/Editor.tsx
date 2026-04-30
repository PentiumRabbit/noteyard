import "@blocknote/mantine/style.css";
import "@blocknote/react/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useRef } from "react";
import { api } from "../../api/client";
import type { Block } from "../../types";
import "./Editor.css";

interface Props {
  pageId: string;
}

function blocksToBlockNote(blocks: Block[]) {
  if (!blocks || blocks.length === 0) return undefined;
  try {
    return blocks.map((b) => ({
      id: b.id,
      type: b.type as any,
      props: {},
      content: JSON.parse(b.content || "[]"),
      children: [],
    }));
  } catch {
    return undefined;
  }
}

export function Editor({ pageId }: Props) {
  const editor = useCreateBlockNote();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedPageId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadBlocks() {
      const blocks = await api.blocks.listByPage(pageId);
      if (cancelled) return;
      const bn = blocksToBlockNote(blocks ?? []);
      if (bn && bn.length > 0) {
        editor.replaceBlocks(editor.document, bn);
      } else {
        editor.replaceBlocks(editor.document, [
          { type: "paragraph", content: [] },
        ] as any);
      }
      loadedPageId.current = pageId;
    }
    loadBlocks();
    return () => { cancelled = true; };
  }, [pageId]);

  const handleChange = () => {
    if (loadedPageId.current !== pageId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(), 800);
  };

  const save = async () => {
    const blocks = editor.document;
    const dtos: Partial<Block>[] = blocks.map((b, i) => ({
      id: b.id,
      page_id: pageId,
      type: b.type,
      content: JSON.stringify(b.content ?? []),
      order_index: i,
    }));
    await api.blocks.batchUpdate(dtos);
  };

  useEffect(() => {
    const onUnload = () => save();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [pageId]);

  return (
    <div className="editor-wrap">
      <BlockNoteView editor={editor} onChange={handleChange} />
    </div>
  );
}
