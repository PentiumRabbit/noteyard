import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Page } from "../../types";
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

function PageItem({
  page,
  depth,
  selectedId,
  onSelect,
  onRefresh,
}: {
  page: Page;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(page.title || "Untitled");
  const hasChildren = (page.children?.length ?? 0) > 0;

  const handleRename = async () => {
    await api.pages.update(page.id, { ...page, title });
    setEditing(false);
    onRefresh();
  };

  const handleAddChild = async () => {
    const maxOrder = Math.max(0, ...(page.children?.map((c) => c.order_index) ?? [0]));
    await api.pages.create({ parent_id: page.id, title: "Untitled", order_index: maxOrder + 1 });
    setExpanded(true);
    onRefresh();
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${page.title || "Untitled"}" and all subpages?`)) return;
    await api.pages.delete(page.id);
    onRefresh();
  };

  return (
    <div className="page-item" style={{ paddingLeft: depth * 16 }}>
      <div className={`page-row${selectedId === page.id ? " selected" : ""}`}>
        <span className="expand-btn" onClick={() => setExpanded((v) => !v)}>
          {hasChildren ? (expanded ? "▾" : "▸") : "·"}
        </span>
        {editing ? (
          <input
            autoFocus
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
          />
        ) : (
          <span
            className="page-title"
            onClick={() => onSelect(page.id)}
            onDoubleClick={() => setEditing(true)}
          >
            {page.title || "Untitled"}
          </span>
        )}
        <span className="page-actions">
          <button onClick={handleAddChild} title="Add subpage">+</button>
          <button onClick={handleDelete} title="Delete">×</button>
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
        />
      ))}
    </div>
  );
}

export function Sidebar({ selectedId, onSelect }: Props) {
  const [tree, setTree] = useState<Page[]>([]);

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

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">noteyard</span>
        <button className="new-page-btn" onClick={() => void handleAddRoot()} title="New page">+</button>
      </div>
      <div className="sidebar-pages">
        {tree.map((p) => (
          <PageItem
            key={p.id}
            page={p}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            onRefresh={refresh}
          />
        ))}
      </div>
    </aside>
  );
}
