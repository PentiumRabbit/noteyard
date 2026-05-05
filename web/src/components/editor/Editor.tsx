import toast from "react-hot-toast";
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
  SideMenuController,
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
import React, { useEffect, useImperativeHandle, useRef, forwardRef, useMemo } from "react";
import { api, API_BASE } from "../../api/client";
import { pinyinMatch } from "../../utils/pinyinMatch";
import type { Block } from "../../types";
import { DatabaseViewErrorBoundary } from "../database/DatabaseViewErrorBoundary";
import { useSettings } from "../../settings/settingsStore";
import { toBlockNote } from "../../utils/toBlockNote";
import type { BNBlock } from "../../types/blocknote";
import { blocksToMarkdown } from "../../utils/markdownUtils";
import { isSafeUrl } from "../../utils/urlUtils";
import "./Editor.css";
import { dropOverlayPlugin } from "./dropOverlayPlugin";
import { flip, offset, shift, size } from "@floating-ui/react";
import { PanelSelect } from "../common/PanelSelect";
import { FileUploadField } from "./FileUploadField";
import { UrlInputField } from "./UrlInputField";
import { useResizable } from "../../hooks/useResizable";

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
      <hr style={{ border: "none", borderTop: "1px solid #e9e9e7", margin: "4px 0", width: "100%", display: "block" }} />
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
          borderLeft: "3px solid var(--color-text-tertiary)",
          paddingLeft: "14px",
          paddingTop: "2px",
          paddingBottom: "2px",
          color: "var(--color-text-secondary)",
          width: "100%",
          boxSizing: "border-box",
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
      return <DatabaseViewErrorBoundary databaseId={dbId} />;
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
    render: ({ block, editor, contentRef }) => {
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
                    onMouseDown={ev => { ev.preventDefault(); editor.updateBlock(block, { props: { icon: e } }); setPickerOpen(false); }}>
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
    render: ({ block, editor, contentRef }) => {
      const isOpen = block.props.open !== "false";
      return (
        <div className="toggle-block">
          <div className="toggle-header">
            <button
              className={`toggle-arrow${isOpen ? " open" : ""}`}
              onMouseDown={ev => { ev.preventDefault(); editor.updateBlock(block, { props: { open: isOpen ? "false" : "true" } }); }}
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
    render: ({ block, editor }) => {
      const hasFile = !!block.props.url;
      const handleUpload = (file: File, url: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.updateBlock(block, { props: { url, name: file.name, size: String(Math.round(file.size / 1024)) + " KB" } } as any);
      };
      if (!hasFile) {
        return <FileUploadField label="📎 上传文件" onUpload={handleUpload} />;
      }
      return (
        <div className="file-attach-block">
          <span className="file-attach-icon">📎</span>
          <a href={block.props.url} download={block.props.name} className="file-attach-name">{block.props.name}</a>
          <span className="file-attach-size">{block.props.size}</span>
          <FileUploadField label="重新上传" onUpload={handleUpload} />
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
    render: ({ block, editor }) => {
      const [loading, setLoading] = React.useState(false);

      const fetchMeta = async (url: string) => {
        if (!url.startsWith("http")) return;
        setLoading(true);
        try {
          const res = await fetch(`${API_BASE}/api/meta?url=${encodeURIComponent(url)}`);
          const data = await res.json() as BookmarkMeta;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          editor.updateBlock(block, { props: { url, title: data.title || url, description: data.description, favicon: data.favicon } } as any);
        } catch { /* ignore */ } finally { setLoading(false); }
      };

      if (!block.props.url) {
        return (
          <UrlInputField
            icon="🔗"
            placeholder="粘贴网址，按 Enter 确认"
            onConfirm={(url) => void fetchMeta(url)}
            loading={loading}
          />
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
    render: ({ block, editor }) => {
      const { startResize } = useResizable(400, 100, (newH) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.updateBlock(block, { props: { ...block.props, height: String(newH) } } as any);
      });

      if (!block.props.url) {
        return (
          <UrlInputField
            icon="🌐"
            placeholder="粘贴网址嵌入，按 Enter 确认"
            onConfirm={(url) => {
              if (url.startsWith("http")) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                editor.updateBlock(block, { props: { url, height: "400" } } as any);
              }
            }}
          />
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
          <div className="embed-resize-handle" onMouseDown={(e) => startResize(e, parseInt(block.props.height || "400", 10))} title="拖拽调整高度" />
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
    render: ({ block, editor }) => {
      const { startResize } = useResizable(500, 200, (newH) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.updateBlock(block, { props: { ...block.props, height: String(newH) } } as any);
      });

      const handleUpload = (file: File, url: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.updateBlock(block, { props: { url, name: file.name, height: "500" } } as any);
      };

      if (!block.props.url) {
        return <FileUploadField label="📄 上传 PDF" onUpload={handleUpload} />;
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
          <div className="embed-resize-handle" onMouseDown={(e) => startResize(e, parseInt(block.props.height || "500", 10))} title="拖拽调整高度" />
        </div>
      );
    },
  },
);

// REQ-054 — Button 块
type ButtonColor = "default" | "blue" | "green" | "red" | "orange" | "purple" | "pink" | "gray";
// REQ-083 FR-3/FR-4: extend action enum; REQ-084: add run_rules
type ButtonAction = "none" | "open_url" | "new_subpage" | "edit_page_props" | "run_rules";

// REQ-084 — ButtonRule union type
type ButtonRule =
  | { type: "create_page"; title: string; parent: "current" | "root" }
  | { type: "append_content"; text: string }
  | { type: "set_page_prop"; prop: "title" | "icon" | "cover"; value: string }
  | { type: "notify"; message: string };

// REQ-083 FR-3: module-level ref so ButtonBlock (defined outside Editor component) can
// access the current pageId and onSelectPage without a factory-function refactor.
// Editor's useEffect keeps this in sync on every render cycle.
// REQ-084: pageTitle added for resolveVariables ({{page_title}} placeholder support)
const buttonBlockCtxRef: {
  pageId: string;
  pageTitle: string;
  onSelectPage: ((id: string) => void) | undefined;
} = { pageId: "", pageTitle: "", onSelectPage: undefined };

// REQ-084 — parseRules: returns ButtonRule[] or null (null = format invalid)
function parseRules(raw: string): ButtonRule[] | null {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null; // null = format invalid, distinct from empty array
  }
}

// REQ-084 — resolveVariables: replaces {{date}}, {{time}}, {{page_title}} in template
function resolveVariables(
  template: string,
  ctxRef: { pageTitle: string },
): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5);
  return template
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{page_title\}\}/g, ctxRef.pageTitle ?? "");
}

// REQ-084 — executeSingleRule: executes one rule, throws on failure
async function executeSingleRule(
  rule: ButtonRule,
  ctxRef: typeof buttonBlockCtxRef,
  editor: BlockNoteEditor<typeof schema>,
): Promise<void> {
  switch (rule.type) {
    case "create_page": {
      const parentId = rule.parent === "current" ? ctxRef.pageId : null;
      await api.pages.create({ parent_id: parentId, title: rule.title || "Untitled", order_index: 9999 });
      break;
    }
    case "append_content": {
      const resolved = resolveVariables(rule.text, ctxRef);
      const lastBlock = editor.document[editor.document.length - 1];
      editor.insertBlocks(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ type: "paragraph", content: [{ type: "text", text: resolved, styles: {} }] } as any],
        lastBlock,
        "after"
      );
      break;
    }
    case "set_page_prop": {
      const resolved = resolveVariables(rule.value, ctxRef);
      await api.pages.update(ctxRef.pageId, { [rule.prop]: resolved });
      break;
    }
    case "notify": {
      const resolved = resolveVariables(rule.message, ctxRef);
      toast(resolved);
      break;
    }
  }
}

// REQ-084 — executeRules: runs all rules sequentially, disables btn during execution
async function executeRules(
  rules: ButtonRule[],
  ctxRef: typeof buttonBlockCtxRef,
  editor: BlockNoteEditor<typeof schema>,
  btn: HTMLButtonElement,
): Promise<void> {
  btn.disabled = true;
  try {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      try {
        await executeSingleRule(rule, ctxRef, editor);
      } catch (err) {
        const ruleNames: Record<ButtonRule["type"], string> = {
          create_page: "创建页面",
          append_content: "追加内容",
          set_page_prop: "修改页面属性",
          notify: "发送通知",
        };
        toast.error(`规则 ${i + 1}（${ruleNames[rule.type]}）执行失败：${(err as Error).message}`);
        return;
      }
    }
  } finally {
    btn.disabled = false;
  }
}

// REQ-083 FR-4: common emoji list (inline copy — no import dependency on App.tsx)
const EMOJI_COMMON = [
  "😀","😂","😍","🤔","😎","🥳","😴","😭","😡","🤯",
  "❤️","🔥","✅","⭐","🎉","🚀","💡","📌","⚠️","💬",
  "🐶","🐱","🦊","🦁","🐻","🦄","🐼","🐧","🦋","🌸",
];

// REQ-083 FR-4: page properties panel
interface PagePropsPanelProps {
  pageId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

function PagePropsPanel({ pageId, anchorRect, onClose }: PagePropsPanelProps) {
  const [icon, setIcon] = React.useState("");
  const [cover, setCover] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const panelRef = React.useRef<HTMLDivElement>(null);

  const panelHeight = 320;
  const spaceBelow = window.innerHeight - (anchorRect.bottom + 6);
  const top = spaceBelow >= panelHeight ? anchorRect.bottom + 6 : anchorRect.top - panelHeight - 6;
  const left = anchorRect.left;

  React.useEffect(() => {
    void (async () => {
      try {
        const page = await api.pages.get(pageId);
        if (page) {
          setIcon(page.icon ?? "");
          setCover(page.cover ?? null);
          setTitle(page.title ?? "");
        }
      } catch { /* degrade to empty */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const blockMousedown = (e: MouseEvent) => {
      if (!["INPUT","BUTTON","SELECT","TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
      }
      e.stopPropagation();
    };
    panel.addEventListener("mousedown", blockMousedown);
    return () => panel.removeEventListener("mousedown", blockMousedown);
  }, []);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    window.addEventListener("scroll", onClose, true);
    return () => window.removeEventListener("scroll", onClose, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleIconSelect = async (emoji: string) => {
    setIcon(emoji);
    try { await api.pages.update(pageId, { icon: emoji }); } catch { /* ignore */ }
  };

  const handleAddCover = async () => {
    const gradient = "linear-gradient(135deg,#667eea 0%,#764ba2 100%)";
    setCover(gradient);
    try { await api.pages.update(pageId, { cover: gradient }); } catch { /* ignore */ }
  };

  const handleRemoveCover = async () => {
    setCover(null);
    try { await api.pages.update(pageId, { cover: "" }); } catch { /* ignore */ }
  };

  const handleTitleSave = async () => {
    try {
      await api.pages.update(pageId, { title });
      window.dispatchEvent(new CustomEvent("page-props-updated", { detail: { pageId, title } }));
    } catch { /* ignore */ }
  };

  return (
    <div ref={panelRef} className="page-props-panel" style={{ position: "fixed", top, left }}>
      <div className="page-props-panel-section">
        <div className="page-props-panel-label">图标</div>
        <div className="page-props-emoji-grid">
          {EMOJI_COMMON.map(e => (
            <button key={e} className={`page-props-emoji-btn${icon === e ? " selected" : ""}`}
              onMouseDown={ev => { ev.preventDefault(); void handleIconSelect(e); }}>{e}</button>
          ))}
        </div>
      </div>
      <div className="page-props-panel-section">
        <div className="page-props-panel-label">封面</div>
        <div className="page-props-cover-row">
          <button className="page-props-cover-btn" onMouseDown={ev => { ev.preventDefault(); void handleAddCover(); }}>
            {cover ? "更换封面" : "添加封面"}
          </button>
          {cover && (
            <button className="page-props-cover-btn" onMouseDown={ev => { ev.preventDefault(); void handleRemoveCover(); }}>
              删除封面
            </button>
          )}
        </div>
      </div>
      <div className="page-props-panel-section">
        <div className="page-props-panel-label">标题</div>
        <input className="page-props-title-input" value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => void handleTitleSave()}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleTitleSave(); } }}
          placeholder="页面标题"
        />
      </div>
    </div>
  );
}


const BUTTON_COLORS: { value: ButtonColor; hex: string; label: string }[] = [
  { value: "default", hex: "#37352f", label: "默认" },
  { value: "blue",    hex: "#2383e2", label: "蓝色" },
  { value: "green",   hex: "#0f9d58", label: "绿色" },
  { value: "red",     hex: "#e53935", label: "红色" },
  { value: "orange",  hex: "#d9730d", label: "橙色" },
  { value: "purple",  hex: "#9065b0", label: "紫色" },
  { value: "pink",    hex: "#c9306a", label: "粉色" },
  { value: "gray",    hex: "#9b9a97", label: "灰色" },
];

const ALL_BUTTON_COLORS = BUTTON_COLORS.map(c => c.value);

// REQ-083 FR-1 — background color
type ButtonBgColor = "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";

const BUTTON_BG_COLORS: { value: ButtonBgColor; hex: string; hoverHex: string; label: string }[] = [
  { value: "default", hex: "var(--color-bg-surface)",          hoverHex: "var(--color-hover-bg-medium)", label: "默认" },
  { value: "gray",    hex: "#f1f1ef", hoverHex: "#e4e4e1", label: "灰色" },
  { value: "brown",   hex: "#f4eeee", hoverHex: "#ede5e5", label: "棕色" },
  { value: "orange",  hex: "#fbecdd", hoverHex: "#f3e0cc", label: "橙色" },
  { value: "yellow",  hex: "#fef9c3", hoverHex: "#f9f0a8", label: "黄色" },
  { value: "green",   hex: "#e8f5e8", hoverHex: "#d4ecd4", label: "绿色" },
  { value: "blue",    hex: "#e7f0fd", hoverHex: "#d0e3f9", label: "蓝色" },
  { value: "purple",  hex: "#f3eef8", hoverHex: "#e8dff0", label: "紫色" },
  { value: "pink",    hex: "#fbe8f3", hoverHex: "#f3d5e8", label: "粉色" },
  { value: "red",     hex: "#fde8e8", hoverHex: "#f5d5d5", label: "红色" },
];

const ALL_BUTTON_BG_COLORS = BUTTON_BG_COLORS.map(c => c.value);

const ButtonBlock = createReactBlockSpec(
  {
    type: "button" as const,
    propSchema: {
      label:   { default: "点击" },
      color:   { default: "default" },
      bgColor: { default: "default" },   // REQ-083 FR-1
      action:  { default: "none" },
      url:     { default: "" },
      rules:   { default: "[]" },        // REQ-084: JSON string of ButtonRule[]
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      let label  = "点击";
      let color: ButtonColor  = "default";
      let bgColor: ButtonBgColor = "default";
      let action: ButtonAction = "none";
      let url = "";
      try {
        label  = block.props.label  ?? "点击";
        const c = block.props.color as ButtonColor;
        color  = ALL_BUTTON_COLORS.includes(c) ? c : "default";
        const bg = block.props.bgColor as ButtonBgColor;
        bgColor = ALL_BUTTON_BG_COLORS.includes(bg) ? bg : "default";
        const a = block.props.action as ButtonAction;
        action = (["none","open_url","new_subpage","edit_page_props","run_rules"] as ButtonAction[]).includes(a) ? a : "none";
        url    = block.props.url ?? "";
      } catch { /* fallback to defaults */ }

      const [panelOpen, setPanelOpen] = React.useState(false);
      const [labelDraft,    setLabelDraft]    = React.useState(label);
      const [colorDraft,    setColorDraft]    = React.useState<ButtonColor>(color);
      const [bgColorDraft,  setBgColorDraft]  = React.useState<ButtonBgColor>(bgColor);
      const [actionDraft,   setActionDraft]   = React.useState<ButtonAction>(action);
      const [urlDraft,      setUrlDraft]      = React.useState(url);
      // REQ-084: rules draft state — lazy init from block.props.rules
      const [rulesDraft, setRulesDraft] = React.useState<ButtonRule[]>(() => {
        try {
          const parsed = JSON.parse(block.props.rules ?? "[]");
          return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
      });
      const [showRuleTypeMenu, setShowRuleTypeMenu] = React.useState(false);
      // ISS-042: track fixed-position coordinates for the panel
      const [panelPos, setPanelPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
      // REQ-083 FR-4: page props panel state
      const [pagePropsPanelOpen, setPagePropsPanelOpen] = React.useState(false);
      const [pagePropsPanelAnchorRect, setPagePropsPanelAnchorRect] = React.useState<DOMRect | null>(null);
      const panelRef = React.useRef<HTMLDivElement>(null);
      const settingsBtnRef = React.useRef<HTMLButtonElement>(null);
      const mainBtnRef = React.useRef<HTMLButtonElement>(null);
      const wrapRef = React.useRef<HTMLDivElement>(null);

      // ISS-043: Native mousedown handler on the main button — same atom-node
      // interception issue as ISS-041 for the ⚙ button. ProseMirror's mousedown
      // listener on view.dom swallows the event before React's synthetic onClick
      // fires. Registering directly on the element intercepts it first.
      // Read action/url from block.props (not closure) to avoid stale-capture.
      React.useEffect(() => {
        const btn = mainBtnRef.current;
        if (!btn) return;
        const handler = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const currentAction = block.props.action as ButtonAction;
          const currentUrl = (block.props.url ?? "") as string;
          if (currentAction === "open_url") {
            if (!isSafeUrl(currentUrl)) {
              alert("URL 不合法：必须以 http:// 或 https:// 开头");
              return;
            }
            window.open(currentUrl, "_blank", "noopener,noreferrer");
          } else if (currentAction === "new_subpage") {
            // REQ-083 FR-3: guard against ctxRef not yet populated (e.g. HMR edge case)
            const ctxRef = buttonBlockCtxRef;
            if (!ctxRef.pageId) {
              console.warn("[ButtonBlock] new_subpage: pageId not available yet, ignoring click");
              return;
            }
            void (async () => {
              try {
                const newPage = await api.pages.create({
                  parent_id: ctxRef.pageId,
                  title: "Untitled",
                  order_index: 9999,
                });
                insertOrUpdateBlock(editor, {
                  type: "subpage",
                  props: { pageId: newPage.id, title: newPage.title || "Untitled", icon: "📄" },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any);
                ctxRef.onSelectPage?.(newPage.id);
              } catch (err) {
                console.error("[ButtonBlock] new_subpage failed:", err);
              }
            })();
          } else if (currentAction === "edit_page_props") {
            // REQ-083 FR-4: close settings panel first (arch §7.3), then open props panel
            setPanelOpen(false);
            if (btn) {
              setPagePropsPanelAnchorRect(btn.getBoundingClientRect());
            }
            setPagePropsPanelOpen(true);
          }
        };
        btn.addEventListener("mousedown", handler);
        return () => btn.removeEventListener("mousedown", handler);
      // block.props is accessed by reference inside handler — effect runs once at mount
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // ISS-041: Native mousedown handler on the ⚙ settings button — same reason as the
      // panel handler below: ProseMirror registers a native mousedown listener on view.dom
      // and calls stopPropagation(), which prevents the event from reaching document where
      // React's synthetic event delegation listens. Using addEventListener directly on the
      // button element intercepts the event before it reaches view.dom.
      // ISS-042: compute viewport-relative position for position:fixed panel when opening.
      React.useEffect(() => {
        const btn = settingsBtnRef.current;
        if (!btn) return;
        const handler = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setPanelOpen(v => {
            if (!v && wrapRef.current) {
              const rect = wrapRef.current.getBoundingClientRect();
              const panelHeight = 260; // estimated; flip logic recalculates after mount
              const spaceBelow = window.innerHeight - (rect.bottom + 6);
              const top = spaceBelow >= panelHeight
                ? rect.bottom + 6
                : rect.top - panelHeight - 6;
              setPanelPos({ top, left: rect.left });
            }
            return !v;
          });
        };
        btn.addEventListener("mousedown", handler);
        return () => btn.removeEventListener("mousedown", handler);
      }, []);

      // Native mousedown handler on panel div — must be registered via addEventListener
      // (not React onMouseDown) because React uses event delegation: by the time React
      // fires synthetic events, the native event has already bubbled past view.dom and
      // ProseMirror's handler has run. Registering directly on the panel div intercepts
      // the event before it reaches view.dom.
      React.useEffect(() => {
        if (!panelOpen || !panelRef.current) return;
        const panel = panelRef.current;
        const blockMousedown = (e: MouseEvent) => {
          const tag = (e.target as HTMLElement).tagName;
          // For non-interactive elements prevent default so PM's eventBelongsToView
          // returns false (it checks event.defaultPrevented). For INPUT/BUTTON etc.
          // skip preventDefault so native focus still works.
          if (!["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(tag)) {
            e.preventDefault();
          }
          e.stopPropagation();
        };
        panel.addEventListener("mousedown", blockMousedown);
        return () => panel.removeEventListener("mousedown", blockMousedown);
      }, [panelOpen]);

      // ISS-042: close panel on any scroll so the fixed-position panel doesn't drift
      // from its anchor button. Capture phase catches all scroll containers including .main.
      React.useEffect(() => {
        if (!panelOpen) return;
        const close = () => setPanelOpen(false);
        window.addEventListener("scroll", close, true);
        return () => window.removeEventListener("scroll", close, true);
      }, [panelOpen]);

      React.useEffect(() => {
        if (!panelOpen) return;
        const handler = (e: MouseEvent) => {
          // Ignore clicks on the settings button itself — its own handler already
          // toggles panelOpen; without this guard the document handler would also
          // fire commitPanel() and immediately re-open the panel.
          if (settingsBtnRef.current && settingsBtnRef.current.contains(e.target as Node)) return;
          if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
            commitPanel();
          }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [panelOpen, labelDraft, colorDraft, bgColorDraft, actionDraft, urlDraft, rulesDraft]);

      // REQ-084: sync rulesDraft from block.props when panel opens
      React.useEffect(() => {
        if (panelOpen) {
          try {
            const parsed = JSON.parse(block.props.rules ?? "[]");
            setRulesDraft(Array.isArray(parsed) ? parsed : []);
          } catch { setRulesDraft([]); }
          setShowRuleTypeMenu(false);
        }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [panelOpen]);

      const commitPanel = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.updateBlock(block, { props: { label: labelDraft, color: colorDraft, bgColor: bgColorDraft, action: actionDraft, url: urlDraft, rules: JSON.stringify(rulesDraft) } } as any);
        setPanelOpen(false);
      };

      return (
        <div className="button-block" ref={wrapRef}>
          <button
            ref={mainBtnRef}
            className={`button-block-btn color-${color} bg-${bgColor}`}
            title={action === "open_url" ? url : undefined}
          >
            {label}
          </button>
          <button
            ref={settingsBtnRef}
            className="button-block-settings-btn"
            title="设置"
          >
            ⚙
          </button>
          {panelOpen && (
            <div
              className="button-block-panel"
              ref={panelRef}
              style={{ position: "fixed", top: panelPos.top, left: panelPos.left }}
            >
              <label>
                标签文案
                <input
                  value={labelDraft}
                  onChange={e => setLabelDraft(e.target.value)}
                  placeholder="按钮文案"
                />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>颜色</span>
                <div className="color-swatch-row">
                  {BUTTON_COLORS.map(c => (
                    <button
                      key={c.value}
                      className={`color-swatch${colorDraft === c.value ? " selected" : ""}`}
                      style={{ background: c.hex }}
                      title={c.label}
                      onMouseDown={ev => { ev.preventDefault(); setColorDraft(c.value); }}
                    />
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>背景色</span>
                <div className="color-swatch-row">
                  {BUTTON_BG_COLORS.map(c => (
                    <button
                      key={c.value}
                      className={`color-swatch${bgColorDraft === c.value ? " selected" : ""}`}
                      style={{ background: c.hex }}
                      title={c.label}
                      onMouseDown={ev => { ev.preventDefault(); setBgColorDraft(c.value); }}
                    />
                  ))}
                </div>
              </div>
              <PanelSelect
                label="点击动作"
                value={actionDraft}
                onChange={v => setActionDraft(v as ButtonAction)}
                options={[
                  { value: "none", label: "无动作" },
                  { value: "open_url", label: "打开链接" },
                  { value: "new_subpage", label: "新建子页面" },
                  { value: "edit_page_props", label: "编辑页面属性" },
                  { value: "run_rules", label: "运行规则" },
                ]}
              />
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
              {actionDraft === "run_rules" && (
                <div className="button-rules-editor">
                  {rulesDraft.length === 0 && (
                    <div className="button-rules-empty">暂无规则，点击添加</div>
                  )}
                  {rulesDraft.map((rule, idx) => (
                    <div key={idx} className="button-rule-row">
                      <div className="button-rule-header">
                        <span className="button-rule-type-label">
                          {idx + 1}. {
                            rule.type === "create_page" ? "创建页面" :
                            rule.type === "append_content" ? "追加内容" :
                            rule.type === "set_page_prop" ? "修改页面属性" :
                            "发送通知"
                          }
                        </span>
                        <div className="button-rule-actions">
                          <button
                            className="button-rule-btn"
                            disabled={idx === 0}
                            onMouseDown={ev => ev.preventDefault()}
                            onClick={() => {
                              if (idx === 0) return;
                              setRulesDraft(prev => {
                                const next = [...prev];
                                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                return next;
                              });
                            }}
                          >↑</button>
                          <button
                            className="button-rule-btn"
                            disabled={idx === rulesDraft.length - 1}
                            onMouseDown={ev => ev.preventDefault()}
                            onClick={() => {
                              if (idx === rulesDraft.length - 1) return;
                              setRulesDraft(prev => {
                                const next = [...prev];
                                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                return next;
                              });
                            }}
                          >↓</button>
                          <button
                            className="button-rule-btn button-rule-delete"
                            onMouseDown={ev => ev.preventDefault()}
                            onClick={() => setRulesDraft(prev => prev.filter((_, i) => i !== idx))}
                          >×</button>
                        </div>
                      </div>
                      {rule.type === "create_page" && (
                        <div className="button-rule-params">
                          <label>标题</label>
                          <input
                            type="text"
                            value={rule.title}
                            placeholder="Untitled"
                            onChange={ev => setRulesDraft(prev => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], title: ev.target.value } as ButtonRule;
                              return next;
                            })}
                          />
                          <label>父级</label>
                          <select
                            value={rule.parent}
                            onChange={ev => setRulesDraft(prev => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], parent: ev.target.value as "current" | "root" } as ButtonRule;
                              return next;
                            })}
                          >
                            <option value="current">当前页面</option>
                            <option value="root">工作区根目录</option>
                          </select>
                        </div>
                      )}
                      {rule.type === "append_content" && (
                        <div className="button-rule-params">
                          <label>内容</label>
                          <input
                            type="text"
                            value={rule.text}
                            placeholder="支持 {{date}} {{time}} {{page_title}}"
                            onChange={ev => setRulesDraft(prev => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], text: ev.target.value } as ButtonRule;
                              return next;
                            })}
                          />
                        </div>
                      )}
                      {rule.type === "set_page_prop" && (
                        <div className="button-rule-params">
                          <label>属性</label>
                          <select
                            value={rule.prop}
                            onChange={ev => setRulesDraft(prev => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], prop: ev.target.value as "title" | "icon" | "cover" } as ButtonRule;
                              return next;
                            })}
                          >
                            <option value="title">标题</option>
                            <option value="icon">图标</option>
                            <option value="cover">封面</option>
                          </select>
                          <label>值</label>
                          <input
                            type="text"
                            value={rule.value}
                            placeholder="支持 {{date}} {{time}} {{page_title}}"
                            onChange={ev => setRulesDraft(prev => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], value: ev.target.value } as ButtonRule;
                              return next;
                            })}
                          />
                        </div>
                      )}
                      {rule.type === "notify" && (
                        <div className="button-rule-params">
                          <label>消息</label>
                          <input
                            type="text"
                            value={rule.message}
                            placeholder="支持 {{date}} {{time}} {{page_title}}"
                            onChange={ev => setRulesDraft(prev => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], message: ev.target.value } as ButtonRule;
                              return next;
                            })}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    className="button-rules-add"
                    disabled={rulesDraft.length >= 10}
                    title={rulesDraft.length >= 10 ? "最多 10 条" : undefined}
                    onMouseDown={ev => ev.preventDefault()}
                    onClick={() => setShowRuleTypeMenu(true)}
                  >
                    + 添加规则
                  </button>
                  {showRuleTypeMenu && (
                    <div className="button-rule-type-menu">
                      {([
                        { type: "create_page" as const, label: "创建页面", defaults: { title: "", parent: "current" as const } },
                        { type: "append_content" as const, label: "追加内容", defaults: { text: "" } },
                        { type: "set_page_prop" as const, label: "修改页面属性", defaults: { prop: "title" as const, value: "" } },
                        { type: "notify" as const, label: "发送通知", defaults: { message: "" } },
                      ]).map(({ type, label: optLabel, defaults }) => (
                        <button
                          key={type}
                          className="button-rule-type-option"
                          onMouseDown={ev => ev.preventDefault()}
                          onClick={() => {
                            setRulesDraft(prev => [...prev, { type, ...defaults } as ButtonRule]);
                            setShowRuleTypeMenu(false);
                          }}
                        >
                          {optLabel}
                        </button>
                      ))}
                      <button
                        className="button-rule-type-cancel"
                        onMouseDown={ev => ev.preventDefault()}
                        onClick={() => setShowRuleTypeMenu(false)}
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                style={{ alignSelf: "flex-end", padding: "4px 10px", fontSize: 12, cursor: "pointer", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-accent)", color: "#fff" }}
                onClick={() => commitPanel()}
              >
                确认
              </button>
            </div>
          )}
          {pagePropsPanelOpen && pagePropsPanelAnchorRect && (
            <PagePropsPanel
              pageId={buttonBlockCtxRef.pageId}
              anchorRect={pagePropsPanelAnchorRect}
              onClose={() => setPagePropsPanelOpen(false)}
            />
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
    // Keep multiColumnDropCursor for handleDrop logic (columnList creation).
    // Visual overlay is suppressed (width: 0, color: false); dropOverlayPlugin handles rendering.
    dropCursor: (opts) => multiColumnDropCursor({ ...opts, color: false, width: 0 }),
    uploadFile: async (file: File) => {
      const data = await api.uploads.upload(file);
      // 后端返回相对路径后需拼接 API_BASE；startsWith("http") 保持过渡期兼容
      const url = data.url.startsWith("http") ? data.url : API_BASE + data.url;
      return url;
    },
  });

  // Register dropOverlayPlugin once after editor mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const overlayPlugin = useMemo(() => dropOverlayPlugin(editor), []);
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiptap = (editor as any)._tiptapEditor;
    if (tiptap) {
      tiptap.registerPlugin(overlayPlugin);
    }
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = (editor as any)._tiptapEditor;
      if (t) {
        t.unregisterPlugin(overlayPlugin.spec.key);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const readyRef = useRef(false);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  // REQ-083 FR-3: keep module-level ctxRef in sync so ButtonBlock's mousedown handler
  // (registered once at mount, outside Editor's render scope) can read the latest values.
  useEffect(() => {
    buttonBlockCtxRef.pageId = pageId;
    buttonBlockCtxRef.onSelectPage = onSelectPage;
  }, [pageId, onSelectPage]);

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
      const blockDto: Partial<Block> = { id: b.id, page_id: pid, parent_block_id: parentBlockId, type: b.type, content: JSON.stringify((b as { content?: unknown }).content ?? []), props: JSON.stringify((b as { props?: unknown }).props ?? {}), order_index: i };
      const childDtos = buildDtosRecursive((b as { children?: unknown[] }).children ?? [], pid, b.id);
      return [blockDto, ...childDtos];
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

      const bn: BNBlock[] = blocks && blocks.length > 0
        ? toBlockNote(blocks)
        : [{ id: "initial-paragraph", type: "paragraph", props: {}, content: [], children: [] }];

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BlockNote's Block type differs from BNBlock; cast required
          editor.replaceBlocks(editor.document, bn as any);
        } catch (err) { console.error('[Editor] replaceBlocks failed:', err, 'pageId:', currentPageId); }
        requestAnimationFrame(() => {
          readyRef.current = true;
          const targetBlockId = sessionStorage.getItem("search_target_block");
          if (targetBlockId) {
            sessionStorage.removeItem("search_target_block");
            const el = document.querySelector<HTMLElement>(`[data-id="${targetBlockId}"]`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("search-highlight");
              setTimeout(() => el.classList.remove("search-highlight"), 800);
            }
          }
        });
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

  // ISS-032 副作用修复 + ISS-034 方案B：仅对 blocknote 内部拖拽启用 move 模式并阻止默认行为，
  // 避免外部文件拖入被错误设为 move，同时通过 preventDefault 覆盖 WKWebView 的 Copy 干扰。
  const handleEditorDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes("blocknote/html")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };

  return (
    <div className="editor-wrap" onDragOver={handleEditorDragOver}>
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
        <SideMenuController />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <DatabaseSlashItem editor={editor as any} pageId={pageId} />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <MentionMenu editor={editor as any} />
      </BlockNoteView>
    </div>
  );
});

// Suggestion menu floating options: flip to top when viewport bottom space is insufficient
const suggestionMenuFloatingOptions = {
  placement: "bottom-start" as const,
  middleware: [
    offset(10),
    flip({
      boundary: document.documentElement,
      fallbackAxisSideDirection: "start" as const,
      padding: 10,
    }),
    shift({ boundary: document.documentElement }),
    size({
      boundary: document.documentElement,
      apply({ availableHeight, elements }: { availableHeight: number; elements: { floating: HTMLElement } }) {
        Object.assign(elements.floating.style, {
          maxHeight: `${Math.max(availableHeight - 10, 80)}px`,
        });
      },
    }),
  ],
};

// 斜杠菜单：默认项 + database + divider + quote
function DatabaseSlashItem({
  editor,
  pageId,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: BlockNoteEditor<any>;
  pageId: string;
}) {
  return (
    <SuggestionMenuController
      triggerCharacter="/"
      floatingOptions={suggestionMenuFloatingOptions}
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
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: BlockNoteEditor<any>;
}) {
  return (
    <SuggestionMenuController
      triggerCharacter="@"
      floatingOptions={suggestionMenuFloatingOptions}
      getItems={async (query) => {
        const pages = await api.pages.search(query || " ");
        return (pages ?? []).map(page => ({
          title: page.title || "Untitled",
          onItemClick: () => {
            editor.insertInlineContent([
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              {
                type: "mention",
                props: { pageId: page.id, title: page.title || "Untitled", icon: page.icon ?? "📄" },
              } as any,
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
