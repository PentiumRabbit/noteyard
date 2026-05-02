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
import { withMultiColumn, getMultiColumnSlashMenuItems, locales as multiColumnLocales, multiColumnDropCursor } from "@blocknote/xl-multi-column";
import React, { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { api } from "../../api/client";
import { pinyinMatch } from "../../utils/pinyinMatch";
import type { Block } from "../../types";
import { DatabaseView } from "../database/DatabaseView";
import { useSettings } from "../../settings/settingsStore";
import { toBlockNote } from "../../utils/toBlockNote";
import type { BNInline, BNBlock } from "../../types/blocknote";
import "./Editor.css";

function inlinesToText(content: BNInline[] | undefined): string {
  if (!content) return "";
  return content.map(c => {
    if (c.type === "text") return c.text ?? "";
    if (c.type === "mention") return `[${c.props?.icon ?? "📄"} ${c.props?.title ?? ""}](page:${c.props?.pageId ?? ""})`;
    if (c.type === "link") return `[${inlinesToText(c.content)}](${c.props?.href ?? ""})`;
    return c.text ?? "";
  }).join("");
}

function blocksToMarkdown(blocks: BNBlock[]): string {
  return blocks.map(b => blockToMd(b)).filter(Boolean).join("\n\n");
}

function blockToMd(b: BNBlock): string {
  const text = inlinesToText(b.content);
  switch (b.type) {
    case "heading": {
      const lvl = parseInt(b.props?.level ?? "1", 10);
      return "#".repeat(lvl) + " " + text;
    }
    case "bulletListItem": return "- " + text;
    case "numberedListItem": return "1. " + text;
    case "checkListItem": return (b.props?.checked === "true" ? "- [x] " : "- [ ] ") + text;
    case "quote": return "> " + text;
    case "horizontalRule": return "---";
    case "callout": return `> ${b.props?.icon ?? "💡"} ${text}`;
    case "toggle": return `**${text}**`;
    case "subpage": return `📄 [${b.props?.title ?? "Untitled"}](page:${b.props?.pageId ?? ""})`;
    case "bookmark": return `🔖 [${b.props?.title || b.props?.url}](${b.props?.url})`;
    case "embed": return `🌐 <${b.props?.url}>`;
    case "fileAttach": return `📎 [${b.props?.name}](${b.props?.url})`;
    case "button": {
      const btnLabel = b.props?.label || "点击";
      const btnUrl   = b.props?.url;
      return btnUrl ? `[${btnLabel}](${btnUrl})` : `[${btnLabel}]`;
    }
    case "image": return `![image](${b.props?.url ?? ""})`;
    case "paragraph": return text;
    case "codeBlock": return "```\n" + text + "\n```";
    default: return text;
  }
}

export interface EditorHandle {
  flush: () => void;
  exportMarkdown: () => string;
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

// T08 — Sub-page 块
const SubpageBlock = createReactBlockSpec(
  {
    type: "subpage" as const,
    propSchema: { pageId: { default: "" }, title: { default: "" }, icon: { default: "📄" } },
    content: "none",
  },
  {
    render: ({ block }) => {
      return (
        <div className="subpage-block" data-page-id={block.props.pageId}>
          <span className="subpage-icon">{block.props.icon || "📄"}</span>
          <span className="subpage-title">{block.props.title || "Untitled"}</span>
          <span className="subpage-arrow">↗</span>
        </div>
      );
    },
  },
);

// T09 — File 块
const FileAttachBlock = createReactBlockSpec(
  {
    type: "fileAttach" as const,
    propSchema: { url: { default: "" }, name: { default: "" }, size: { default: "" } },
    content: "none",
  },
  {
    render: ({ block, updateBlock }) => {
      const hasFile = !!block.props.url;
      const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { alert("文件不超过 2MB"); return; }
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("http://localhost:8080/api/uploads", { method: "POST", body: form });
        if (!res.ok) { alert("上传失败"); return; }
        const data = await res.json() as { url: string };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updateBlock({ props: { url: data.url, name: file.name, size: String(Math.round(file.size / 1024)) + " KB" } } as any);
      };
      if (!hasFile) {
        return (
          <label className="file-attach-upload">
            <span>📎 上传文件</span>
            <input type="file" style={{ display: "none" }} onChange={e => void handleUpload(e)} />
          </label>
        );
      }
      return (
        <div className="file-attach-block">
          <span className="file-attach-icon">📎</span>
          <a href={block.props.url} download={block.props.name} className="file-attach-name">{block.props.name}</a>
          <span className="file-attach-size">{block.props.size}</span>
          <label className="file-attach-reupload">
            重新上传
            <input type="file" style={{ display: "none" }} onChange={e => void handleUpload(e)} />
          </label>
        </div>
      );
    },
  },
);

// T10 — Bookmark 书签块
interface BookmarkMeta { title: string; description: string; favicon: string }

const BookmarkBlock = createReactBlockSpec(
  {
    type: "bookmark" as const,
    propSchema: { url: { default: "" }, title: { default: "" }, description: { default: "" }, favicon: { default: "" } },
    content: "none",
  },
  {
    render: ({ block, updateBlock }) => {
      const [urlDraft, setUrlDraft] = React.useState(block.props.url || "");
      const [loading, setLoading] = React.useState(false);

      const fetchMeta = async (url: string) => {
        if (!url.startsWith("http")) return;
        setLoading(true);
        try {
          const res = await fetch(`http://localhost:8080/api/meta?url=${encodeURIComponent(url)}`);
          const data = await res.json() as BookmarkMeta;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          updateBlock({ props: { url, title: data.title || url, description: data.description, favicon: data.favicon } } as any);
        } catch { /* ignore */ } finally { setLoading(false); }
      };

      if (!block.props.url) {
        return (
          <div className="bookmark-input-wrap">
            <span className="bookmark-input-icon">🔗</span>
            <input
              className="bookmark-url-input"
              placeholder="粘贴网址，按 Enter 确认"
              value={urlDraft}
              onChange={e => setUrlDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void fetchMeta(urlDraft); }}
              onBlur={() => { if (urlDraft) void fetchMeta(urlDraft); }}
            />
            {loading && <span className="bookmark-loading">加载中…</span>}
          </div>
        );
      }

      return (
        <a href={block.props.url} target="_blank" rel="noopener noreferrer" className="bookmark-card">
          <div className="bookmark-card-body">
            <div className="bookmark-card-title">{block.props.title || block.props.url}</div>
            {block.props.description && <div className="bookmark-card-desc">{block.props.description}</div>}
            <div className="bookmark-card-url">
              {block.props.favicon && <img src={block.props.favicon} className="bookmark-favicon" alt="" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
              <span>{block.props.url}</span>
            </div>
          </div>
        </a>
      );
    },
  },
);

// T11 — Embed 嵌入块
const EmbedBlock = createReactBlockSpec(
  {
    type: "embed" as const,
    propSchema: { url: { default: "" }, height: { default: "400" } },
    content: "none",
  },
  {
    render: ({ block, updateBlock }) => {
      const [urlDraft, setUrlDraft] = React.useState(block.props.url || "");
      const resizeRef = React.useRef<{ startY: number; startH: number } | null>(null);

      const startResize = (e: React.MouseEvent) => {
        e.preventDefault();
        const h = parseInt(block.props.height || "400", 10);
        resizeRef.current = { startY: e.clientY, startH: h };
        const onMove = (mv: MouseEvent) => {
          if (!resizeRef.current) return;
          const newH = Math.max(100, resizeRef.current.startH + mv.clientY - resizeRef.current.startY);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          updateBlock({ props: { ...block.props, height: String(newH) } } as any);
        };
        const onUp = () => { resizeRef.current = null; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      };

      if (!block.props.url) {
        return (
          <div className="bookmark-input-wrap">
            <span className="bookmark-input-icon">🌐</span>
            <input
              className="bookmark-url-input"
              placeholder="粘贴网址嵌入，按 Enter 确认"
              value={urlDraft}
              onChange={e => setUrlDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && urlDraft.startsWith("http")) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  updateBlock({ props: { url: urlDraft, height: "400" } } as any);
                }
              }}
            />
          </div>
        );
      }

      return (
        <div className="embed-wrap" style={{ height: parseInt(block.props.height || "400", 10) + 20 }}>
          <iframe
            src={block.props.url}
            className="embed-iframe"
            style={{ height: block.props.height + "px" }}
            sandbox="allow-scripts allow-same-origin allow-forms"
            title="embed"
          />
          <div className="embed-resize-handle" onMouseDown={startResize} title="拖拽调整高度" />
        </div>
      );
    },
  },
);

// T12 — PDF 预览块
const PdfBlock = createReactBlockSpec(
  {
    type: "pdf" as const,
    propSchema: { url: { default: "" }, name: { default: "" }, height: { default: "500" } },
    content: "none",
  },
  {
    render: ({ block, updateBlock }) => {
      const resizeRef = React.useRef<{ startY: number; startH: number } | null>(null);

      const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { alert("PDF 不超过 10MB"); return; }
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("http://localhost:8080/api/uploads", { method: "POST", body: form });
        if (!res.ok) { alert("上传失败"); return; }
        const data = await res.json() as { url: string };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updateBlock({ props: { url: data.url, name: file.name, height: "500" } } as any);
      };

      const startResize = (e: React.MouseEvent) => {
        e.preventDefault();
        const h = parseInt(block.props.height || "500", 10);
        resizeRef.current = { startY: e.clientY, startH: h };
        const onMove = (mv: MouseEvent) => {
          if (!resizeRef.current) return;
          const newH = Math.max(200, resizeRef.current.startH + mv.clientY - resizeRef.current.startY);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          updateBlock({ props: { ...block.props, height: String(newH) } } as any);
        };
        const onUp = () => { resizeRef.current = null; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      };

      if (!block.props.url) {
        return (
          <label className="file-attach-upload">
            <span>📄 上传 PDF</span>
            <input type="file" accept=".pdf" style={{ display: "none" }} onChange={e => void handleUpload(e)} />
          </label>
        );
      }

      return (
        <div className="pdf-block">
          <div className="pdf-toolbar">
            <span className="pdf-name">📄 {block.props.name}</span>
            <a href={block.props.url} download={block.props.name} className="pdf-download">下载</a>
          </div>
          <iframe
            src={block.props.url}
            className="embed-iframe"
            style={{ height: block.props.height + "px" }}
            title={block.props.name}
          />
          <div className="embed-resize-handle" onMouseDown={startResize} title="拖拽调整高度" />
        </div>
      );
    },
  },
);

// REQ-054 — Button 块
type ButtonColor = "blue" | "green" | "red" | "gray";
type ButtonAction = "none" | "open_url";

function isSafeUrl(url: string): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

const ButtonBlock = createReactBlockSpec(
  {
    type: "button" as const,
    propSchema: {
      label:  { default: "点击" },
      color:  { default: "blue" },
      action: { default: "none" },
      url:    { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, updateBlock }) => {
      // Defensive: normalise props so corrupted data never throws
      let label  = "点击";
      let color: ButtonColor  = "blue";
      let action: ButtonAction = "none";
      let url = "";
      try {
        label  = block.props.label  ?? "点击";
        const c = block.props.color as ButtonColor;
        color  = (["blue","green","red","gray"] as ButtonColor[]).includes(c) ? c : "blue";
        const a = block.props.action as ButtonAction;
        action = (["none","open_url"] as ButtonAction[]).includes(a) ? a : "none";
        url    = block.props.url ?? "";
      } catch { /* fallback to defaults */ }

      const [panelOpen, setPanelOpen] = React.useState(false);
      const [labelDraft,  setLabelDraft]  = React.useState(label);
      const [colorDraft,  setColorDraft]  = React.useState<ButtonColor>(color);
      const [actionDraft, setActionDraft] = React.useState<ButtonAction>(action);
      const [urlDraft,    setUrlDraft]    = React.useState(url);

      const commitPanel = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updateBlock({ props: { label: labelDraft, color: colorDraft, action: actionDraft, url: urlDraft } } as any);
        setPanelOpen(false);
      };

      const handleClick = () => {
        if (action === "open_url") {
          if (!isSafeUrl(url)) {
            alert("URL 不合法：必须以 http:// 或 https:// 开头");
            return;
          }
          window.open(url, "_blank", "noopener,noreferrer");
        }
      };

      return (
        <div className="button-block">
          <button
            className={`button-block-btn color-${color}`}
            onClick={handleClick}
            title={action === "open_url" ? url : undefined}
          >
            {label}
          </button>
          <button
            className="button-block-settings-btn"
            title="设置"
            onMouseDown={ev => { ev.preventDefault(); setPanelOpen(v => !v); }}
          >
            ⚙
          </button>
          {panelOpen && (
            <div className="button-block-panel">
              <label>
                标签文案
                <input
                  value={labelDraft}
                  onChange={e => setLabelDraft(e.target.value)}
                  placeholder="按钮文案"
                />
              </label>
              <label>
                颜色
                <select value={colorDraft} onChange={e => setColorDraft(e.target.value as ButtonColor)}>
                  <option value="blue">蓝色</option>
                  <option value="green">绿色</option>
                  <option value="red">红色</option>
                  <option value="gray">灰色</option>
                </select>
              </label>
              <label>
                点击动作
                <select value={actionDraft} onChange={e => setActionDraft(e.target.value as ButtonAction)}>
                  <option value="none">无动作</option>
                  <option value="open_url">打开链接</option>
                </select>
              </label>
              {actionDraft === "open_url" && (
                <label>
                  URL
                  <input
                    value={urlDraft}
                    onChange={e => setUrlDraft(e.target.value)}
                    placeholder="https://..."
                  />
                </label>
              )}
              <button
                style={{ alignSelf: "flex-end", padding: "4px 10px", fontSize: 12, cursor: "pointer", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-accent)", color: "#fff" }}
                onMouseDown={ev => { ev.preventDefault(); commitPanel(); }}
              >
                确认
              </button>
            </div>
          )}
        </div>
      );
    },
  },
);

// T06 — schema 注册（块 + 内联）：使用 withMultiColumn 添加 columnList / column 节点
const schema = withMultiColumn(
  BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      horizontalRule: HorizontalRuleBlock,
      quote: QuoteBlock,
      database: DatabaseBlock,
      callout: CalloutBlock,
      toggle: ToggleBlock,
      subpage: SubpageBlock,
      fileAttach: FileAttachBlock,
      bookmark: BookmarkBlock,
      embed: EmbedBlock,
      pdf: PdfBlock,
      button: ButtonBlock,
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      mention: MentionInlineContent,
    },
  }),
);


export const Editor = forwardRef<EditorHandle, Props>(function Editor({ pageId, onSelectPage }, ref) {
  const { themeId } = useSettings();
  const bnTheme = themeId === "dark" ? "dark" : "light";
  const editor = useCreateBlockNote({
    schema,
    dictionary: { ...locales.zh, multi_column: multiColumnLocales.zh },
    dropCursor: multiColumnDropCursor,
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildDtosRecursive = (blocks: any[], pid: string, parentBlockId: string | null): Partial<Block>[] =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blocks.flatMap((b: any, i: number): Partial<Block>[] => {
      if (b.type === "columnList") {
        // columnList itself is stored; then recursively expand each column child
        const dto: Partial<Block> = {
          id: b.id,
          page_id: pid,
          parent_block_id: parentBlockId,
          type: b.type,
          content: "{}",
          props: "{}",
          order_index: i,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const columnDtos = (b.children ?? []).flatMap((col: any, ci: number): Partial<Block>[] => {
          const colDto: Partial<Block> = {
            id: col.id,
            page_id: pid,
            parent_block_id: b.id,
            type: col.type,
            content: "{}",
            props: JSON.stringify({ width: col.props?.width ?? 1 }),
            order_index: ci,
          };
          const innerDtos = buildDtosRecursive(col.children ?? [], pid, col.id);
          return [colDto, ...innerDtos];
        });
        return [dto, ...columnDtos];
      }
      if (b.type === "database") {
        const dbId = (b.props as { databaseId?: string }).databaseId;
        if (!dbId) return [];
        return [{ id: b.id, page_id: pid, parent_block_id: parentBlockId, type: b.type, content: JSON.stringify(b.props), props: "{}", order_index: i }];
      }
      if (b.type === "subpage" || b.type === "fileAttach" || b.type === "bookmark" || b.type === "embed" || b.type === "pdf" || b.type === "button") {
        return [{ id: b.id, page_id: pid, parent_block_id: parentBlockId, type: b.type, content: JSON.stringify(b.props), props: "{}", order_index: i }];
      }
      return [{ id: b.id, page_id: pid, parent_block_id: parentBlockId, type: b.type, content: JSON.stringify((b as { content?: unknown }).content ?? []), props: JSON.stringify((b as { props?: unknown }).props ?? {}), order_index: i }];
    });

  const buildDtos = (pid: string): Partial<Block>[] =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buildDtosRecursive(editor.document as any[], pid, null);

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
    exportMarkdown: () => blocksToMarkdown(editor.document as unknown as BNBlock[]),
  }));

  useEffect(() => {
    readyRef.current = false;
    const currentPageId = pageId;
    let cancelled = false;

    void (async () => {
      const blocks = await api.blocks.listByPage(currentPageId);
      if (cancelled) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bn: any[] = blocks && blocks.length > 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? toBlockNote(blocks) as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : [{ type: "paragraph" }] as any;

      // 等待 BlockNote ProseMirror view mount 后再 replaceBlocks（只调用一次）
      const tryReplace = (attemptsLeft: number) => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pmView = (editor as any)._tiptapEditor?.view;
        if (!pmView || !pmView.docView) {
          if (attemptsLeft > 0) {
            setTimeout(() => tryReplace(attemptsLeft - 1), 50);
          } else {
            requestAnimationFrame(() => { readyRef.current = true; });
          }
          return;
        }
        try {
          editor.replaceBlocks(editor.document, bn);
        } catch (err) { console.error('[Editor] replaceBlocks failed', err); }
        requestAnimationFrame(() => { readyRef.current = true; });
      };
      setTimeout(() => tryReplace(40), 0);
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
      const mentionEl = (e.target as HTMLElement).closest<HTMLElement>(".mention-inline");
      if (mentionEl) {
        const pid = mentionEl.dataset.pageId;
        if (pid) { e.preventDefault(); onSelectPage(pid); }
        return;
      }
      const subpageEl = (e.target as HTMLElement).closest<HTMLElement>(".subpage-block");
      if (subpageEl) {
        const pid = subpageEl.dataset.pageId;
        if (pid) { e.preventDefault(); onSelectPage(pid); }
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [onSelectPage]);

  const columnOverlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const SIDE_THRESHOLD = 0.1;

    function getBlockEl(target: Element | null): HTMLElement | null {
      let el = target as HTMLElement | null;
      while (el) {
        if (el.getAttribute("data-node-type") === "blockContent" || el.classList.contains("bn-block-content")) {
          return el.parentElement as HTMLElement;
        }
        if (el.classList.contains("bn-block") || el.getAttribute("data-id")) {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    }

    function showOverlay(blockEl: HTMLElement, position: "left" | "right") {
      const rect = blockEl.getBoundingClientRect();
      const parent = blockEl.closest(".editor-wrap") as HTMLElement ?? document.body;
      const parentRect = parent.getBoundingClientRect();

      let overlay = columnOverlayRef.current;
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;pointer-events:none;z-index:100;display:flex;gap:4px;";
        document.body.appendChild(overlay);
        columnOverlayRef.current = overlay;
      }

      const col1W = position === "left" ? 0.5 : 0.5;
      const col2W = 1 - col1W;
      overlay.style.left = rect.left + "px";
      overlay.style.top = rect.top + "px";
      overlay.style.width = rect.width + "px";
      overlay.style.height = rect.height + "px";
      overlay.innerHTML = `
        <div style="flex:${col1W};background:rgba(59,130,246,${position==="left"?0.18:0.08});border:2px solid rgba(59,130,246,${position==="left"?0.7:0.3});border-radius:4px;min-height:100%;box-sizing:border-box;"></div>
        <div style="flex:${col2W};background:rgba(59,130,246,${position==="right"?0.18:0.08});border:2px solid rgba(59,130,246,${position==="right"?0.7:0.3});border-radius:4px;min-height:100%;box-sizing:border-box;"></div>
      `;
      // suppress unused var warning
      void parentRect;
    }

    function hideOverlay() {
      if (columnOverlayRef.current) {
        columnOverlayRef.current.remove();
        columnOverlayRef.current = null;
      }
    }

    function onDragover(e: DragEvent) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const blockEl = getBlockEl(el);
      if (!blockEl) { hideOverlay(); return; }
      const rect = blockEl.getBoundingClientRect();
      if (e.clientX <= rect.left + rect.width * SIDE_THRESHOLD) {
        showOverlay(blockEl, "left");
      } else if (e.clientX >= rect.right - rect.width * SIDE_THRESHOLD) {
        showOverlay(blockEl, "right");
      } else {
        hideOverlay();
      }
    }

    const editorDom = (editor as any)._tiptapEditor?.view?.dom as HTMLElement | undefined;
    if (!editorDom) return;

    editorDom.addEventListener("dragover", onDragover);
    editorDom.addEventListener("dragleave", hideOverlay);
    editorDom.addEventListener("drop", hideOverlay);
    editorDom.addEventListener("dragend", hideOverlay);

    return () => {
      editorDom.removeEventListener("dragover", onDragover);
      editorDom.removeEventListener("dragleave", hideOverlay);
      editorDom.removeEventListener("drop", hideOverlay);
      editorDom.removeEventListener("dragend", hideOverlay);
      hideOverlay();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          group: "数据库",
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const multiColItems = getMultiColumnSlashMenuItems(editor as any);
        // 检测光标是否在 column 块内，若是则过滤掉 columnList 类型的菜单项，防止嵌套分栏
        const isInsideColumn = (() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pos = (editor as any).getTextCursorPosition?.();
            if (!pos) return false;
            // 向上遍历祖先，检查是否有 column 类型的块
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let node: any = pos.block;
            while (node) {
              if (node.type === "column") return true;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              node = node.parentBlockId ? (editor as any).getBlock?.(node.parentBlockId) : null;
            }
            return false;
          } catch { return false; }
        })();
        const subpageItem = {
          title: "Sub-page",
          onItemClick: async () => {
            const newPage = await api.pages.create({ title: "Untitled", order_index: 9999 });
            insertOrUpdateBlock(editor, {
              type: "subpage",
              props: { pageId: newPage.id, title: newPage.title || "Untitled", icon: "📄" },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
          },
          aliases: ["subpage", "sub-page", "子页面", "page"],
          group: "高级块",
          icon: <span>📄</span>,
          hint: "插入子页面链接",
        };
        const fileItem = {
          title: "File",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onItemClick: () => insertOrUpdateBlock(editor, { type: "fileAttach", props: { url: "", name: "", size: "" } } as any),
          aliases: ["file", "attachment", "文件", "附件"],
          group: "媒体块",
          icon: <span>📎</span>,
          hint: "上传文件附件",
        };
        const bookmarkItem = {
          title: "Bookmark",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onItemClick: () => insertOrUpdateBlock(editor, { type: "bookmark", props: { url: "", title: "", description: "", favicon: "" } } as any),
          aliases: ["bookmark", "书签", "link", "链接"],
          group: "媒体块",
          icon: <span>🔖</span>,
          hint: "插入网页书签预览",
        };
        const embedItem = {
          title: "Embed",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onItemClick: () => insertOrUpdateBlock(editor, { type: "embed", props: { url: "", height: "400" } } as any),
          aliases: ["embed", "嵌入", "iframe"],
          group: "媒体块",
          icon: <span>🌐</span>,
          hint: "嵌入网页",
        };
        const pdfItem = {
          title: "PDF",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onItemClick: () => insertOrUpdateBlock(editor, { type: "pdf", props: { url: "", name: "", height: "500" } } as any),
          aliases: ["pdf", "PDF", "文档"],
          group: "媒体块",
          icon: <span>📄</span>,
          hint: "上传并预览 PDF 文件",
        };
        const buttonItem = {
          title: "Button",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onItemClick: () => insertOrUpdateBlock(editor, { type: "button", props: { label: "点击", color: "blue", action: "none", url: "" } } as any),
          aliases: ["button", "按钮"],
          group: "基础块",
          icon: <span>🔘</span>,
          hint: "插入可点击按钮",
        };
        // 若光标在 column 内，过滤掉 columnList 相关的多列菜单项
        const filteredMultiColItems = isInsideColumn ? [] : multiColItems;
        const all = [...defaults, dbItem, dividerItem, quoteItem, calloutItem, toggleItem, buttonItem, ...filteredMultiColItems, subpageItem, fileItem, bookmarkItem, embedItem, pdfItem];
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
