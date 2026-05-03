// RowModal.tsx — Row detail modal + BlockNote content editor
import { useCallback, useEffect, useRef } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs, locales } from "@blocknote/core";
import { Mail, Phone } from "lucide-react";
import { api } from "../../api/client";
import type { DBColumn, DBRow, RelationColumnOptions } from "../../types";
import { evalFormula } from "./formulaEngine";
import { FilesModalField } from "./FilesModalField";
import { RelationCell } from "./RelationCell";
import { TAG_COLORS, parseOptions } from "./shared";
import { parseFileAttachments } from "../../utils/fileAttachments";
import { ColIcon } from "./ColIcon";
import { fmtTimestamp } from "./databaseConstants";

// ── Row content editor schema (basic block types only, no database nesting) ──
const rowContentSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
  },
});

// ── Row content BlockNote editor (isolated from page editor) ──
export function RowContentEditor({
  databaseId,
  rowId,
  initialContent,
  onSaveRef,
}: {
  databaseId: string;
  rowId: string;
  initialContent: string;
  onSaveRef: React.MutableRefObject<(() => void) | null>;
}) {
  const editor = useCreateBlockNote({
    schema: rowContentSchema,
    dictionary: locales.zh,
  });

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyRef = useRef(false);

  const doSave = useCallback(() => {
    if (!readyRef.current) return;
    const content = JSON.stringify(editor.document);
    void api.databases.updateRowContent(databaseId, rowId, content);
  }, [databaseId, rowId, editor]);

  // Expose flush function for parent to call on close
  useEffect(() => {
    onSaveRef.current = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      doSave();
    };
    return () => { onSaveRef.current = null; };
  }, [onSaveRef, doSave]);

  // Initialize editor with content
  useEffect(() => {
    readyRef.current = false;
    let cancelled = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let initialBlocks: any[];
    if (initialContent && initialContent !== "") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialBlocks = JSON.parse(initialContent) as any[];
      } catch {
        initialBlocks = [{ type: "paragraph" }];
      }
    } else {
      initialBlocks = [{ type: "paragraph" }];
    }

    setTimeout(() => {
      if (cancelled) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.replaceBlocks(editor.document, initialBlocks as any);
      } catch (err) {
        console.error("[RowContentEditor] replaceBlocks failed", err);
      }
      requestAnimationFrame(() => { readyRef.current = true; });
    }, 0);

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);

  const handleChange = () => {
    if (!readyRef.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => doSave(), 500);
  };

  return (
    <div className="row-modal-content-editor">
      <BlockNoteView editor={editor} onChange={handleChange} theme="light" />
    </div>
  );
}

interface RowModalProps {
  rowModal: { row: DBRow };
  cols: DBColumn[];
  rowModalDraft: Record<string, string>;
  setRowModalDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setRowModal: React.Dispatch<React.SetStateAction<{ row: DBRow } | null>>;
  saveRowModal: () => void;
  databaseId: string;
  rowContentSaveRef: React.MutableRefObject<(() => void) | null>;
  parseRelationOpts: (col: DBColumn) => RelationColumnOptions | null;
  relationRowsCache: React.MutableRefObject<Map<string, Map<string, DBRow | null>>>;
  reload: () => void;
  onTargetDeleted?: (targetDbId: string) => void;
}

export function RowModal({
  rowModal,
  cols,
  rowModalDraft,
  setRowModalDraft,
  setRowModal,
  saveRowModal,
  databaseId,
  rowContentSaveRef,
  parseRelationOpts,
  relationRowsCache,
  reload,
  onTargetDeleted,
}: RowModalProps) {
  return (
    <>
      <div className="row-modal-overlay" onClick={saveRowModal} />
      <div className="row-modal" onClick={e => e.stopPropagation()}>
        <div className="row-modal-header">
          <span className="row-modal-title">行详情</span>
          <button className="row-modal-close" onClick={() => void saveRowModal()}>×</button>
        </div>
        <div className="row-modal-body">
          <RowContentEditor
            databaseId={databaseId}
            rowId={rowModal.row.id}
            initialContent={rowModal.row.content ?? ""}
            onSaveRef={rowContentSaveRef}
          />
          <div className="row-modal-content-divider" />
          {cols.map(col => (
            <div key={col.id} className="row-modal-field">
              <div className="row-modal-label">
                <span className="col-icon col-icon-wrap"><ColIcon type={col.type} /></span>
                {col.name}
              </div>
              <div className="row-modal-value">
                {col.type === "rollup" ? (
                  <span className="cell-formula-inner">{rowModal.row.cells[col.id] || "—"}</span>
                ) : col.type === "formula" ? (
                  <span className="cell-formula-inner">{evalFormula(col.formula, rowModal.row, cols) || "—"}</span>
                ) : col.type === "created_time" ? (
                  <span className="cell-time-readonly">{fmtTimestamp(rowModal.row.created_at)}</span>
                ) : col.type === "last_edited_time" ? (
                  <span className="cell-time-readonly">{fmtTimestamp(rowModal.row.updated_at)}</span>
                ) : col.type === "url" ? (
                  <div className="row-modal-url-wrap">
                    <input className="row-modal-input" type="url" value={rowModalDraft[col.id] ?? ""}
                      onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))} placeholder="https://" />
                    {rowModalDraft[col.id] && (
                      <a href={rowModalDraft[col.id]} target="_blank" rel="noopener noreferrer" className="cell-url-link row-modal-url-open">↗</a>
                    )}
                  </div>
                ) : col.type === "email" ? (
                  <div className="row-modal-url-wrap">
                    <input className="row-modal-input" type="email" value={rowModalDraft[col.id] ?? ""}
                      onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))} placeholder="name@example.com" />
                    {rowModalDraft[col.id] && (
                      <a href={`mailto:${rowModalDraft[col.id]}`} className="cell-url-link row-modal-url-open"><Mail size={12} /></a>
                    )}
                  </div>
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
                ) : col.type === "status" ? (
                  <div className="row-modal-multiselect">
                    {parseOptions(col.options).map((opt, idx) => {
                      const currentVal = rowModalDraft[col.id] ?? "";
                      const isSelected = currentVal === opt.value;
                      const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
                      return (
                        <button key={idx}
                          className={`cell-tag${isSelected ? " selected" : ""}`}
                          style={{ background: isSelected ? c.bg : "#f0f0f0", color: isSelected ? c.color : "#6b7280", border: isSelected ? `1.5px solid ${c.color}` : "1.5px solid transparent" }}
                          onClick={() => setRowModalDraft(d => ({ ...d, [col.id]: isSelected ? "" : opt.value }))}>
                          {opt.value}
                        </button>
                      );
                    })}
                  </div>
                ) : col.type === "phone" ? (
                  <div className="row-modal-url-wrap">
                    <input className="row-modal-input" type="tel" value={rowModalDraft[col.id] ?? ""}
                      onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))} placeholder="+86 138 0000 0000" />
                    {rowModalDraft[col.id] && (
                      <a href={`tel:${rowModalDraft[col.id]}`} className="cell-url-link row-modal-url-open" onClick={e => e.stopPropagation()}><Phone size={12} /></a>
                    )}
                  </div>
                ) : col.type === "people" ? (
                  <input
                    className="row-modal-input"
                    type="text"
                    value={rowModalDraft[col.id] ?? ""}
                    onChange={e => setRowModalDraft(d => ({ ...d, [col.id]: e.target.value }))}
                    placeholder="张三,李四（逗号分隔）"
                  />
                ) : col.type === "files" ? (
                  <FilesModalField
                    attachments={parseFileAttachments(rowModal.row.cells[col.id])}
                    onUpdate={(newAtts) => {
                      void api.databases.updateCells(databaseId, rowModal.row.id, [{ column_id: col.id, value: JSON.stringify(newAtts) }])
                        .then(() => {
                          // 同步更新 rowModal.row 的 cells，不走 rowModalDraft
                          setRowModal(m => m ? { row: { ...m.row, cells: { ...m.row.cells, [col.id]: JSON.stringify(newAtts) } } } : null);
                          void reload();
                        });
                    }}
                  />
                ) : col.type === "relation" ? (
                  <RelationCell
                    column={col}
                    value={rowModal.row.cells[col.id] ?? ""}
                    onChange={(newVal) => {
                      // 即存即存，不走 rowModalDraft
                      void api.databases.updateCells(databaseId, rowModal.row.id, [{ column_id: col.id, value: newVal }])
                        .then(() => {
                          setRowModal(m => m ? { row: { ...m.row, cells: { ...m.row.cells, [col.id]: newVal } } } : null);
                          void reload();
                        });
                    }}
                    targetRowsCache={(() => {
                      const opts = parseRelationOpts(col);
                      return opts?.target_database_id ? relationRowsCache.current.get(opts.target_database_id) : undefined;
                    })()}
                    onTargetDeleted={onTargetDeleted ? () => {
                      const targetDbId = parseRelationOpts(col)?.target_database_id;
                      if (targetDbId) onTargetDeleted(targetDbId);
                    } : undefined}
                  />
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
  );
}
