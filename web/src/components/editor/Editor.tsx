import "@blocknote/mantine/style.css";
import "@blocknote/react/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import {
  SuggestionMenuController,
  FormattingToolbar,
  FormattingToolbarController,
  BasicTextStyleButton,
  TextAlignButton,
  ColorStyleButton,
  NestBlockButton,
  UnnestBlockButton,
  BlockTypeSelect,
  CreateLinkButton,
  createReactBlockSpec,
  createReactInlineContentSpec,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
} from "@blocknote/react";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  insertOrUpdateBlock,
  locales,
} from "@blocknote/core";
import type { BlockNoteEditor } from "@blocknote/core";
import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { api } from "../../api/client";
import { pinyinMatch } from "../../utils/pinyinMatch";
import type { Block } from "../../types";
import { DatabaseView } from "../database/DatabaseView";
import { useSettings } from "../../settings/settingsStore";
import "./Editor.css";

export interface EditorHandle {
  flush: () => void;
}

interface Props {
  pageId: string;
  onSelectPage?: (id: string) => void;
}

// T05 — Mention 内联块（@页面链接）
const MentionInlineContent = createReactInlineContentSpec(
  {
    type: "mention" as const,
    propSchema: { pageId: { default: "" }, title: { default: "" }, icon: { default: "📄" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => (
      <span
        className="mention-inline"
        data-page-id={inlineContent.props.pageId}
        title={inlineContent.props.title}
      >
        {inlineContent.props.icon} {inlineContent.props.title || "Untitled"}
      </span>
    ),
  },
);

// T01 — HorizontalRule 自定义块
const HorizontalRuleBlock = createReactBlockSpec(
  {
    type: "horizontalRule" as const,
    propSchema: {},
    content: "none",
  },
  {
    render: () => (
      <hr style={{ border: "none", borderTop: "1px solid #e9e9e7", margin: "4px 0" }} />
    ),
  },
);

// T02 — Quote 自定义块
const QuoteBlock = createReactBlockSpec(
  {
    type: "quote" as const,
    propSchema: {},
    content: "inline",
  },
  {
    render: ({ contentRef }) => (
      <div
        style={{
          borderLeft: "3px solid #d3d3d3",
          paddingLeft: "12px",
          paddingTop: "2px",
          paddingBottom: "2px",
          color: "inherit",
        }}
        ref={contentRef}
      />
    ),
  },
);

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

// T03 — Callout 自定义块
const CALLOUT_EMOJIS = ["💡", "📌", "⚠️", "✅", "❌", "🔥", "💬", "📝", "🎯", "🚀"];

const CalloutBlock = createReactBlockSpec(
  {
    type: "callout" as const,
    propSchema: { icon: { default: "💡" } },
    content: "inline",
  },
  {
    render: ({ block, contentRef }) => {
      const [pickerOpen, setPickerOpen] = React.useState(false);
      return (
        <div className="callout-block">
          <div className="callout-icon-wrap" style={{ position: "relative" }}>
            <button className="callout-icon-btn" onClick={() => setPickerOpen(v => !v)}>
              {block.props.icon}
            </button>
            {pickerOpen && (
              <div className="callout-emoji-picker">
                {CALLOUT_EMOJIS.map(e => (
                  <button key={e} className="callout-emoji-opt"
                    onMouseDown={ev => { ev.preventDefault(); block.props.icon = e; setPickerOpen(false); }}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="callout-content" ref={contentRef} />
        </div>
      );
    },
  },
);

// T04 — Toggle 自定义块
const ToggleBlock = createReactBlockSpec(
  {
    type: "toggle" as const,
    propSchema: { open: { default: "true" }, summary: { default: "折叠块" } },
    content: "inline",
  },
  {
    render: ({ block, contentRef }) => {
      const isOpen = block.props.open !== "false";
      return (
        <div className="toggle-block">
          <div className="toggle-header">
            <button
              className={`toggle-arrow${isOpen ? " open" : ""}`}
              onMouseDown={ev => { ev.preventDefault(); block.props.open = isOpen ? "false" : "true"; }}
            >▶</button>
            <span className="toggle-summary" ref={contentRef} />
          </div>
        </div>
      );
    },
  },
);

// T07 — Columns 分栏块（每列一个 mini BlockNote 实例）
const ColumnsBlock = createReactBlockSpec(
  {
    type: "columns" as const,
    propSchema: {
      cols: { default: "2" },
      // 每列内容序列化为 JSON，最多 4 列，columnsData = JSON.stringify(string[][])
      columnsData: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, updateBlock }) => {
      const numCols = Math.max(2, Math.min(4, parseInt(block.props.cols || "2", 10)));
      let initialData: string[][] = [];
      try { initialData = JSON.parse(block.props.columnsData) as string[][]; } catch { /* empty */ }
      while (initialData.length < numCols) initialData.push([]);

      const saveColData = (colIdx: number, content: string) => {
        const next = [...initialData];
        next[colIdx] = JSON.parse(content) as string[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updateBlock({ props: { ...block.props, columnsData: JSON.stringify(next) } } as any);
      };

      return (
        <div className="columns-block" style={{ gridTemplateColumns: `repeat(${numCols}, 1fr)` }}>
          {Array.from({ length: numCols }).map((_, i) => (
            <ColumnCell
              key={i}
              colIndex={i}
              initialContent={JSON.stringify(initialData[i] ?? [])}
              onSave={saveColData}
            />
          ))}
        </div>
      );
    },
  },
);

function ColumnCell({ colIndex, initialContent, onSave }: {
  colIndex: number;
  initialContent: string;
  onSave: (idx: number, content: string) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const miniEditor = useCreateBlockNote({ schema: BlockNoteSchema.create({ blockSpecs: defaultBlockSpecs }) as any });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    setTimeout(() => {
      try {
        let blocks: unknown[] = [];
        try { blocks = JSON.parse(initialContent) as unknown[]; } catch { /* empty */ }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        miniEditor.replaceBlocks(miniEditor.document, (blocks.length > 0 ? blocks : [{ type: "paragraph" }]) as any);
      } catch { /* empty */ }
      requestAnimationFrame(() => { readyRef.current = true; });
    }, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = () => {
    if (!readyRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onSave(colIndex, JSON.stringify(miniEditor.document));
    }, 800);
  };

  return (
    <div className="column-cell">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <BlockNoteView editor={miniEditor as any} onChange={handleChange} slashMenu={true} formattingToolbar={true} />
    </div>
  );
}

// T06 — schema 注册（块 + 内联）
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    horizontalRule: HorizontalRuleBlock,
    quote: QuoteBlock,
    database: DatabaseBlock,
    callout: CalloutBlock,
    toggle: ToggleBlock,
    columns: ColumnsBlock,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: MentionInlineContent,
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toBlockNote(blocks: Block[]): any[] {
  return blocks.map((b) => {
    if (b.type === "database" || b.type === "columns") {
      let props: Record<string, unknown> = {};
      try { props = JSON.parse(b.content) as Record<string, unknown>; } catch { /* empty */ }
      return { id: b.id, type: b.type, props, content: undefined, children: [] };
    }
    let content: unknown[] = [];
    try { content = JSON.parse(b.content) as unknown[]; } catch { /* empty */ }
    let props: Record<string, unknown> = {};
    try { if (b.props && b.props !== "null") props = JSON.parse(b.props) as Record<string, unknown>; } catch { /* empty */ }
    if (props === null || typeof props !== "object") props = {};
    return { id: b.id, type: b.type, props, content, children: [] };
  });
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ pageId, onSelectPage }, ref) {
  const { themeId } = useSettings();
  const bnTheme = themeId === "dark" ? "dark" : "light";
  const editor = useCreateBlockNote({
    schema,
    dictionary: locales.zh,
    uploadFile: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:8080/api/uploads", { method: "POST", body: form });
      if (!res.ok) throw new Error("图片上传失败");
      const data = await res.json() as { url: string };
      return data.url;
    },
  });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const readyRef = useRef(false);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  const buildDtos = (pid: string): Partial<Block>[] =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.document as any[]).flatMap((b: any, i: number): Partial<Block>[] => {
      if (b.type === "database") {
        const dbId = (b.props as { databaseId?: string }).databaseId;
        if (!dbId) return [];
        return [{ id: b.id, page_id: pid, type: b.type, content: JSON.stringify(b.props), props: "{}", order_index: i }];
      }
      if (b.type === "columns") {
        return [{ id: b.id, page_id: pid, type: b.type, content: JSON.stringify(b.props), props: "{}", order_index: i }];
      }
      return [{ id: b.id, page_id: pid, type: b.type, content: JSON.stringify((b as { content?: unknown }).content ?? []), props: JSON.stringify((b as { props?: unknown }).props ?? {}), order_index: i }];
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
      // 方案A：延迟到下一个宏任务，确保 BlockNote 编辑器实例完成内部初始化
      setTimeout(() => {
        if (cancelled) return;
        try {
          const bn = blocks && blocks.length > 0
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? toBlockNote(blocks) as any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            : [{ type: "paragraph" }] as any;
          editor.replaceBlocks(editor.document, bn);
        } catch (err) {
          console.error("[Editor] replaceBlocks failed", err);
        }
        requestAnimationFrame(() => { readyRef.current = true; });
      }, 0);
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

  useEffect(() => {
    if (!onSelectPage) return;
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".mention-inline");
      if (!el) return;
      const pid = el.dataset.pageId;
      if (pid) { e.preventDefault(); onSelectPage(pid); }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [onSelectPage]);

  return (
    <div className="editor-wrap">
      <BlockNoteView editor={editor} onChange={handleChange} slashMenu={false} formattingToolbar={false} theme={bnTheme}>
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar>
              <BlockTypeSelect key="blockTypeSelect" />
              <BasicTextStyleButton basicTextStyle="bold" key="bold" />
              <BasicTextStyleButton basicTextStyle="italic" key="italic" />
              <BasicTextStyleButton basicTextStyle="underline" key="underline" />
              <BasicTextStyleButton basicTextStyle="strike" key="strike" />
              <BasicTextStyleButton basicTextStyle="code" key="code" />
              <TextAlignButton textAlignment="left" key="left" />
              <TextAlignButton textAlignment="center" key="center" />
              <TextAlignButton textAlignment="right" key="right" />
              <ColorStyleButton key="color" />
              <NestBlockButton key="nest" />
              <UnnestBlockButton key="unnest" />
              <CreateLinkButton key="link" />
            </FormattingToolbar>
          )}
        />
        <DatabaseSlashItem editor={editor} pageId={pageId} />
        <MentionMenu editor={editor} onSelectPage={onSelectPage} />
      </BlockNoteView>
    </div>
  );
});

// 斜杠菜单：默认项 + database + divider + quote
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
            const block = await api.blocks.create(pageId, { type: "database", content: "{}", order_index: 9999 });
            const db = await api.databases.create({ id: block.id, page_id: pageId, title: "新建数据库" });
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
        const dividerItem = {
          title: "Divider",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onItemClick: () => insertOrUpdateBlock(editor, { type: "horizontalRule" } as any),
          aliases: ["divider", "hr", "分隔线", "---"],
          group: "基础块",
          icon: <span>—</span>,
          hint: "插入水平分隔线",
        };
        const quoteItem = {
          title: "Quote",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onItemClick: () => insertOrUpdateBlock(editor, { type: "quote" } as any),
          aliases: ["quote", "blockquote", "引用"],
          group: "基础块",
          icon: <span>❝</span>,
          hint: "插入引用块",
        };
        const calloutItem = {
          title: "Callout",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onItemClick: () => insertOrUpdateBlock(editor, { type: "callout", props: { icon: "💡" } } as any),
          aliases: ["callout", "标注", "提示", "note"],
          group: "基础块",
          icon: <span>💡</span>,
          hint: "插入标注块",
        };
        const toggleItem = {
          title: "Toggle",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onItemClick: () => insertOrUpdateBlock(editor, { type: "toggle", props: { open: "true", summary: "折叠块" } } as any),
          aliases: ["toggle", "折叠", "details"],
          group: "基础块",
          icon: <span>▶</span>,
          hint: "插入折叠块",
        };
        const columnsItem = {
          title: "Columns",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onItemClick: () => insertOrUpdateBlock(editor, { type: "columns", props: { cols: "2", columnsData: "[[],[]]" } } as any),
          aliases: ["columns", "分栏", "column", "col", "并排"],
          group: "高级块",
          icon: <span>⫼</span>,
          hint: "插入两栏分栏块",
        };
        const all = [...defaults, dbItem, dividerItem, quoteItem, calloutItem, toggleItem, columnsItem];
        return all.filter(
          (item) =>
            pinyinMatch(item.title, query) ||
            (item.aliases ?? []).some((a: string) => pinyinMatch(a, query)),
        );
      }}
    />
  );
}

// @mention 菜单
function MentionMenu({
  editor,
  onSelectPage,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: BlockNoteEditor<any>;
  onSelectPage?: (id: string) => void;
}) {
  return (
    <SuggestionMenuController
      triggerCharacter="@"
      getItems={async (query) => {
        const pages = await api.pages.search(query || " ");
        return (pages ?? []).map(page => ({
          title: page.title || "Untitled",
          onItemClick: () => {
            editor.insertInlineContent([
              {
                type: "mention",
                props: { pageId: page.id, title: page.title || "Untitled", icon: page.icon ?? "📄" },
              },
              " ",
            ]);
          },
          aliases: [],
          group: "页面",
          icon: <span style={{ fontSize: 14 }}>{page.icon ?? "📄"}</span>,
          hint: page.title || "Untitled",
        }));
      }}
    />
  );
}
