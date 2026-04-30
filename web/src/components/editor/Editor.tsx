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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toBlockNote(blocks: Block[]): any[] {
  return blocks.map((b) => {
    let content: unknown[] = [];
    try { content = JSON.parse(b.content) as unknown[]; } catch { /* empty */ }
    return { id: b.id, type: b.type, props: {}, content, children: [] };
  });
}

export function Editor({ pageId }: Props) {
  const editor = useCreateBlockNote();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyRef = useRef(false);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  const save = (pid: string) => {
    const dtos: Partial<Block>[] = editor.document.map((b, i) => ({
      id: b.id,
      page_id: pid,
      type: b.type,
      content: JSON.stringify(b.content ?? []),
      order_index: i,
    }));
    void api.blocks.batchUpdate(dtos);
  };

  useEffect(() => {
    readyRef.current = false;
    const currentPageId = pageId;
    let cancelled = false;

    void (async () => {
      const blocks = await api.blocks.listByPage(currentPageId);
      if (cancelled) return;
      if (blocks && blocks.length > 0) {
        try {
          editor.replaceBlocks(editor.document, toBlockNote(blocks));
        } catch {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          editor.replaceBlocks(editor.document, [{ type: "paragraph" }] as any);
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.replaceBlocks(editor.document, [{ type: "paragraph" }] as any);
      }
      readyRef.current = true;
    })();

    return () => {
      cancelled = true;
      // flush pending save on unmount / page switch
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (readyRef.current) {
        save(currentPageId);
      }
    };
  }, [pageId, editor]);

  const handleChange = () => {
    if (!readyRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(pageIdRef.current), 800);
  };

  useEffect(() => {
    const flush = () => save(pageIdRef.current);
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  return (
    <div className="editor-wrap">
      <BlockNoteView editor={editor} onChange={handleChange} />
    </div>
  );
}
