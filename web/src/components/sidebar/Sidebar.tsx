import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { Page } from "../../types";
import { SettingsPanel } from "../settings/SettingsPanel";
import "./Sidebar.css";

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function buildTree(pages: Page[]): Page[] {
  const map = new Map<string, Page>();
  pages.forEach((p) => map.set(p.id, { ...p, children: [] }));
  const roots: Page[] = [];
  map.forEach((p) => {
    if (p.parent_id && map.has(p.parent_id)) {
      map.get(p.parent_id)!.children!.push(p);
    } else {
      roots.push(p);
    }
  });
  return roots;
}

interface CtxMenu { pageId: string; x: number; y: number }

function PageItem({
  page,
  depth,
  selectedId,
  onSelect,
  onRefresh,
  onContextMenu,
}: {
  page: Page;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onContextMenu: (e: React.MouseEvent, pageId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(page.title || "Untitled");
  const hasChildren = (page.children?.length ?? 0) > 0;

  const handleRename = async () => {
    await api.pages.update(page.id, { ...page, title });
    setRenaming(false);
    onRefresh();
  };

  const handleAddChild = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const maxOrder = Math.max(0, ...(page.children?.map((c) => c.order_index) ?? [0]));
    await api.pages.create({ parent_id: page.id, title: "Untitled", order_index: maxOrder + 1 });
    setExpanded(true);
    onRefresh();
  };

  const icon = page.icon || "📄";

  return (
    <div className="page-item">
      <div
        className={`page-row${selectedId === page.id ? " selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => { if (!renaming) onSelect(page.id); }}
        onContextMenu={e => onContextMenu(e, page.id)}
      >
        <span
          className={`expand-btn${hasChildren ? " has-children" : ""}`}
          onClick={e => { e.stopPropagation(); if (hasChildren) setExpanded(v => !v); }}
        >
          {hasChildren ? (
            expanded
              ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : null}
        </span>

        <span className="page-icon">{icon}</span>

        {renaming ? (
          <input
            autoFocus
            className="page-rename-input"
            value={title}
            onClick={e => e.stopPropagation()}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => void handleRename()}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); void handleRename(); }
              if (e.key === "Escape") { setTitle(page.title || "Untitled"); setRenaming(false); }
            }}
          />
        ) : (
          <span className="page-title">{page.title || "Untitled"}</span>
        )}

        <span className="page-actions" onClick={e => e.stopPropagation()}>
          <button className="page-action-btn" onClick={e => onContextMenu(e, page.id)} title="更多操作">⋯</button>
          <button className="page-action-btn" onClick={e => void handleAddChild(e)} title="新建子页面">+</button>
        </span>
      </div>

      {expanded && page.children?.map((child) => (
        <PageItem
          key={child.id}
          page={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onRefresh={onRefresh}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

export function Sidebar({ selectedId, onSelect }: Props) {
  const [tree, setTree] = useState<Page[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const renamingPageIdRef = useRef<string | null>(null);

  const refresh = async () => {
    const pages = await api.pages.listAll();
    setTree(buildTree(pages ?? []));
  };

  useEffect(() => { void refresh(); }, []);

  const handleAddRoot = async () => {
    const maxOrder = Math.max(0, ...tree.map((p) => p.order_index));
    const page = await api.pages.create({ title: "Untitled", order_index: maxOrder + 1 });
    await refresh();
    onSelect(page.id);
  };

  const openCtxMenu = (e: React.MouseEvent, pageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ pageId, x: e.clientX, y: e.clientY });
  };

  const closeCtxMenu = () => setCtxMenu(null);

  const handleCtxRename = () => {
    renamingPageIdRef.current = ctxMenu?.pageId ?? null;
    closeCtxMenu();
    // trigger rename on matching PageItem via DOM focus hack — simpler: re-render via key
    // We'll use a global event pattern
    if (ctxMenu?.pageId) {
      const evt = new CustomEvent("rename-page", { detail: ctxMenu.pageId });
      window.dispatchEvent(evt);
    }
  };

  const handleCtxDelete = async () => {
    if (!ctxMenu) return;
    const page = findPage(tree, ctxMenu.pageId);
    if (!confirm(`删除"${page?.title || "Untitled"}"及所有子页面？`)) { closeCtxMenu(); return; }
    await api.pages.delete(ctxMenu.pageId);
    closeCtxMenu();
    void refresh();
  };

  if (collapsed) {
    return (
      <div className="sidebar sidebar-collapsed">
        <button className="sidebar-expand-btn" onClick={() => setCollapsed(false)} title="展开侧边栏">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">noteyard</span>
        <div className="sidebar-header-actions">
          <button className="sidebar-icon-btn" onClick={() => void handleAddRoot()} title="新建页面">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <button className="sidebar-icon-btn" onClick={() => setCollapsed(true)} title="收起侧边栏">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      <div className="sidebar-pages">
        {tree.length === 0 && (
          <div className="sidebar-empty">暂无页面</div>
        )}
        {tree.map((p) => (
          <RenameAwarePageItem
            key={p.id}
            page={p}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            onRefresh={refresh}
            onContextMenu={openCtxMenu}
          />
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-new-page-btn" onClick={() => void handleAddRoot()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          新建页面
        </button>
        <button
          ref={settingsBtnRef}
          className="sidebar-new-page-btn"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M2.93 11.07l1.06-1.06M10.01 3.99l1.06-1.06" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          设置
        </button>
      </div>

      {settingsOpen && (
        <SettingsPanel anchorRef={settingsBtnRef} onClose={() => setSettingsOpen(false)} />
      )}

      {ctxMenu && (
        <>
          <div className="ctx-overlay" onClick={closeCtxMenu} />
          <div className="ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }}>
            <button className="ctx-item" onClick={handleCtxRename}>重命名</button>
            <div className="ctx-divider" />
            <button className="ctx-item ctx-item-danger" onClick={() => void handleCtxDelete()}>删除</button>
          </div>
        </>
      )}
    </aside>
  );
}

function findPage(tree: Page[], id: string): Page | null {
  for (const p of tree) {
    if (p.id === id) return p;
    if (p.children) {
      const found = findPage(p.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Wrapper that listens for global rename events
function RenameAwarePageItem(props: React.ComponentProps<typeof PageItem>) {
  const [renameTrigger, setRenameTrigger] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === props.page.id) {
        setRenameTrigger(v => v + 1);
      }
    };
    window.addEventListener("rename-page", handler);
    return () => window.removeEventListener("rename-page", handler);
  }, [props.page.id]);

  return <PageItemWithRename {...props} renameTrigger={renameTrigger} />;
}

function PageItemWithRename({
  page,
  depth,
  selectedId,
  onSelect,
  onRefresh,
  onContextMenu,
  renameTrigger,
}: React.ComponentProps<typeof PageItem> & { renameTrigger: number }) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(page.title || "Untitled");
  const hasChildren = (page.children?.length ?? 0) > 0;

  useEffect(() => {
    if (renameTrigger > 0) {
      setTitle(page.title || "Untitled");
      setRenaming(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameTrigger]);

  // sync title when page prop updates
  useEffect(() => {
    if (!renaming) setTitle(page.title || "Untitled");
  }, [page.title, renaming]);

  const handleRename = async () => {
    await api.pages.update(page.id, { ...page, title });
    setRenaming(false);
    onRefresh();
  };

  const handleAddChild = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const maxOrder = Math.max(0, ...(page.children?.map((c) => c.order_index) ?? [0]));
    await api.pages.create({ parent_id: page.id, title: "Untitled", order_index: maxOrder + 1 });
    setExpanded(true);
    onRefresh();
  };

  const icon = page.icon || "📄";

  return (
    <div className="page-item">
      <div
        className={`page-row${selectedId === page.id ? " selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => { if (!renaming) onSelect(page.id); }}
        onContextMenu={e => onContextMenu(e, page.id)}
      >
        <span
          className={`expand-btn${hasChildren ? " has-children" : ""}`}
          onClick={e => { e.stopPropagation(); if (hasChildren) setExpanded(v => !v); }}
        >
          {hasChildren ? (
            expanded
              ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : null}
        </span>

        <span className="page-icon">{icon}</span>

        {renaming ? (
          <input
            autoFocus
            className="page-rename-input"
            value={title}
            onClick={e => e.stopPropagation()}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => void handleRename()}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); void handleRename(); }
              if (e.key === "Escape") { setTitle(page.title || "Untitled"); setRenaming(false); }
            }}
          />
        ) : (
          <span className="page-title">{page.title || "Untitled"}</span>
        )}

        <span className="page-actions" onClick={e => e.stopPropagation()}>
          <button className="page-action-btn" onClick={e => onContextMenu(e, page.id)} title="更多操作">⋯</button>
          <button className="page-action-btn" onClick={e => void handleAddChild(e)} title="新建子页面">+</button>
        </span>
      </div>

      {expanded && page.children?.map((child) => (
        <RenameAwarePageItem
          key={child.id}
          page={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onRefresh={onRefresh}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}
