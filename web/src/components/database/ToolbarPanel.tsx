// ToolbarPanel.tsx — Sort, Filter, Hide, and Group toolbar panels
import { Plus, X } from "lucide-react";
import type { DBColumn, FilterState, SortState } from "../../types";
import { ColIcon } from "./ColIcon";
import { READONLY_COL_TYPES } from "./databaseConstants";

export type ToolbarPanel = "sort" | "filter" | "hide" | "group" | null;

interface ToolbarPanelProps {
  toolbarPanel: ToolbarPanel;
  allCols: DBColumn[];
  sortStates: SortState[];
  setSortStates: React.Dispatch<React.SetStateAction<SortState[]>>;
  filterStates: FilterState[];
  setFilterStates: React.Dispatch<React.SetStateAction<FilterState[]>>;
  groupByColId: string;
  setGroupByColId: React.Dispatch<React.SetStateAction<string>>;
  toggleHideColumn: (col: DBColumn) => void;
}

export function ToolbarPanelView({
  toolbarPanel,
  allCols,
  sortStates,
  setSortStates,
  filterStates,
  setFilterStates,
  groupByColId,
  setGroupByColId,
  toggleHideColumn,
}: ToolbarPanelProps) {
  return (
    <div className="db-panel">
      {toolbarPanel === "sort" && (
        <div className="db-panel-list-content">
          <div className="db-panel-title">排序</div>
          {sortStates.map((s) => (
            <div key={s.id} className="db-panel-list-row">
              <select
                className="db-panel-list-select"
                value={s.colId}
                onChange={e => setSortStates(prev => prev.map(x => x.id === s.id ? { ...x, colId: e.target.value } : x))}>
                <option value="">选择列</option>
                {allCols.filter(c => c.type !== "formula").map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                className="db-panel-order-btn"
                onClick={() => setSortStates(prev => prev.map(x => x.id === s.id ? { ...x, order: x.order === "asc" ? "desc" : "asc" } : x))}>
                {s.order === "asc" ? "升序 ↑" : "降序 ↓"}
              </button>
              <button
                className="db-panel-row-del"
                onClick={() => setSortStates(prev => prev.filter(x => x.id !== s.id))}
                title="删除">
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            className="db-panel-add-btn"
            onClick={() => setSortStates(prev => [...prev, { id: crypto.randomUUID(), colId: "", order: "asc" }])}>
            <Plus size={13} /> 添加排序
          </button>
        </div>
      )}
      {toolbarPanel === "filter" && (
        <div className="db-panel-list-content">
          <div className="db-panel-title">筛选</div>
          {filterStates.map((f) => (
            <div key={f.id} className="db-panel-list-row">
              <select
                className="db-panel-list-select"
                value={f.colId}
                onChange={e => setFilterStates(prev => prev.map(x => x.id === f.id ? { ...x, colId: e.target.value } : x))}>
                <option value="">选择列</option>
                {allCols.filter(c => c.type !== "formula" && c.type !== "checkbox").map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select
                className="db-panel-list-select"
                value={f.op}
                onChange={e => setFilterStates(prev => prev.map(x => x.id === f.id ? { ...x, op: e.target.value } : x))}>
                <option value="contains">包含</option>
                <option value="not_contains">不包含</option>
                <option value="equals">等于</option>
                <option value="not_equals">不等于</option>
                <option value="is_empty">为空</option>
                <option value="is_not_empty">不为空</option>
                <option value="gt">大于</option>
                <option value="lt">小于</option>
              </select>
              {f.op !== "is_empty" && f.op !== "is_not_empty" && (
                <input
                  className="db-panel-list-input"
                  placeholder="值"
                  value={f.val}
                  onChange={e => setFilterStates(prev => prev.map(x => x.id === f.id ? { ...x, val: e.target.value } : x))}
                />
              )}
              <button
                className="db-panel-row-del"
                onClick={() => setFilterStates(prev => prev.filter(x => x.id !== f.id))}
                title="删除">
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            className="db-panel-add-btn"
            onClick={() => setFilterStates(prev => [...prev, { id: crypto.randomUUID(), colId: "", op: "contains", val: "" }])}>
            <Plus size={13} /> 添加筛选条件
          </button>
        </div>
      )}
      {toolbarPanel === "hide" && (
        <div className="db-panel-content">
          <div className="db-panel-title">隐藏字段</div>
          {allCols.map(col => (
            <label key={col.id} className="db-hide-row">
              <input type="checkbox" checked={!col.is_hidden}
                onChange={() => void toggleHideColumn(col)} />
              <span className="col-icon col-icon-wrap"><ColIcon type={col.type} /></span>
              {col.name}
            </label>
          ))}
        </div>
      )}
      {toolbarPanel === "group" && (
        <div className="db-panel-list-content">
          <div className="db-panel-title">分组</div>
          <button
            className={`db-group-radio-row${groupByColId === "" ? " selected" : ""}`}
            onClick={() => setGroupByColId("")}>
            <span className="db-group-radio-dot" />
            <span className="db-group-radio-label">无分组</span>
          </button>
          {allCols.filter(c => c.type === "select" || c.type === "checkbox" || c.type === "status").map(c => (
            <button
              key={c.id}
              className={`db-group-radio-row${groupByColId === c.id ? " selected" : ""}`}
              onClick={() => setGroupByColId(c.id)}>
              <span className="col-icon col-icon-wrap db-group-radio-icon"><ColIcon type={c.type} size={13} /></span>
              <span className="db-group-radio-label">{c.name}</span>
              <span className="db-group-radio-dot" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Re-export ToolbarPanel type alias (same as above)
// Already exported above, but ensure READONLY_COL_TYPES is available for consumers
export { READONLY_COL_TYPES };
