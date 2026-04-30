import "@blocknote/mantine/style.css";
import "@blocknote/react/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import {
  SuggestionMenuController,
  createReactBlockSpec,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
} from "@blocknote/react";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  insertOrUpdateBlock,
} from "@blocknote/core";
import type { BlockNoteEditor } from "@blocknote/core";
import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { api } from "../../api/client";
import type { Block } from "../../types";
import { DatabaseView } from "../database/DatabaseView";
import "./Editor.css";

export interface EditorHandle {
  flush: () => void;
}

interface Props {
  pageId: string;
}

// Database 自定义块：props 存 databaseId，渲染时调用后端
const DatabaseBlock = createReactBlockSpec(
  {
    type: "database" as const,
    propSchema: {
      databaseId: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const dbId = block.props.databaseId;
      if (!dbId) return <div style={{ color: "#aaa", padding: 8 }}>Database 初始化中…</div>;
      return <DatabaseView databaseId={dbId} />;
    },
  },
);

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    database: DatabaseBlock,
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toBlockNote(blocks: Block[]): any[] {
  return blocks.map((b) => {
    if (b.type === "database") {
      let props: Record<string, string> = {};
      try { props = JSON.parse(b.content) as Record<string, string>; } catch { /* empty */ }
      return { id: b.id, type: "database", props, content: undefined, children: [] };
    }
    let content: unknown[] = [];
    try { content = JSON.parse(b.content) as unknown[]; } catch { /* empty */ }
    return { id: b.id, type: b.type, props: {}, content, children: [] };
  });
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ pageId }, ref) {
  const editor = useCreateBlockNote({ schema });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const readyRef = useRef(false);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  const buildDtos = (pid: string): Partial<Block>[] =>
    editor.document.flatMap((b, i) => {
      if (b.type === "database") {
        // database 块 content 由插入时写入后端，编辑器不覆盖（防止 flush 写入空 databaseId）
        const dbId = (b.props as { databaseId?: string }).databaseId;
        if (!dbId) return [];
        return [{ id: b.id, page_id: pid, type: b.type, content: JSON.stringify(b.props), order_index: i }];
      }
      return [{ id: b.id, page_id: pid, type: b.type, content: JSON.stringify((b as { content?: unknown }).content ?? []), order_index: i }];
    });

  const save = (pid: string) => {
    if (!readyRef.current) return;
    void api.blocks.batchUpdate(buildDtos(pid));
  };

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          editor.replaceBlocks(editor.document, toBlockNote(blocks) as any);
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

    heartbeatTimer.current = setInterval(() => save(currentPageId), 30_000);

    return () => {
      cancelled = true;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (readyRef.current) save(currentPageId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const handleChange = () => {
    if (!readyRef.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => save(pageIdRef.current), 1000);
  };

  useEffect(() => {
    const flush = () => api.blocks.batchUpdateBeacon(buildDtos(pageIdRef.current));
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="editor-wrap">
      <BlockNoteView editor={editor} onChange={handleChange} slashMenu={false}>
        <DatabaseSlashItem editor={editor} pageId={pageId} />
      </BlockNoteView>
    </div>
  );
});

// 斜杠菜单：默认项 + database 项
function DatabaseSlashItem({
  editor,
  pageId,
}: {
  editor: BlockNoteEditor<typeof schema.blockSchema>;
  pageId: string;
}) {
  return (
    <SuggestionMenuController
      triggerCharacter="/"
      getItems={async (query) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const defaults = getDefaultReactSlashMenuItems(editor as any);
        const dbItem = {
          title: "Database",
          onItemClick: async () => {
            // 先创建 block 拿到 ID，再以该 ID 创建 database（外键约束）
            const block = await api.blocks.create(pageId, { type: "database", content: "{}", order_index: 9999 });
            const db = await api.databases.create({ id: block.id, page_id: pageId, title: "新建数据库" });
            // 更新 block content 存入 databaseId，供持久化后恢复
            await api.blocks.update(block.id, { content: JSON.stringify({ databaseId: db.id }) });
            insertOrUpdateBlock(editor, {
              type: "database",
              props: { databaseId: db.id },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
          },
          aliases: ["database", "table", "db", "数据库"],
          group: "其他",
          icon: <span>🗄</span>,
          hint: "插入数据库表格块",
        };
        const all = [...defaults, dbItem];
        const q = query.toLowerCase();
        return all.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            (item.aliases ?? []).some((a: string) => a.toLowerCase().includes(q)),
        );
      }}
    />
  );
}
