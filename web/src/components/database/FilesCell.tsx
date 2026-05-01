import { useRef, useState } from "react";
import type { FileAttachment } from "../../types";

interface FilesCellProps {
  attachments: FileAttachment[];
  onUpdate: (attachments: FileAttachment[]) => void;
  apiBaseUrl?: string;
}

const MAX_ATTACHMENTS = 10;
const PREVIEW_LIMIT = 3;

export function FilesCell({ attachments, onUpdate, apiBaseUrl = "" }: FilesCellProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const visible = expanded ? attachments : attachments.slice(0, PREVIEW_LIMIT);
  const hiddenCount = attachments.length - PREVIEW_LIMIT;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-uploaded
    e.target.value = "";

    if (attachments.length >= MAX_ATTACHMENTS) {
      alert("单个单元格最多 10 个附件");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${apiBaseUrl}/api/uploads`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`上传失败: ${res.status}`);
      const data = (await res.json()) as { url: string; name: string; size: number; mime: string };
      const newAttachment: FileAttachment = {
        url: data.url,
        name: data.name,
        size: data.size,
        mime: data.mime,
      };
      onUpdate([...attachments, newAttachment]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const next = attachments.filter((_, i) => i !== idx);
    onUpdate(next);
  };

  const handleDownload = (attachment: FileAttachment, e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement("a");
    a.href = attachment.url;
    a.download = attachment.name;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const isImage = (mime: string) => mime.startsWith("image/");

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className="files-cell" onClick={e => e.stopPropagation()}>
      {visible.map((att, idx) => (
        <div
          key={idx}
          className="files-cell-item"
          onMouseEnter={() => setHoveredIdx(idx)}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {isImage(att.mime) ? (
            <span className="files-cell-name files-cell-img-name">
              🖼 {att.name}
              <span className="files-cell-size">{formatSize(att.size)}</span>
              {hoveredIdx === idx && (
                <div className="files-cell-img-tooltip">
                  <img
                    src={att.url}
                    alt={att.name}
                    style={{ maxWidth: 200, maxHeight: 200, display: "block", borderRadius: 4 }}
                  />
                </div>
              )}
            </span>
          ) : (
            <a
              href={att.url}
              download={att.name}
              className="files-cell-name files-cell-link"
              onClick={e => handleDownload(att, e)}
              title={att.name}
            >
              📎 {att.name}
              <span className="files-cell-size">{formatSize(att.size)}</span>
            </a>
          )}
          {hoveredIdx === idx && (
            <button
              className="files-cell-del"
              title="删除附件"
              onClick={e => handleDelete(idx, e)}
            >
              ×
            </button>
          )}
        </div>
      ))}

      {!expanded && hiddenCount > 0 && (
        <button
          className="files-cell-more"
          onClick={e => { e.stopPropagation(); setExpanded(true); }}
        >
          +{hiddenCount} 个
        </button>
      )}

      {expanded && attachments.length > PREVIEW_LIMIT && (
        <button
          className="files-cell-more"
          onClick={e => { e.stopPropagation(); setExpanded(false); }}
        >
          收起
        </button>
      )}

      {attachments.length < MAX_ATTACHMENTS && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: "none" }}
            onChange={e => void handleUpload(e)}
          />
          <button
            className="files-cell-upload"
            title="上传附件"
            disabled={uploading}
            onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
          >
            {uploading ? "上传中…" : "⬆"}
          </button>
        </>
      )}
    </div>
  );
}
