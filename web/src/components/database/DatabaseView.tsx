import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { DBCell, DBColumn, DBRow, Database } from "../../types";
import "./DatabaseView.css";

interface Props {
  databaseId: string;
}

const COL_TYPES: DBColumn["type"][] = ["text", "number", "checkbox", "select", "date", "formula"];

export function DatabaseView({ databaseId }: Props) {
  const [db, setDb] = useState<Database | null>(null);
  const [rows, setRows] = useState<DBRow[]>([]);
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const [addingCol, setAddingCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<DBColumn["type"]>("text");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [dbData, rowData] = await Promise.all([
      api.databases.get(databaseId),
      api.databases.listRows(databaseId),
    ]);
    setDb(dbData);
    setRows(rowData ?? []);
  }, [databaseId]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (editingCell) inputRef.current?.focus();
  }, [editingCell]);

  const startEdit = (rowId: string, colId: string, current: string) => {
    setEditingCell({ rowId, colId });
    setCellDraft(current);
  };

  const commitEdit = async (rowId: string, colId: string) => {
    setEditingCell(null);
    const cells: DBCell[] = [{ column_id: colId, value: cellDraft }];
    await api.databases.updateCells(databaseId, rowId, cells);
    void reload();
  };

  const toggleCheckbox = async (rowId: string, colId: string, current: string) => {
    const next = current === "true" ? "false" : "true";
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value: next }]);
    void reload();
  };

  const addRow = async () => {
    await api.databases.addRow(databaseId);
    void reload();
  };

  const deleteRow = async (rowId: string) => {
    await api.databases.deleteRow(databaseId, rowId);
    void reload();
  };

  const submitNewCol = async () => {
    if (!newColName.trim()) return;
    setError(null);
    try {
      await api.databases.addColumn(databaseId, {
        name: newColName.trim(),
        type: newColType,
        options: [],
        formula: "",
        order_index: (db?.columns.length ?? 0),
      });
      setNewColName("");
      setNewColType("text");
      setAddingCol(false);
      void reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deleteCol = async (colId: string) => {
    if (!confirm("删除此列将同时删除所有该列数据，确认？")) return;
    await api.databases.deleteColumn(databaseId, colId);
    void reload();
  };

  if (!db) return <div className="db-loading">加载中…</div>;

  const cols = db.columns.slice().sort((a, b) => a.order_index - b.order_index);

  return (
    <div className="db-wrap" contentEditable={false}>
      <div className="db-title">{db.title}</div>
      {error && <div className="db-error">{error}</div>}
      <div className="db-scroll">
        <table className="db-table">
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={col.id}>
                  <span className="col-name">{col.name}</span>
                  <span className="col-type">{col.type}</span>
                  <button className="col-del" onClick={() => deleteCol(col.id)} title="删除列">×</button>
                </th>
              ))}
              <th className="col-add-header">
                {addingCol ? (
                  <div className="col-add-form">
                    <input
                      placeholder="列名"
                      value={newColName}
                      onChange={(e) => setNewColName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void submitNewCol(); if (e.key === "Escape") setAddingCol(false); }}
                      autoFocus
                    />
                    <select value={newColType} onChange={(e) => setNewColType(e.target.value as DBColumn["type"])}>
                      {COL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button onClick={() => void submitNewCol()}>确认</button>
                    <button onClick={() => setAddingCol(false)}>取消</button>
                  </div>
                ) : (
                  <button className="col-add-btn" onClick={() => setAddingCol(true)}>+ 列</button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className="db-empty">暂无数据，点击下方"+ 行"添加</td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                {cols.map((col) => {
                  const val = row.cells[col.id] ?? "";
                  const isEditing = editingCell?.rowId === row.id && editingCell?.colId === col.id;
                  return (
                    <td key={col.id} className={`cell-${col.type}`}>
                      {col.type === "formula" ? (
                        <span className="cell-formula">{val || "—"}</span>
                      ) : col.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          checked={val === "true"}
                          onChange={() => void toggleCheckbox(row.id, col.id, val)}
                        />
                      ) : isEditing ? (
                        <input
                          ref={inputRef}
                          type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                          value={cellDraft}
                          onChange={(e) => setCellDraft(e.target.value)}
                          onBlur={() => void commitEdit(row.id, col.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") void commitEdit(row.id, col.id); if (e.key === "Escape") setEditingCell(null); }}
                        />
                      ) : (
                        <span
                          className="cell-value"
                          onClick={() => startEdit(row.id, col.id, val)}
                        >
                          {val || <span className="cell-placeholder">空</span>}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="row-actions">
                  <button onClick={() => void deleteRow(row.id)} title="删除行">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="db-add-row" onClick={() => void addRow()}>+ 行</button>
    </div>
  );
}
