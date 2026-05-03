// CellRenderer.tsx — Table cell rendering for each column type
import { Link, Mail } from "lucide-react";
import type { DBColumn, DBRow, RelationColumnOptions } from "../../types";
import { evalFormula } from "./formulaEngine";
import { FilesCell } from "./FilesCell";
import { RelationCell } from "./RelationCell";
import { Chip } from "./Chip";
import { tagColor, TAG_COLORS, parseOptions } from "./shared";
import { parseFileAttachments } from "../../utils/fileAttachments";
import { api } from "../../api/client";
import { fmtTimestamp } from "./databaseConstants";

interface CellRendererProps {
  col: DBColumn;
  row: DBRow;
  cols: DBColumn[];
  isEditing: boolean;
  cellDraft: string;
  setCellDraft: React.Dispatch<React.SetStateAction<string>>;
  cellInputRef: React.RefObject<HTMLInputElement | null>;
  startEdit: (rowId: string, colId: string, val: string) => void;
  commitEdit: (rowId: string, colId: string) => void;
  handleCellKeyDown: (e: React.KeyboardEvent, rowId: string, colId: string) => void;
  toggleCheckbox: (rowId: string, colId: string, val: string) => void;
  openSelectDropdown: (e: React.MouseEvent, row: DBRow, col: DBColumn) => void;
  openMultiSelectDropdown: (e: React.MouseEvent, row: DBRow, col: DBColumn) => void;
  parseRelationOpts: (col: DBColumn) => RelationColumnOptions | null;
  relationRowsCache: React.MutableRefObject<Map<string, Map<string, DBRow | null>>>;
  databaseId: string;
  reload: () => void;
}

export function CellRenderer({
  col,
  row,
  cols,
  isEditing,
  cellDraft,
  setCellDraft,
  cellInputRef,
  startEdit,
  commitEdit,
  handleCellKeyDown,
  toggleCheckbox,
  openSelectDropdown,
  openMultiSelectDropdown,
  parseRelationOpts,
  relationRowsCache,
  databaseId,
  reload,
}: CellRendererProps) {
  const val = row.cells[col.id] ?? "";

  if (col.type === "rollup") {
    return (
      <span className="cell-formula-inner">
        {val || <span className="cell-empty">—</span>}
      </span>
    );
  }

  if (col.type === "formula") {
    return (
      <span className="cell-formula-inner">
        {(() => { const r = evalFormula(col.formula, row, cols); return r || <span className="cell-empty">—</span>; })()}
      </span>
    );
  }

  if (col.type === "created_time") {
    return <span className="cell-time-readonly">{fmtTimestamp(row.created_at)}</span>;
  }

  if (col.type === "last_edited_time") {
    return <span className="cell-time-readonly">{fmtTimestamp(row.updated_at)}</span>;
  }

  if (col.type === "checkbox") {
    return (
      <div className="cell-checkbox">
        <input type="checkbox" checked={val === "true"} onChange={() => void toggleCheckbox(row.id, col.id, val)} />
      </div>
    );
  }

  if (col.type === "select") {
    return (
      <div className="cell-select-wrap" onClick={e => openSelectDropdown(e, row, col)}>
        {val ? (
          <Chip label={val} colors={[{ bg: tagColor(val).bg, text: tagColor(val).color }]} colorIdx={0} />
        ) : (
          <span className="cell-empty">　</span>
        )}
      </div>
    );
  }

  if (col.type === "multi-select") {
    return (
      <div className="cell-select-wrap" onClick={e => openMultiSelectDropdown(e, row, col)}>
        {val ? val.split(",").map(s => s.trim()).filter(Boolean).map((v, i) => (
          <Chip key={i} label={v} colors={[{ bg: tagColor(v).bg, text: tagColor(v).color }]} colorIdx={0} />
        )) : <span className="cell-empty">　</span>}
      </div>
    );
  }

  if (col.type === "status") {
    return (
      <div className="cell-select-wrap" onClick={e => openSelectDropdown(e, row, col)}>
        {val ? (() => {
          const opts = parseOptions(col.options);
          const opt = opts.find(o => o.value === val);
          const c = opt ? TAG_COLORS[opt.colorIdx % TAG_COLORS.length] : tagColor(val);
          return <Chip label={val} colors={[{ bg: c.bg, text: c.color }]} colorIdx={0} />;
        })() : <span className="cell-empty">　</span>}
      </div>
    );
  }

  if (col.type === "phone") {
    return isEditing ? (
      <input ref={cellInputRef} className="cell-input" type="tel" value={cellDraft}
        onChange={e => setCellDraft(e.target.value)}
        onBlur={() => void commitEdit(row.id, col.id)}
        onKeyDown={e => handleCellKeyDown(e, row.id, col.id)} />
    ) : (
      <div className="cell-select-wrap" onClick={() => startEdit(row.id, col.id, val)}>
        {val ? <Chip label={val} href={`tel:${val}`} /> : <span className="cell-empty">　</span>}
      </div>
    );
  }

  if (col.type === "people") {
    return isEditing ? (
      <input ref={cellInputRef} className="cell-input" type="text" value={cellDraft}
        onChange={e => setCellDraft(e.target.value)}
        onBlur={() => void commitEdit(row.id, col.id)}
        onKeyDown={e => handleCellKeyDown(e, row.id, col.id)} />
    ) : (
      <div className="cell-select-wrap" onClick={() => startEdit(row.id, col.id, val)}>
        {val ? val.split(",").map(s => s.trim()).filter(Boolean).map((name, i) => (
          <Chip key={i} label={name} />
        )) : <span className="cell-empty">　</span>}
      </div>
    );
  }

  if (col.type === "url") {
    return isEditing ? (
      <input ref={cellInputRef} className="cell-input" type="url" value={cellDraft}
        onChange={e => setCellDraft(e.target.value)}
        onBlur={() => void commitEdit(row.id, col.id)}
        onKeyDown={e => handleCellKeyDown(e, row.id, col.id)} />
    ) : (
      <span className="cell-url-wrap" onClick={() => startEdit(row.id, col.id, val)}>
        {val ? <a href={val} target="_blank" rel="noopener noreferrer" className="cell-url-link" onClick={e => e.stopPropagation()}><Link size={12} /> {val}</a> : <span className="cell-empty">　</span>}
      </span>
    );
  }

  if (col.type === "email") {
    return isEditing ? (
      <input ref={cellInputRef} className="cell-input" type="email" value={cellDraft}
        onChange={e => setCellDraft(e.target.value)}
        onBlur={() => void commitEdit(row.id, col.id)}
        onKeyDown={e => handleCellKeyDown(e, row.id, col.id)} />
    ) : (
      <span className="cell-url-wrap" onClick={() => startEdit(row.id, col.id, val)}>
        {val ? <a href={`mailto:${val}`} className="cell-url-link" onClick={e => e.stopPropagation()}><Mail size={12} /> {val}</a> : <span className="cell-empty">　</span>}
      </span>
    );
  }

  if (col.type === "files") {
    return (
      <FilesCell
        attachments={parseFileAttachments(row.cells[col.id])}
        onUpdate={(newAttachments) => {
          void api.databases.updateCells(databaseId, row.id, [{ column_id: col.id, value: JSON.stringify(newAttachments) }]).then(() => void reload());
        }}
      />
    );
  }

  if (col.type === "relation") {
    return (
      <RelationCell
        column={col}
        value={val}
        onChange={(newVal) => {
          void api.databases.updateCells(databaseId, row.id, [{ column_id: col.id, value: newVal }])
            .then(() => void reload());
        }}
        targetRowsCache={(() => {
          const opts = parseRelationOpts(col);
          return opts?.target_database_id ? relationRowsCache.current.get(opts.target_database_id) : undefined;
        })()}
      />
    );
  }

  // Default: text, number, date, etc.
  return isEditing ? (
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
  );
}
