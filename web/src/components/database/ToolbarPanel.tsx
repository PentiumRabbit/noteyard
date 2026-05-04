// ToolbarPanel.tsx — Sort, Filter, Hide, and Group toolbar panels
import { Plus, X, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DBColumn, FilterState, SortState } from "../../types";
import { ColIcon } from "./ColIcon";
import { READONLY_COL_TYPES } from "./databaseConstants";

// ── PanelSelect: custom styled dropdown replacing native <select> ──
interface PanelSelectOption {
  value: string;
  label: string;
}

interface PanelSelectProps {
  value: string;
  options: PanelSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

function PanelSelect({ value, options, onChange, placeholder = "选择…", className = "" }: PanelSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selected = options.find(o => o.value === value);
  const label = selected ? selected.label : placeholder;

  return (
    <div ref={ref} className={`panel-select-wrap ${className}`} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        className="panel-select-trigger"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="panel-select-label">{label}</span>
        <ChevronDown size={11} className="panel-select-chevron" />
      </button>
      {open && (
        <div className="panel-select-dropdown" role="listbox">
          {placeholder && (
            <button
              key=""
              type="button"
              role="option"
              aria-selected={value === ""}
              className={`panel-select-item${value === "" ? " selected" : ""}`}
              onMouseDown={e => { e.preventDefault(); onChange(""); setOpen(false); }}
            >
              {placeholder}
            </button>
          )}
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={value === o.value}
              className={`panel-select-item${value === o.value ? " selected" : ""}`}
              onMouseDown={e => { e.preventDefault(); onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
              <PanelSelect
                value={s.colId}
                placeholder="选择列"
                options={allCols.filter(c => c.type !== "formula").map(c => ({ value: c.id, label: c.name }))}
                onChange={v => setSortStates(prev => prev.map(x => x.id === s.id ? { ...x, colId: v } : x))}
              />
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
              <PanelSelect
                value={f.colId}
                placeholder="选择列"
                options={allCols.filter(c => c.type !== "formula" && c.type !== "checkbox").map(c => ({ value: c.id, label: c.name }))}
                onChange={v => setFilterStates(prev => prev.map(x => x.id === f.id ? { ...x, colId: v } : x))}
              />
              <PanelSelect
                value={f.op}
                options={[
                  { value: "contains", label: "包含" },
                  { value: "not_contains", label: "不包含" },
                  { value: "equals", label: "等于" },
                  { value: "not_equals", label: "不等于" },
                  { value: "is_empty", label: "为空" },
                  { value: "is_not_empty", label: "不为空" },
                  { value: "gt", label: "大于" },
                  { value: "lt", label: "小于" },
                ]}
                onChange={v => setFilterStates(prev => prev.map(x => x.id === f.id ? { ...x, op: v } : x))}
              />
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
