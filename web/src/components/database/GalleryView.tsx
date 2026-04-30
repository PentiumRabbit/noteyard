import type { DBColumn, DBRow } from "../../types";
import "./GalleryView.css";

interface Props {
  columns: DBColumn[];
  rows: DBRow[];
  onOpenRow: (row: DBRow) => void;
}

export function GalleryView({ columns, rows, onOpenRow }: Props) {
  const titleCol = columns[0];
  const visibleCols = columns.filter(c => !c.is_hidden).slice(1, 4);

  return (
    <div className="gallery-grid">
      {rows.length === 0 && (
        <div className="gallery-empty">暂无数据</div>
      )}
      {rows.map(row => (
        <div key={row.id} className="gallery-card" onClick={() => onOpenRow(row)}>
          <div className="gallery-card-title">
            {titleCol ? (row.cells?.[titleCol.id] || "Untitled") : "Untitled"}
          </div>
          {visibleCols.length > 0 && (
            <div className="gallery-card-fields">
              {visibleCols.map(col => (
                <div key={col.id} className="gallery-card-field">
                  <span className="gallery-field-name">{col.name}</span>
                  <span className="gallery-field-val">{row.cells?.[col.id] || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
