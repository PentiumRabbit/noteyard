import "@blocknote/mantine/style.css";
import "@blocknote/react/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { api } from "../../api/client";
import type { Block } from "../../types";
import "./Editor.css";

export interface EditorHandle {
  flush: () => void;
}

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

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ pageId }, ref) {
  const editor = useCreateBlockNote();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const readyRef = useRef(false);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  const buildDtos = (pid: string): Partial<Block>[] =>
    editor.document.map((b, i) => ({
      id: b.id,
      page_id: pid,
      type: b.type,
      content: JSON.stringify(b.content ?? []),
      order_index: i,
    }));

  const save = (pid: string) => {
    if (!readyRef.current) return;
    void api.blocks.batchUpdate(buildDtos(pid));
  };

  // 暴露给父组件：切换页面前同步 flush
  useImperativeHandle(ref, () => ({
    flush: () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      save(pageIdRef.current);
    },
  }));

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

    // 30s 定时兜底保存
    heartbeatTimer.current = setInterval(() => save(currentPageId), 30_000);

    return () => {
      cancelled = true;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      // unmount 时同步 flush（页面切换/关闭）
      if (readyRef.current) save(currentPageId);
    };
  }, [pageId, editor]);

  const handleChange = () => {
    if (!readyRef.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => save(pageIdRef.current), 1000);
  };

  // beforeunload 用 sendBeacon，不会被浏览器截断
  useEffect(() => {
    const flush = () => api.blocks.batchUpdateBeacon(buildDtos(pageIdRef.current));
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  return (
    <div className="editor-wrap">
      <BlockNoteView editor={editor} onChange={handleChange} />
    </div>
  );
});
