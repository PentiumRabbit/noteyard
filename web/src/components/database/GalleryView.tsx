import type { DBColumn, DBRow } from "../../types";
import { parseFileAttachments } from "../../utils/fileAttachments";
import "./GalleryView.css";

interface Props {
  columns: DBColumn[];
  rows: DBRow[];
  onOpenRow: (row: DBRow) => void;
}

const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)(\?.*)?$/i;

function getCoverImage(columns: DBColumn[], row: DBRow): string | null {
  const filesCol = columns.find(c => c.type === "files");
  if (!filesCol) return null;
  const attachments = parseFileAttachments(row.cells?.[filesCol.id] ?? "");
  const first = attachments[0];
  if (!first) return null;
  if (first.mime.startsWith("image/") || IMAGE_EXTS.test(first.url)) {
    return first.url;
  }
  return null;
}

export function GalleryView({ columns, rows, onOpenRow }: Props) {
  const titleCol = columns[0];
  const visibleCols = columns.filter(c => !c.is_hidden).slice(1, 4);

  return (
    <div className="gallery-grid">
      {rows.length === 0 && (
        <div className="gallery-empty">暂无数据</div>
      )}
      {rows.map(row => {
        const coverUrl = getCoverImage(columns, row);
        return (
          <div key={row.id} className="gallery-card" onClick={() => onOpenRow(row)}>
            {coverUrl && (
              <img
                className="gallery-card-cover"
                src={coverUrl}
                alt=""
                draggable={false}
              />
            )}
            <div className="gallery-card-body">
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
          </div>
        );
      })}
    </div>
  );
}
