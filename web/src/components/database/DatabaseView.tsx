import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { DBCell, DBColumn, DBRow, Database } from "../../types";
import "./DatabaseView.css";

interface Props { databaseId: string }

const COL_TYPES: DBColumn["type"][] = ["text", "number", "checkbox", "select", "date", "formula"];

const COL_ICONS: Record<DBColumn["type"], string> = {
  text: "Aa",
  number: "#",
  checkbox: "☑",
  select: "≡",
  date: "📅",
  formula: "ƒ",
};

// select tag 颜色池，按 value hash 取色
const TAG_COLORS = [
  { bg: "#f3f0ff", color: "#6e5fd6" },
  { bg: "#e8f4fd", color: "#2383e2" },
  { bg: "#edfaf3", color: "#0f9b5c" },
  { bg: "#fff3e0", color: "#d9730d" },
  { bg: "#fce8e8", color: "#eb5757" },
  { bg: "#f0f0f0", color: "#6b7280" },
];
function tagColor(val: string) {
  let h = 0;
  for (let i = 0; i < val.length; i++) h = (h * 31 + val.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}

function evalFormula(formula: string, row: DBRow, cols: DBColumn[]): string {
  if (!formula.trim()) return "";
  try {
    let expr = formula;
    for (const col of cols) {
      if (col.type === "formula") continue;
      const val = row.cells[col.id] ?? "";
      const num = Number(val);
      const replacement = col.type === "number" && !isNaN(num) && val !== "" ? String(num) : `"${val.replace(/"/g, '\\"')}"`;
      expr = expr.split(`prop("${col.name}")`).join(replacement);
    }
    // eslint-disable-next-line no-new-func
    const result = new Function("return (" + expr + ")")();
    return result === undefined || result === null ? "" : String(result);
  } catch {
    return "⚠";
  }
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

export function DatabaseView({ databaseId }: Props) {
  const [db, setDb] = useState<Database | null>(null);
  const [rows, setRows] = useState<DBRow[]>([]);
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const [colMenu, setColMenu] = useState<ColMenu | null>(null);
  const [addColPopover, setAddColPopover] = useState<AddColPopover | null>(null);
  const [formulaPopover, setFormulaPopover] = useState<FormulaPopover | null>(null);
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<DBColumn["type"]>("text");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newColInputRef = useRef<HTMLInputElement>(null);
  const formulaInputRef = useRef<HTMLTextAreaElement>(null);

  const reload = useCallback(async () => {
    const [dbData, rowData] = await Promise.all([
      api.databases.get(databaseId),
      api.databases.listRows(databaseId),
    ]);
    setDb(dbData);
    setRows(rowData ?? []);
  }, [databaseId]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => { if (editingCell) cellInputRef.current?.focus(); }, [editingCell]);
  useEffect(() => { if (titleEditing) titleInputRef.current?.select(); }, [titleEditing]);
  useEffect(() => { if (colMenu?.renaming) renameInputRef.current?.select(); }, [colMenu?.renaming]);
  useEffect(() => { if (addColPopover) newColInputRef.current?.focus(); }, [addColPopover]);
  useEffect(() => { if (formulaPopover) formulaInputRef.current?.focus(); }, [formulaPopover]);

  // ── title ──
  const startTitleEdit = () => {
    setTitleDraft(db?.title ?? "");
    setTitleEditing(true);
  };
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

  // ── rows ──
  const addRow = async () => {
    await api.databases.addRow(databaseId);
    void reload();
  };
  const deleteRow = async (rowId: string) => {
    await api.databases.deleteRow(databaseId, rowId);
    void reload();
  };

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
    try {
      await api.databases.updateColumn(databaseId, col.id, { ...col, type });
    } catch (e) { setError((e as Error).message); }
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
        options: [], formula: "", order_index: db?.columns.length ?? 0,
      });
      setAddColPopover(null);
      void reload();
    } catch (e) { setError((e as Error).message); }
  };

  // ── formula popover ──
  const openFormulaPopover = (e: React.MouseEvent, col: DBColumn) => {
    closeColMenu();
    const rect = (e.currentTarget as HTMLElement).closest(".col-menu")?.getBoundingClientRect()
      ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
    const firstRow = rows[0];
    const preview = firstRow ? evalFormula(col.formula, firstRow, db?.columns ?? []) : "";
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

  if (!db) return <div className="db-loading">加载中…</div>;

  const cols = db.columns.slice().sort((a, b) => a.order_index - b.order_index);
  const menuCol = colMenu ? db.columns.find(c => c.id === colMenu.colId) : null;

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

      <div className="db-scroll">
        <table className="db-table">
          <thead>
            <tr>
              {/* row-del placeholder */}
              <th style={{ width: 28, minWidth: 28 }} />
              {cols.map(col => (
                <th key={col.id}>
                  <button className="col-header-btn" onClick={e => openColMenu(e, col)}>
                    <span className="col-icon">{COL_ICONS[col.type]}</span>
                    <span className="col-name-text">{col.name}</span>
                  </button>
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
                <td className="row-del-td">
                  <button className="row-del-btn" onClick={() => void deleteRow(row.id)} title="删除行">⊖</button>
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
                      ) : col.type === "select" && val ? (
                        <span className="cell-tag" style={{ background: tagColor(val).bg, color: tagColor(val).color }}
                          onClick={() => startEdit(row.id, col.id, val)}>{val}</span>
                      ) : isEditing ? (
                        <input
                          ref={cellInputRef}
                          className="cell-input"
                          type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                          value={cellDraft}
                          onChange={e => setCellDraft(e.target.value)}
                          onBlur={() => void commitEdit(row.id, col.id)}
                          onKeyDown={e => { if (e.key === "Enter") void commitEdit(row.id, col.id); if (e.key === "Escape") setEditingCell(null); }}
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
            {/* add row */}
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
            {/* rename */}
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
            {/* type picker */}
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
    </div>
  );
}
