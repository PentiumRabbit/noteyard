import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { DBColumn, DBRow, RelationColumnOptions } from "../../types";

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

interface RelationCellProps {
  column: DBColumn;
  value: string; // JSON array of row IDs
  onChange: (newValue: string) => void;
  /** Pre-loaded target rows to avoid N+1 per cell. If provided, getRow won't be called. */
  targetRowsCache?: Map<string, DBRow | null>;
}

function parseIds(raw: string): string[] {
  if (!raw || raw === "[]") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function getOpts(col: DBColumn): RelationColumnOptions | null {
  try {
    const opts = JSON.parse(col.options);
    if (opts && typeof opts === "object" && "target_database_id" in opts) {
      return opts as RelationColumnOptions;
    }
    return null;
  } catch {
    return null;
  }
}

/** Get the display label for a row (first cell value or 未命名). */
function rowLabel(row: DBRow | null | undefined): string {
  if (!row) return "已删除";
  const cells = row.cells ?? {};
  const firstVal = Object.values(cells)[0];
  return firstVal || "未命名";
}

export function RelationCell({ column, value, onChange, targetRowsCache }: RelationCellProps) {
  const opts = getOpts(column);
  const targetDbId = opts?.target_database_id ?? "";
  const selectedIds = parseIds(value);

  // resolved labels for selected IDs
  const [resolvedRows, setResolvedRows] = useState<Map<string, DBRow | null>>(new Map());

  // picker modal state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerUpward, setPickerUpward] = useState(false);
  const [pickerRows, setPickerRows] = useState<DBRow[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load resolved rows for selected IDs
  useEffect(() => {
    if (!targetDbId || selectedIds.length === 0) return;

    const missing = selectedIds.filter(id => !resolvedRows.has(id));
    if (missing.length === 0) return;

    void (async () => {
      const updates = new Map<string, DBRow | null>(resolvedRows);
      await Promise.all(missing.map(async id => {
        // use cache if provided
        if (targetRowsCache?.has(id)) {
          updates.set(id, targetRowsCache.get(id) ?? null);
          return;
        }
        try {
          const row = await api.databases.getRow(targetDbId, id);
          updates.set(id, row);
        } catch {
          updates.set(id, null); // deleted
        }
      }));
      setResolvedRows(new Map(updates));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, targetDbId]);

  // Apply external cache updates
  useEffect(() => {
    if (!targetRowsCache || targetRowsCache.size === 0) return;
    setResolvedRows(prev => {
      const next = new Map(prev);
      let changed = false;
      for (const id of selectedIds) {
        if (targetRowsCache.has(id) && !next.has(id)) {
          next.set(id, targetRowsCache.get(id) ?? null);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRowsCache]);

  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!targetDbId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPickerUpward(window.innerHeight - rect.bottom < 240);
    setPickerOpen(true);
    setPickerSearch("");
    setPickerLoading(true);
    void api.databases.listRows(targetDbId).then(rows => {
      setPickerRows(rows ?? []);
      setPickerLoading(false);
    }).catch(() => {
      setPickerRows([]);
      setPickerLoading(false);
    });
  };

  useEffect(() => {
    if (pickerOpen) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [pickerOpen]);

  const toggleId = (id: string) => {
    const current = new Set(selectedIds);
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    const newIds = [...current];
    onChange(JSON.stringify(newIds));

    // Pre-populate resolved cache with newly selected row
    const targetRow = pickerRows.find(r => r.id === id);
    if (targetRow) {
      setResolvedRows(prev => new Map(prev).set(id, targetRow));
    }
  };

  const removeId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = selectedIds.filter(v => v !== id);
    onChange(JSON.stringify(next));
  };

  const handleCreateAndLink = async () => {
    if (!targetDbId || creating) return;
    setCreating(true);
    try {
      const newRow = await api.databases.addRow(targetDbId);
      if (newRow) {
        // Find the title column: fetch database schema and use first column id
        try {
          const db = await api.databases.get(targetDbId);
          const titleCol = db.columns.find(c => c.name.toLowerCase() === "title") ?? db.columns[0];
          if (titleCol) {
            await api.databases.updateCells(targetDbId, newRow.id, [
              { column_id: titleCol.id, value: pickerSearch.trim() },
            ]);
            // Update the row label in pickerRows so the tag shows correctly
            const updatedRow: DBRow = {
              ...newRow,
              cells: { ...newRow.cells, [titleCol.id]: pickerSearch.trim() },
            };
            setPickerRows(prev => [...prev, updatedRow]);
            setResolvedRows(prev => new Map(prev).set(newRow.id, updatedRow));
          } else {
            setPickerRows(prev => [...prev, newRow]);
            setResolvedRows(prev => new Map(prev).set(newRow.id, newRow));
          }
        } catch {
          setPickerRows(prev => [...prev, newRow]);
          setResolvedRows(prev => new Map(prev).set(newRow.id, newRow));
        }
        toggleId(newRow.id);
        setPickerSearch("");
      }
    } catch {
      // silently ignore creation errors
    } finally {
      setCreating(false);
    }
  };

  const PICKER_PAGE_SIZE = 50;

  const filteredPickerRows = pickerSearch.trim()
    ? pickerRows.filter(r => {
        const label = rowLabel(r).toLowerCase();
        return label.includes(pickerSearch.trim().toLowerCase());
      })
    : pickerRows.slice(0, PICKER_PAGE_SIZE);

  const showTruncationHint = !pickerSearch.trim() && pickerRows.length > PICKER_PAGE_SIZE;

  return (
    <div className="relation-cell" onClick={openPicker}>
      <div className="relation-tags">
        {selectedIds.length === 0 && (
          <span className="cell-empty">　</span>
        )}
        {selectedIds.map(id => {
          const row = resolvedRows.get(id);
          const label = row === undefined ? id : rowLabel(row);
          const isDeleted = row === null;
          return (
            <span
              key={id}
              className={`cell-tag relation-tag${isDeleted ? " relation-tag-deleted" : ""}`}
            >
              {label}
              <button
                className="relation-tag-remove"
                onClick={e => removeId(id, e)}
                title="移除"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>

      {pickerOpen && (
        <>
          <div
            className="relation-picker-overlay"
            onClick={e => { e.stopPropagation(); setPickerOpen(false); }}
          />
          <div
            className={`relation-picker${pickerUpward ? " relation-picker--upward" : ""}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="relation-picker-header">选择关联行</div>
            <input
              ref={searchRef}
              className="relation-picker-search"
              placeholder="搜索…"
              value={pickerSearch}
              onChange={e => setPickerSearch(e.target.value)}
            />
            <div className="relation-picker-list">
              {pickerLoading && <div className="relation-picker-loading">加载中…</div>}
              {!pickerLoading && filteredPickerRows.length === 0 && !pickerSearch.trim() && (
                <div className="relation-picker-empty">暂无数据</div>
              )}
              {!pickerLoading && filteredPickerRows.length === 0 && pickerSearch.trim() && (
                <button
                  className="relation-picker-item"
                  style={{ color: "var(--color-accent)", opacity: creating ? 0.6 : 1 }}
                  onClick={handleCreateAndLink}
                  disabled={creating}
                >
                  <PlusIcon />
                  <span>新建并关联『{pickerSearch.trim()}』</span>
                </button>
              )}
              {!pickerLoading && filteredPickerRows.map(row => {
                const isSelected = selectedIds.includes(row.id);
                const label = rowLabel(row);
                return (
                  <button
                    key={row.id}
                    className={`relation-picker-item${isSelected ? " selected" : ""}`}
                    onClick={() => toggleId(row.id)}
                  >
                    <span className="relation-picker-check">{isSelected ? "✓" : ""}</span>
                    <span className="relation-picker-label">{label}</span>
                  </button>
                );
              })}
              {!pickerLoading && showTruncationHint && (
                <div className="relation-picker-hint">显示前 50 条，输入搜索查找更多</div>
              )}
            </div>
            <div className="relation-picker-footer">
              <button
                className="relation-picker-done"
                onClick={() => setPickerOpen(false)}
              >
                完成
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
