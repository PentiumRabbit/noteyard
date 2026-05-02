import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../../api/client";
import type { Page } from "../../types";
import { TEMPLATES } from "../../templates";
import "./Sidebar.css";

interface RecentItem { id: string; title: string; icon: string | null; visitedAt: number }

const RECENT_KEY = "noteyard:recent";
const FAVORITES_KEY = "noteyard:favorites";
const RECENT_MAX = 10;

function loadRecent(): RecentItem[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as RecentItem[]; } catch { return []; }
}
function saveRecent(items: RecentItem[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(items));
}
function recordVisit(id: string, title: string, icon: string | null) {
  const items = loadRecent().filter(r => r.id !== id);
  items.unshift({ id, title, icon, visitedAt: Date.now() });
  saveRecent(items.slice(0, RECENT_MAX));
}

function loadFavorites(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}
function saveFavorites(set: Set<string>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
}

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
  settingsActive: boolean;
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

export function Sidebar({ selectedId, onSelect, onOpenSettings, settingsActive }: Props) {
  const [tree, setTree] = useState<Page[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashedPages, setTrashedPages] = useState<Page[]>([]);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const renamingPageIdRef = useRef<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const refresh = async () => {
    const pages = await api.pages.listAll();
    setTree(buildTree(pages ?? []));
  };

  useEffect(() => { void refresh(); }, []);

  const handleSelect = (id: string) => {
    const page = findPageFlat(id, tree);
    if (page) recordVisit(id, page.title || "Untitled", page.icon ?? null);
    setRecentItems(loadRecent());
    onSelect(id);
  };

  const applyTemplate = async (templateId: string) => {
    const tpl = TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return;
    const maxOrder = Math.max(0, ...tree.map(p => p.order_index));
    const page = await api.pages.create({ title: tpl.name, icon: tpl.icon, order_index: maxOrder + 1 });
    if (tpl.blocks.length > 0) {
      await api.blocks.batchUpdate(tpl.blocks.map((b, i) => ({
        id: crypto.randomUUID(),
        page_id: page.id,
        type: (b as { type: string }).type,
        content: JSON.stringify((b as { content?: unknown }).content ?? []),
        props: JSON.stringify((b as { props?: unknown }).props ?? {}),
        order_index: i,
        parent_block_id: null,
      })));
    }
    setTemplateOpen(false);
    void refresh();
    handleSelect(page.id);
  };

  const toggleFavorite = (id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveFavorites(next);
      return next;
    });
  };

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

  const handleCtxCopy = async () => {
    if (!ctxMenu) return;
    const src = findPage(tree, ctxMenu.pageId);
    closeCtxMenu();
    if (!src) return;
    const [srcPage, srcBlocks] = await Promise.all([
      api.pages.get(src.id),
      api.blocks.listByPage(src.id),
    ]);
    const newPage = await api.pages.create({
      parent_id: srcPage.parent_id ?? undefined,
      title: `${srcPage.title || "Untitled"} 副本`,
      icon: srcPage.icon ?? undefined,
      cover: srcPage.cover ?? undefined,
      order_index: srcPage.order_index + 0.5,
    });
    if (srcBlocks.length > 0) {
      await api.blocks.batchUpdate(srcBlocks.map(b => ({ ...b, id: crypto.randomUUID(), page_id: newPage.id })));
    }
    void refresh();
    onSelect(newPage.id);
  };

  const handleCtxDelete = async () => {
    if (!ctxMenu) return;
    const page = findPage(tree, ctxMenu.pageId);
    if (!confirm(`将"${page?.title || "Untitled"}"移入回收站？`)) { closeCtxMenu(); return; }
    await api.pages.delete(ctxMenu.pageId);
    closeCtxMenu();
    void refresh();
  };

  const openTrash = async () => {
    const pages = await api.pages.listTrashed();
    setTrashedPages(pages ?? []);
    setTrashOpen(true);
  };

  const handleRestore = async (id: string) => {
    await api.pages.restore(id);
    const pages = await api.pages.listTrashed();
    setTrashedPages(pages ?? []);
    void refresh();
  };

  const handlePermanentDelete = async (id: string, title: string) => {
    if (!confirm(`永久删除"${title || "Untitled"}"？此操作无法撤销。`)) return;
    await api.pages.permanentDelete(id);
    const pages = await api.pages.listTrashed();
    setTrashedPages(pages ?? []);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = tree.findIndex(p => p.id === active.id);
    const newIndex = tree.findIndex(p => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = [...tree];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    // 计算新的 order_index：取相邻项的中间值
    const prev = reordered[newIndex - 1];
    const next = reordered[newIndex + 1];
    const newOrder = prev && next
      ? (prev.order_index + next.order_index) / 2
      : prev ? prev.order_index + 1 : next ? next.order_index - 1 : 0;
    await api.pages.update(String(active.id), { order_index: newOrder });
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

      {favorites.size > 0 && (
        <div className="sidebar-favorites">
          <button className="sidebar-section-header" onClick={() => setFavoritesOpen(v => !v)}>
            <span className="sidebar-section-arrow">{favoritesOpen ? "▾" : "▸"}</span>
            收藏
          </button>
          {favoritesOpen && (() => {
            const favPages = [...favorites].map(id => findPage(tree, id)).filter(Boolean) as Page[];
            return favPages.map(p => (
              <div key={p.id}
                className={`page-row fav-row${selectedId === p.id ? " selected" : ""}`}
                style={{ paddingLeft: 20 }}
                onClick={() => handleSelect(p.id)}>
                <span className="page-icon">{p.icon || "📄"}</span>
                <span className="page-title">{p.title || "Untitled"}</span>
                <span className="page-actions" onClick={e => e.stopPropagation()}>
                  <button className="page-action-btn" title="取消收藏" onClick={() => toggleFavorite(p.id)}>★</button>
                </span>
              </div>
            ));
          })()}
        </div>
      )}

      <div className="sidebar-pages">
        {tree.length === 0 && (
          <div className="sidebar-empty">暂无页面</div>
        )}
        <DndContext sensors={sensors} onDragStart={e => setActiveDragId(String(e.active.id))} onDragEnd={e => void handleDragEnd(e)}>
          <SortableContext items={tree.map(p => p.id)} strategy={verticalListSortingStrategy}>
            {tree.map((p) => (
              <SortablePageItem
                key={p.id}
                page={p}
                selectedId={selectedId}
                onSelect={handleSelect}
                onRefresh={refresh}
                onContextMenu={openCtxMenu}
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {activeDragId && (() => {
              const p = tree.find(x => x.id === activeDragId);
              return p ? (
                <div className="page-row page-row-drag-overlay" style={{ paddingLeft: 8 }}>
                  <span className="page-icon">{p.icon || "📄"}</span>
                  <span className="page-title">{p.title || "Untitled"}</span>
                </div>
              ) : null;
            })()}
          </DragOverlay>
        </DndContext>
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-new-page-btn" onClick={() => void handleAddRoot()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          新建页面
        </button>
        <button className="sidebar-new-page-btn" onClick={() => { setRecentItems(loadRecent()); setRecentOpen(true); }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7 4v3.2l2 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          最近访问
        </button>
        <button className="sidebar-new-page-btn" onClick={() => setTemplateOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M1.5 5.5h11M5.5 5.5v7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          模板
        </button>
        <button className="sidebar-new-page-btn" onClick={() => void openTrash()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 3.5h10M5 3.5V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1M11 3.5l-.7 7.7a.5.5 0 0 1-.5.45H4.2a.5.5 0 0 1-.5-.45L3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          回收站
        </button>
        <button
          className={`sidebar-new-page-btn${settingsActive ? " active" : ""}`}
          onClick={onOpenSettings}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M2.93 11.07l1.06-1.06M10.01 3.99l1.06-1.06" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          设置
        </button>
      </div>

      {trashOpen && (
        <div className="trash-overlay" onClick={() => setTrashOpen(false)}>
          <div className="trash-panel" onClick={e => e.stopPropagation()}>
            <div className="trash-header">
              <span className="trash-title">回收站</span>
              <button className="trash-close-btn" onClick={() => setTrashOpen(false)}>✕</button>
            </div>
            <div className="trash-list">
              {trashedPages.length === 0 && (
                <div className="trash-empty">回收站为空</div>
              )}
              {trashedPages.map(p => (
                <div key={p.id} className="trash-item">
                  <span className="trash-item-icon">{p.icon ?? "📄"}</span>
                  <span className="trash-item-title">{p.title || "Untitled"}</span>
                  <div className="trash-item-actions">
                    <button className="trash-action-btn" title="恢复" onClick={() => void handleRestore(p.id)}>↩</button>
                    <button className="trash-action-btn trash-action-danger" title="永久删除" onClick={() => void handlePermanentDelete(p.id, p.title || "")}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {recentOpen && (
        <div className="trash-overlay" onClick={() => setRecentOpen(false)}>
          <div className="trash-panel" onClick={e => e.stopPropagation()}>
            <div className="trash-header">
              <span className="trash-title">最近访问</span>
              <button className="trash-close-btn" onClick={() => setRecentOpen(false)}>✕</button>
            </div>
            <div className="trash-list">
              {recentItems.length === 0 && <div className="trash-empty">暂无记录</div>}
              {recentItems.map(r => (
                <div key={r.id} className="trash-item" style={{ cursor: "pointer" }} onClick={() => { setRecentOpen(false); handleSelect(r.id); }}>
                  <span className="trash-item-icon">{r.icon ?? "📄"}</span>
                  <span className="trash-item-title">{r.title}</span>
                  <span className="recent-item-time">{new Date(r.visitedAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {templateOpen && (
        <div className="trash-overlay" onClick={() => setTemplateOpen(false)}>
          <div className="trash-panel" onClick={e => e.stopPropagation()}>
            <div className="trash-header">
              <span className="trash-title">从模板新建</span>
              <button className="trash-close-btn" onClick={() => setTemplateOpen(false)}>✕</button>
            </div>
            <div className="trash-list">
              {TEMPLATES.map(tpl => (
                <div key={tpl.id} className="template-item" onClick={() => void applyTemplate(tpl.id)}>
                  <span className="template-icon">{tpl.icon}</span>
                  <div className="template-info">
                    <div className="template-name">{tpl.name}</div>
                    <div className="template-desc">{tpl.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {ctxMenu && (
        <>
          <div className="ctx-overlay" onClick={closeCtxMenu} />
          <div className="ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }}>
            <button className="ctx-item" onClick={handleCtxRename}>重命名</button>
            <button className="ctx-item" onClick={() => void handleCtxCopy()}>复制页面</button>
            <button className="ctx-item" onClick={() => { toggleFavorite(ctxMenu.pageId); closeCtxMenu(); }}>
              {favorites.has(ctxMenu.pageId) ? "★ 取消收藏" : "☆ 收藏"}
            </button>
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

function findPageFlat(id: string, tree: Page[]): Page | null {
  return findPage(tree, id);
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

function SortablePageItem({ page, selectedId, onSelect, onRefresh, onContextMenu }: {
  page: Page;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onContextMenu: (e: React.MouseEvent, pageId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <RenameAwarePageItem
        page={page}
        depth={0}
        selectedId={selectedId}
        onSelect={onSelect}
        onRefresh={onRefresh}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}
