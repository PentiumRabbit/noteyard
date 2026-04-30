import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { DBCell, DBColumn, DBRow, Database } from "../../types";
import { evalFormula } from "./formulaEngine";
import "./DatabaseView.css";

interface Props { databaseId: string }

const COL_TYPES: DBColumn["type"][] = ["text", "number", "checkbox", "select", "multi-select", "date", "formula"];

const COL_ICONS: Record<DBColumn["type"], string> = {
  text: "Aa",
  number: "#",
  checkbox: "☑",
  select: "≡",
  "multi-select": "≡≡",
  date: "📅",
  formula: "ƒ",
};

const TAG_COLORS = [
  { bg: "#f3f0ff", color: "#6e5fd6" },
  { bg: "#e8f4fd", color: "#2383e2" },
  { bg: "#edfaf3", color: "#0f9b5c" },
  { bg: "#fff3e0", color: "#d9730d" },
  { bg: "#fce8e8", color: "#eb5757" },
  { bg: "#f0f0f0", color: "#6b7280" },
  { bg: "#fdf4e3", color: "#b07d28" },
  { bg: "#eef0ff", color: "#4361c2" },
];

const SELECT_COLOR_NAMES = ["紫", "蓝", "绿", "橙", "红", "灰", "黄", "靛"];

function tagColor(val: string) {
  let h = 0;
  for (let i = 0; i < val.length; i++) h = (h * 31 + val.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}


interface ColMenu {
  colId: string;
  x: number;
  y: number;
  renaming: boolean;
  draft: string;
  changingType: boolean;
}

interface AddColPopover { x: number; y: number }
interface FormulaPopover { colId: string; x: number; y: number; draft: string; preview: string }
interface SelectOptionsPopover { colId: string; x: number; y: number; options: SelectOption[] }
interface SelectDropdown { rowId: string; colId: string; x: number; y: number; options: SelectOption[] }
interface RowModal { row: DBRow }
interface SelectOption { value: string; colorIdx: number }
interface SortState { colId: string; order: "asc" | "desc" }
interface FilterState { colId: string; op: string; val: string }
type ToolbarPanel = "sort" | "filter" | "hide" | null

function parseOptions(raw: string): SelectOption[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((item: unknown) => {
      if (typeof item === "string") return { value: item, colorIdx: 0 };
      if (typeof item === "object" && item !== null && "value" in item) {
        const o = item as { value: string; colorIdx?: number };
        return { value: o.value, colorIdx: o.colorIdx ?? 0 };
      }
      return { value: String(item), colorIdx: 0 };
    });
  } catch {
    return [];
  }
}

function serializeOptions(opts: SelectOption[]): string {
  return JSON.stringify(opts);
}

export function DatabaseView({ databaseId }: Props) {
  const [db, setDb] = useState<Database | null>(null);
  const [rows, setRows] = useState<DBRow[]>([]);
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const [colMenu, setColMenu] = useState<ColMenu | null>(null);
  const [addColPopover, setAddColPopover] = useState<AddColPopover | null>(null);
  const [formulaPopover, setFormulaPopover] = useState<FormulaPopover | null>(null);
  const [selectOptionsPopover, setSelectOptionsPopover] = useState<SelectOptionsPopover | null>(null);
  const [selectDropdown, setSelectDropdown] = useState<SelectDropdown | null>(null);
  const [rowModal, setRowModal] = useState<RowModal | null>(null);
  const [rowModalDraft, setRowModalDraft] = useState<Record<string, string>>({});
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<DBColumn["type"]>("text");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [newOptionName, setNewOptionName] = useState("");
  const [sortState, setSortState] = useState<SortState | null>(null);
  const [filterState, setFilterState] = useState<FilterState | null>(null);
  const [toolbarPanel, setToolbarPanel] = useState<ToolbarPanel>(null);
  const [multiSelectDropdown, setMultiSelectDropdown] = useState<{ rowId: string; colId: string; x: number; y: number; options: SelectOption[] } | null>(null);

  const cellInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newColInputRef = useRef<HTMLInputElement>(null);
  const formulaInputRef = useRef<HTMLTextAreaElement>(null);
  const resizingRef = useRef<{ colId: string; startX: number; startWidth: number } | null>(null);

  const reload = useCallback(async (sort?: SortState | null, filter?: FilterState | null) => {
    const [dbData, rowData] = await Promise.all([
      api.databases.get(databaseId),
      api.databases.listRows(databaseId, {
        sortCol: sort?.colId,
        sortOrder: sort?.order,
        filterCol: filter?.colId,
        filterOp: filter?.op,
        filterVal: filter?.val,
      }),
    ]);
    setDb(dbData);
    setRows(rowData ?? []);
  }, [databaseId]);

  useEffect(() => { void reload(sortState, filterState); }, [reload, sortState, filterState]);

  useEffect(() => { if (editingCell) cellInputRef.current?.focus(); }, [editingCell]);
  useEffect(() => { if (titleEditing) titleInputRef.current?.select(); }, [titleEditing]);
  useEffect(() => { if (colMenu?.renaming) renameInputRef.current?.select(); }, [colMenu?.renaming]);
  useEffect(() => { if (addColPopover) newColInputRef.current?.focus(); }, [addColPopover]);
  useEffect(() => { if (formulaPopover) formulaInputRef.current?.focus(); }, [formulaPopover]);

  // ── title ──
  const startTitleEdit = () => { setTitleDraft(db?.title ?? ""); setTitleEditing(true); };
  const commitTitle = async () => {
    setTitleEditing(false);
    if (!titleDraft.trim() || titleDraft === db?.title) return;
    await api.databases.updateTitle(databaseId, titleDraft.trim());
    void reload();
  };

  // ── cell edit ──
  const startEdit = (rowId: string, colId: string, val: string) => {
    setEditingCell({ rowId, colId });
    setCellDraft(val);
  };

  const commitEdit = async (rowId: string, colId: string) => {
    setEditingCell(null);
    const cells: DBCell[] = [{ column_id: colId, value: cellDraft }];
    await api.databases.updateCells(databaseId, rowId, cells);
    void reload();
  };

  const toggleCheckbox = async (rowId: string, colId: string, val: string) => {
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value: val === "true" ? "false" : "true" }]);
    void reload();
  };

  // ── keyboard navigation ──
  const handleCellKeyDown = (e: React.KeyboardEvent, rowId: string, colId: string) => {
    if (!db) return;
    const cols = db.columns.slice().sort((a, b) => a.order_index - b.order_index).filter(c => c.type !== "formula" && c.type !== "checkbox");
    const colIdx = cols.findIndex(c => c.id === colId);
    const rowIdx = rows.findIndex(r => r.id === rowId);

    if (e.key === "Tab") {
      e.preventDefault();
      void commitEdit(rowId, colId).then(() => {
        const nextColIdx = e.shiftKey ? colIdx - 1 : colIdx + 1;
        if (nextColIdx >= 0 && nextColIdx < cols.length) {
          const nextCol = cols[nextColIdx];
          const val = rows[rowIdx]?.cells[nextCol.id] ?? "";
          startEdit(rowId, nextCol.id, val);
        } else if (!e.shiftKey && rowIdx + 1 < rows.length) {
          const nextRow = rows[rowIdx + 1];
          const val = nextRow.cells[cols[0]?.id ?? ""] ?? "";
          startEdit(nextRow.id, cols[0]?.id ?? "", val);
        } else if (e.shiftKey && rowIdx > 0) {
          const prevRow = rows[rowIdx - 1];
          const lastCol = cols[cols.length - 1];
          const val = prevRow.cells[lastCol?.id ?? ""] ?? "";
          startEdit(prevRow.id, lastCol?.id ?? "", val);
        }
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      void commitEdit(rowId, colId).then(() => {
        if (rowIdx + 1 < rows.length) {
          const nextRow = rows[rowIdx + 1];
          const val = nextRow.cells[colId] ?? "";
          startEdit(nextRow.id, colId, val);
        }
      });
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  // ── rows ──
  const addRow = async () => { await api.databases.addRow(databaseId); void reload(); };
  const deleteRow = async (rowId: string) => { await api.databases.deleteRow(databaseId, rowId); void reload(); };

  // ── column menu ──
  const openColMenu = (e: React.MouseEvent, col: DBColumn) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setColMenu({ colId: col.id, x: rect.left, y: rect.bottom + 4, renaming: false, draft: col.name, changingType: false });
  };
  const closeColMenu = () => setColMenu(null);

  const commitRename = async () => {
    if (!colMenu) return;
    const col = db?.columns.find(c => c.id === colMenu.colId);
    if (!col || !colMenu.draft.trim()) { closeColMenu(); return; }
    await api.databases.updateColumn(databaseId, col.id, { ...col, name: colMenu.draft.trim() });
    closeColMenu();
    void reload();
  };

  const changeColType = async (type: DBColumn["type"]) => {
    if (!colMenu) return;
    const col = db?.columns.find(c => c.id === colMenu.colId);
    if (!col) return;
    setError(null);
    try { await api.databases.updateColumn(databaseId, col.id, { ...col, type }); }
    catch (e) { setError((e as Error).message); }
    closeColMenu();
    void reload();
  };

  const deleteCol = async () => {
    if (!colMenu) return;
    if (!confirm("删除此列将同时删除所有该列数据，确认？")) return;
    await api.databases.deleteColumn(databaseId, colMenu.colId);
    closeColMenu();
    void reload();
  };

  // ── add column ──
  const openAddCol = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAddColPopover({ x: rect.left, y: rect.bottom + 4 });
    setNewColName("");
    setNewColType("text");
  };

  const submitNewCol = async () => {
    if (!newColName.trim()) return;
    setError(null);
    try {
      await api.databases.addColumn(databaseId, {
        name: newColName.trim(), type: newColType,
        options: "[]", formula: "", order_index: db?.columns.length ?? 0,
      });
      setAddColPopover(null);
      void reload();
    } catch (e) { setError((e as Error).message); }
  };

  // ── formula popover ──
  const openFormulaPopover = (e: React.MouseEvent, col: DBColumn) => {
    const menuEl = (e.currentTarget as HTMLElement).closest(".col-menu");
    const rect = menuEl?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
    const firstRow = rows[0];
    const preview = firstRow ? evalFormula(col.formula, firstRow, db?.columns ?? []) : "";
    setColMenu(null);
    setFormulaPopover({ colId: col.id, x: rect.left, y: rect.bottom + 4, draft: col.formula, preview });
  };

  const updateFormulaPreview = (draft: string) => {
    if (!formulaPopover || !db) return;
    const col = db.columns.find(c => c.id === formulaPopover.colId);
    if (!col) return;
    const firstRow = rows[0];
    const preview = firstRow ? evalFormula(draft, firstRow, db.columns) : "";
    setFormulaPopover(p => p ? { ...p, draft, preview } : p);
  };

  const saveFormula = async () => {
    if (!formulaPopover || !db) return;
    const col = db.columns.find(c => c.id === formulaPopover.colId);
    if (!col) return;
    await api.databases.updateColumn(databaseId, col.id, { ...col, formula: formulaPopover.draft });
    setFormulaPopover(null);
    void reload();
  };

  // ── select options management ──
  const openSelectOptions = (e: React.MouseEvent, col: DBColumn) => {
    const menuEl = (e.currentTarget as HTMLElement).closest(".col-menu");
    const rect = menuEl?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
    const options = parseOptions(col.options);
    setColMenu(null);
    setNewOptionName("");
    setSelectOptionsPopover({ colId: col.id, x: rect.left, y: rect.bottom + 4, options });
  };

  const saveSelectOptions = async (colId: string, options: SelectOption[]) => {
    if (!db) return;
    const col = db.columns.find(c => c.id === colId);
    if (!col) return;
    await api.databases.updateColumn(databaseId, colId, { ...col, options: serializeOptions(options) });
    void reload();
  };

  const addSelectOption = async () => {
    if (!selectOptionsPopover || !newOptionName.trim()) return;
    const newOpt: SelectOption = { value: newOptionName.trim(), colorIdx: selectOptionsPopover.options.length % TAG_COLORS.length };
    const updated = [...selectOptionsPopover.options, newOpt];
    setSelectOptionsPopover(p => p ? { ...p, options: updated } : p);
    setNewOptionName("");
    await saveSelectOptions(selectOptionsPopover.colId, updated);
  };

  const removeSelectOption = async (idx: number) => {
    if (!selectOptionsPopover) return;
    const updated = selectOptionsPopover.options.filter((_, i) => i !== idx);
    setSelectOptionsPopover(p => p ? { ...p, options: updated } : p);
    await saveSelectOptions(selectOptionsPopover.colId, updated);
  };

  // ── select dropdown ──
  const openSelectDropdown = (e: React.MouseEvent, row: DBRow, col: DBColumn) => {
    e.stopPropagation();
    const options = parseOptions(col.options);
    if (options.length === 0) {
      // fallback to free input if no options defined
      startEdit(row.id, col.id, row.cells[col.id] ?? "");
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSelectDropdown({ rowId: row.id, colId: col.id, x: rect.left, y: rect.bottom + 2, options });
  };

  const selectOption = async (rowId: string, colId: string, value: string) => {
    setSelectDropdown(null);
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value }]);
    void reload();
  };

  const clearSelectCell = async (rowId: string, colId: string) => {
    setSelectDropdown(null);
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value: "" }]);
    void reload();
  };

  // ── hide column ──
  const toggleHideColumn = async (col: DBColumn) => {
    await api.databases.updateColumn(databaseId, col.id, { ...col, is_hidden: !col.is_hidden });
    void reload(sortState, filterState);
  };

  // ── multi-select ──
  const openMultiSelectDropdown = (e: React.MouseEvent, row: DBRow, col: DBColumn) => {
    e.stopPropagation();
    const options = parseOptions(col.options);
    if (options.length === 0) {
      startEdit(row.id, col.id, row.cells[col.id] ?? "");
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMultiSelectDropdown({ rowId: row.id, colId: col.id, x: rect.left, y: rect.bottom + 2, options });
  };

  const toggleMultiSelectValue = async (rowId: string, colId: string, optValue: string, currentVal: string) => {
    const selected = currentVal ? currentVal.split(",").map(s => s.trim()).filter(Boolean) : [];
    const idx = selected.indexOf(optValue);
    const next = idx >= 0 ? selected.filter(v => v !== optValue) : [...selected, optValue];
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value: next.join(",") }]);
    // update local state immediately for responsiveness
    setRows(rs => rs.map(r => r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: next.join(",") } } : r));
    if (multiSelectDropdown) {
      setMultiSelectDropdown(d => d ? { ...d } : null);
    }
  };

  // ── column resize ──
  const startResize = (e: React.MouseEvent, colId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th") as HTMLElement;
    const startWidth = th.getBoundingClientRect().width;
    resizingRef.current = { colId, startX: e.clientX, startWidth };

    const onMove = (mv: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = mv.clientX - resizingRef.current.startX;
      const newWidth = Math.max(80, Math.min(500, resizingRef.current.startWidth + delta));
      setColWidths(prev => ({ ...prev, [resizingRef.current!.colId]: newWidth }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // ── row detail modal ──
  const openRowModal = (row: DBRow) => {
    setRowModal({ row });
    setRowModalDraft({ ...row.cells });
  };

  const saveRowModal = async () => {
    if (!rowModal) return;
    const cells: DBCell[] = Object.entries(rowModalDraft).map(([colId, value]) => ({ column_id: colId, value }));
    await api.databases.updateCells(databaseId, rowModal.row.id, cells);
    setRowModal(null);
    void reload();
  };

  if (!db) return <div className="db-loading">加载中…</div>;

  const allCols = (db.columns ?? []).slice().sort((a, b) => a.order_index - b.order_index);
  const cols = allCols.filter(c => !c.is_hidden);
  const menuCol = colMenu ? db.columns.find(c => c.id === colMenu.colId) : null;
  const hiddenCount = allCols.filter(c => c.is_hidden).length;

  return (
    <div className="db-wrap" contentEditable={false}>
      {/* title */}
      <div className="db-title-wrap">
        {titleEditing ? (
          <input
            ref={titleInputRef}
            className="db-title-input"
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={e => { if (e.key === "Enter") void commitTitle(); if (e.key === "Escape") setTitleEditing(false); }}
          />
        ) : (
          <span className="db-title" onClick={startTitleEdit}>{db.title}</span>
        )}
      </div>

      {error && <div className="db-error">{error}</div>}

      {/* toolbar */}
      <div className="db-toolbar">
        <button className={`db-toolbar-btn${toolbarPanel === "filter" ? " active" : ""}${filterState ? " has-value" : ""}`}
          onClick={() => setToolbarPanel(p => p === "filter" ? null : "filter")}>
          筛选{filterState ? " ●" : ""}
        </button>
        <button className={`db-toolbar-btn${toolbarPanel === "sort" ? " active" : ""}${sortState ? " has-value" : ""}`}
          onClick={() => setToolbarPanel(p => p === "sort" ? null : "sort")}>
          排序{sortState ? " ●" : ""}
        </button>
        <button className={`db-toolbar-btn${toolbarPanel === "hide" ? " active" : ""}`}
          onClick={() => setToolbarPanel(p => p === "hide" ? null : "hide")}>
          隐藏字段{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
        </button>
      </div>

      {toolbarPanel && (
        <div className="db-panel">
          {toolbarPanel === "sort" && (
            <div className="db-panel-content">
              <div className="db-panel-title">排序</div>
              <select value={sortState?.colId ?? ""}
                onChange={e => setSortState(e.target.value ? { colId: e.target.value, order: sortState?.order ?? "asc" } : null)}>
                <option value="">无排序</option>
                {allCols.filter(c => c.type !== "formula").map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {sortState && (
                <select value={sortState.order}
                  onChange={e => setSortState(s => s ? { ...s, order: e.target.value as "asc" | "desc" } : null)}>
                  <option value="asc">升序 ↑</option>
                  <option value="desc">降序 ↓</option>
                </select>
              )}
              {sortState && <button className="db-panel-clear" onClick={() => setSortState(null)}>清除</button>}
            </div>
          )}
          {toolbarPanel === "filter" && (
            <div className="db-panel-content">
              <div className="db-panel-title">筛选</div>
              <select value={filterState?.colId ?? ""}
                onChange={e => setFilterState(e.target.value ? { colId: e.target.value, op: filterState?.op ?? "contains", val: filterState?.val ?? "" } : null)}>
                <option value="">选择列</option>
                {allCols.filter(c => c.type !== "formula" && c.type !== "checkbox").map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {filterState && (
                <>
                  <select value={filterState.op}
                    onChange={e => setFilterState(s => s ? { ...s, op: e.target.value } : null)}>
                    <option value="contains">包含</option>
                    <option value="not_contains">不包含</option>
                    <option value="equals">等于</option>
                    <option value="not_equals">不等于</option>
                    <option value="is_empty">为空</option>
                    <option value="is_not_empty">不为空</option>
                    <option value="gt">大于</option>
                    <option value="lt">小于</option>
                  </select>
                  {filterState.op !== "is_empty" && filterState.op !== "is_not_empty" && (
                    <input
                      className="db-panel-input"
                      placeholder="值"
                      value={filterState.val}
                      onChange={e => setFilterState(s => s ? { ...s, val: e.target.value } : null)}
                    />
                  )}
                  <button className="db-panel-clear" onClick={() => setFilterState(null)}>清除</button>
                </>
              )}
            </div>
          )}
          {toolbarPanel === "hide" && (
            <div className="db-panel-content">
              <div className="db-panel-title">隐藏字段</div>
              {allCols.map(col => (
                <label key={col.id} className="db-hide-row">
                  <input type="checkbox" checked={!col.is_hidden}
                    onChange={() => void toggleHideColumn(col)} />
                  <span className="col-icon">{COL_ICONS[col.type]}</span>
                  {col.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="db-scroll">
        <table className="db-table">
          <thead>
            <tr>
              <th className="th-row-actions" />
              {cols.map(col => (
                <th key={col.id} style={{ width: colWidths[col.id] ?? undefined, minWidth: colWidths[col.id] ?? 120 }}>
                  <button className="col-header-btn" onClick={e => openColMenu(e, col)}>
                    <span className="col-icon">{COL_ICONS[col.type]}</span>
                    <span className="col-name-text">{col.name}</span>
                  </button>
                  <div className="col-resize-handle" onMouseDown={e => startResize(e, col.id)} />
                </th>
              ))}
              <th className="col-add-th">
                <button className="col-add-th-btn" onClick={openAddCol} title="添加列">+</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && cols.length === 0 && (
              <tr><td colSpan={3} className="db-empty-td">点击右上角 + 添加第一列</td></tr>
            )}
            {rows.map(row => (
              <tr key={row.id}>
                <td className="td-row-actions">
                  <div className="row-actions-wrap">
                    <button className="row-open-btn" onClick={() => openRowModal(row)} title="展开行">↗</button>
                    <button className="row-del-btn" onClick={() => void deleteRow(row.id)} title="删除行">⊖</button>
                  </div>
                </td>
                {cols.map(col => {
                  const val = row.cells[col.id] ?? "";
                  const isEditing = editingCell?.rowId === row.id && editingCell?.colId === col.id;
                  return (
                    <td key={col.id}>
                      {col.type === "formula" ? (
                        <span className="cell-formula-inner">
                          {(() => { const r = evalFormula(col.formula, row, cols); return r || <span className="cell-empty">—</span>; })()}
                        </span>
                      ) : col.type === "checkbox" ? (
                        <div className="cell-checkbox">
                          <input type="checkbox" checked={val === "true"} onChange={() => void toggleCheckbox(row.id, col.id, val)} />
                        </div>
                      ) : col.type === "select" ? (
                        <div className="cell-select-wrap" onClick={e => openSelectDropdown(e, row, col)}>
                          {val ? (
                            <span className="cell-tag" style={{ background: tagColor(val).bg, color: tagColor(val).color }}>{val}</span>
                          ) : (
                            <span className="cell-empty">　</span>
                          )}
                        </div>
                      ) : col.type === "multi-select" ? (
                        <div className="cell-select-wrap" onClick={e => openMultiSelectDropdown(e, row, col)}>
                          {val ? val.split(",").map(s => s.trim()).filter(Boolean).map((v, i) => (
                            <span key={i} className="cell-tag" style={{ background: tagColor(v).bg, color: tagColor(v).color }}>{v}</span>
                          )) : <span className="cell-empty">　</span>}
                        </div>
                      ) : isEditing ? (
                        <input
                          ref={cellInputRef}
                          className="cell-input"
                          type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                          value={cellDraft}
                          onChange={e => setCellDraft(e.target.value)}
                          onBlur={() => void commitEdit(row.id, col.id)}
                          onKeyDown={e => handleCellKeyDown(e, row.id, col.id)}
                        />
                      ) : (
                        <span className={`cell-${col.type}-inner`} onClick={() => startEdit(row.id, col.id, val)}>
                          {val || <span className="cell-empty">　</span>}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
            <tr className="db-add-row-tr">
              <td colSpan={cols.length + 2}>
                <button className="db-add-row-btn" onClick={() => void addRow()}>
                  <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> 新建
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* column header menu */}
      {colMenu && menuCol && (
        <>
          <div className="col-menu-overlay" onClick={closeColMenu} />
          <div className="col-menu" style={{ top: colMenu.y, left: colMenu.x }}>
            <div className="col-menu-rename">
              <input
                ref={renameInputRef}
                value={colMenu.draft}
                onChange={e => setColMenu(m => m ? { ...m, draft: e.target.value } : m)}
                onKeyDown={e => { if (e.key === "Enter") void commitRename(); if (e.key === "Escape") closeColMenu(); }}
                onBlur={() => void commitRename()}
                placeholder="列名"
              />
            </div>
            <div className="col-menu-divider" />
            <div className="col-menu-type-label">列类型</div>
            {COL_TYPES.map(t => (
              <button key={t} className={`col-menu-type-item${menuCol.type === t ? " active" : ""}`}
                onClick={() => void changeColType(t)}>
                <span>{COL_ICONS[t]}</span>{t}
              </button>
            ))}
            {menuCol.type === "formula" && (
              <>
                <div className="col-menu-divider" />
                <button className="col-menu-formula-btn" onClick={e => openFormulaPopover(e, menuCol)}>ƒ 编辑公式</button>
              </>
            )}
            {(menuCol.type === "select" || menuCol.type === "multi-select") && (
              <>
                <div className="col-menu-divider" />
                <button className="col-menu-formula-btn" onClick={e => openSelectOptions(e, menuCol)}>≡ 管理选项</button>
              </>
            )}
            <div className="col-menu-divider" />
            <button className="col-menu-del-btn" onClick={() => void deleteCol()}>🗑 删除列</button>
          </div>
        </>
      )}

      {/* formula editor popover */}
      {formulaPopover && db && (
        <>
          <div className="formula-overlay" onClick={() => setFormulaPopover(null)} />
          <div className="formula-popover" style={{ top: formulaPopover.y, left: formulaPopover.x }}>
            <div className="formula-popover-title">编辑公式</div>
            <textarea
              ref={formulaInputRef}
              className="formula-input"
              value={formulaPopover.draft}
              onChange={e => updateFormulaPreview(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") setFormulaPopover(null); }}
              placeholder={`prop("列名") + prop("列名")`}
              rows={3}
              spellCheck={false}
            />
            <div className="formula-props-label">可引用属性</div>
            <div className="formula-props">
              {db.columns.filter(c => c.type !== "formula").map(c => (
                <button key={c.id} className="formula-prop-chip"
                  onClick={() => {
                    const ins = `prop("${c.name}")`;
                    const next = formulaPopover.draft + ins;
                    updateFormulaPreview(next);
                  }}>
                  {COL_ICONS[c.type]} {c.name}
                </button>
              ))}
            </div>
            {formulaPopover.preview !== "" && (
              <div className="formula-preview">
                <span className="formula-preview-label">预览：</span>
                <span className={formulaPopover.preview === "⚠" ? "formula-preview-err" : "formula-preview-val"}>
                  {formulaPopover.preview}
                </span>
              </div>
            )}
            <div className="formula-actions">
              <button className="formula-save-btn" onClick={() => void saveFormula()}>完成</button>
              <button className="formula-cancel-btn" onClick={() => setFormulaPopover(null)}>取消</button>
            </div>
          </div>
        </>
      )}

      {/* select options manager */}
      {selectOptionsPopover && (
        <>
          <div className="formula-overlay" onClick={() => setSelectOptionsPopover(null)} />
          <div className="select-opts-popover" style={{ top: selectOptionsPopover.y, left: selectOptionsPopover.x }}>
            <div className="formula-popover-title">管理选项</div>
            <div className="select-opts-list">
              {selectOptionsPopover.options.map((opt, idx) => {
                const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
                return (
                  <div key={idx} className="select-opt-row">
                    <span className="cell-tag" style={{ background: c.bg, color: c.color }}>{opt.value}</span>
                    <div className="select-opt-colors">
                      {TAG_COLORS.map((tc, ci) => (
                        <button
                          key={ci}
                          className={`color-dot${opt.colorIdx === ci ? " active" : ""}`}
                          style={{ background: tc.color }}
                          title={SELECT_COLOR_NAMES[ci]}
                          onClick={async () => {
                            const updated = selectOptionsPopover.options.map((o, i) => i === idx ? { ...o, colorIdx: ci } : o);
                            setSelectOptionsPopover(p => p ? { ...p, options: updated } : p);
                            await saveSelectOptions(selectOptionsPopover.colId, updated);
                          }}
                        />
                      ))}
                    </div>
                    <button className="select-opt-del" onClick={() => void removeSelectOption(idx)}>×</button>
                  </div>
                );
              })}
            </div>
            <div className="select-opt-add">
              <input
                placeholder="新选项名称"
                value={newOptionName}
                onChange={e => setNewOptionName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void addSelectOption(); }}
              />
              <button onClick={() => void addSelectOption()}>添加</button>
            </div>
          </div>
        </>
      )}

      {/* select dropdown */}
      {selectDropdown && (
        <>
          <div className="col-menu-overlay" onClick={() => setSelectDropdown(null)} />
          <div className="select-dropdown" style={{ top: selectDropdown.y, left: selectDropdown.x }}>
            {selectDropdown.options.map((opt, idx) => {
              const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
              return (
                <button key={idx} className="select-dd-item"
                  onClick={() => void selectOption(selectDropdown.rowId, selectDropdown.colId, opt.value)}>
                  <span className="cell-tag" style={{ background: c.bg, color: c.color }}>{opt.value}</span>
                </button>
              );
            })}
            <div className="col-menu-divider" />
            <button className="select-dd-item select-dd-clear"
              onClick={() => void clearSelectCell(selectDropdown.rowId, selectDropdown.colId)}>
              清除选择
            </button>
          </div>
        </>
      )}

      {/* add column popover */}
      {addColPopover && (
        <>
          <div className="add-col-overlay" onClick={() => setAddColPopover(null)} />
          <div className="add-col-popover" style={{ top: addColPopover.y, left: addColPopover.x }}>
            <input
              ref={newColInputRef}
              placeholder="列名"
              value={newColName}
              onChange={e => setNewColName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void submitNewCol(); if (e.key === "Escape") setAddColPopover(null); }}
            />
            <select value={newColType} onChange={e => setNewColType(e.target.value as DBColumn["type"])}>
              {COL_TYPES.map(t => <option key={t} value={t}>{COL_ICONS[t]} {t}</option>)}
            </select>
            <div className="add-col-actions">
              <button onClick={() => void submitNewCol()}>确认</button>
              <button onClick={() => setAddColPopover(null)}>取消</button>
            </div>
          </div>
        </>
      )}

      {/* multi-select dropdown */}
      {multiSelectDropdown && (
        <>
          <div className="col-menu-overlay" onClick={() => setMultiSelectDropdown(null)} />
          <div className="select-dropdown" style={{ top: multiSelectDropdown.y, left: multiSelectDropdown.x }}>
            {multiSelectDropdown.options.map((opt, idx) => {
              const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
              const currentVal = rows.find(r => r.id === multiSelectDropdown.rowId)?.cells[multiSelectDropdown.colId] ?? "";
              const selected = currentVal.split(",").map(s => s.trim()).filter(Boolean);
              const isSelected = selected.includes(opt.value);
              return (
                <button key={idx} className={`select-dd-item${isSelected ? " selected" : ""}`}
                  onClick={() => void toggleMultiSelectValue(multiSelectDropdown.rowId, multiSelectDropdown.colId, opt.value, currentVal)}>
                  <span className="cell-tag" style={{ background: isSelected ? c.bg : "#f0f0f0", color: isSelected ? c.color : "#6b7280" }}>
                    {isSelected ? "✓ " : ""}{opt.value}
                  </span>
                </button>
              );
            })}
            <div className="col-menu-divider" />
            <button className="select-dd-item select-dd-clear"
              onClick={async () => {
                await api.databases.updateCells(databaseId, multiSelectDropdown.rowId, [{ column_id: multiSelectDropdown.colId, value: "" }]);
                setMultiSelectDropdown(null);
                void reload(sortState, filterState);
              }}>
              清除选择
            </button>
          </div>
        </>
      )}

      {/* row detail modal */}
      {rowModal && db && (
        <>
          <div className="row-modal-overlay" onClick={saveRowModal} />
          <div className="row-modal" onClick={e => e.stopPropagation()}>
            <div className="row-modal-header">
              <span className="row-modal-title">行详情</span>
              <button className="row-modal-close" onClick={() => void saveRowModal()}>×</button>
            </div>
            <div className="row-modal-body">
              {cols.map(col => (
                <div key={col.id} className="row-modal-field">
                  <div className="row-modal-label">
                    <span className="col-icon">{COL_ICONS[col.type]}</span>
                    {col.name}
                  </div>
                  <div className="row-modal-value">
                    {col.type === "formula" ? (
                      <span className="cell-formula-inner">{evalFormula(col.formula, rowModal.row, cols) || "—"}</span>
                    ) : col.type === "checkbox" ? (
                      <input
                        type="checkbox"
                        checked={rowModalDraft[col.id] === "true"}
                        onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.checked ? "true" : "false" }))}
                        style={{ accentColor: "#2383e2", width: 15, height: 15 }}
                      />
                    ) : col.type === "select" ? (
                      <select
                        value={rowModalDraft[col.id] ?? ""}
                        onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))}
                        className="row-modal-select"
                      >
                        <option value="">—</option>
                        {parseOptions(col.options).map((opt, idx) => (
                          <option key={idx} value={opt.value}>{opt.value}</option>
                        ))}
                      </select>
                    ) : col.type === "multi-select" ? (
                      <div className="row-modal-multiselect">
                        {parseOptions(col.options).map((opt, idx) => {
                          const selected = (rowModalDraft[col.id] ?? "").split(",").map(s => s.trim()).filter(Boolean);
                          const isSelected = selected.includes(opt.value);
                          const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
                          return (
                            <button key={idx}
                              className={`cell-tag${isSelected ? " selected" : ""}`}
                              style={{ background: isSelected ? c.bg : "#f0f0f0", color: isSelected ? c.color : "#6b7280", border: isSelected ? `1.5px solid ${c.color}` : "1.5px solid transparent" }}
                              onClick={() => {
                                const next = isSelected ? selected.filter(v => v !== opt.value) : [...selected, opt.value];
                                setRowModalDraft(d => ({ ...d, [col.id]: next.join(",") }));
                              }}>
                              {opt.value}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <input
                        className="row-modal-input"
                        type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                        value={rowModalDraft[col.id] ?? ""}
                        onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))}
                        placeholder="空"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="row-modal-footer">
              <button className="formula-save-btn" onClick={() => void saveRowModal()}>保存</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
