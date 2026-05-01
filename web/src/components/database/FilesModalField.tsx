import { useRef, useState } from "react";
import type { FileAttachment } from "../../types";

interface FilesModalFieldProps {
  attachments: FileAttachment[];
  onUpdate: (attachments: FileAttachment[]) => void;
  apiBaseUrl?: string;
}

const MAX_ATTACHMENTS = 10;

export function FilesModalField({ attachments, onUpdate, apiBaseUrl = "" }: FilesModalFieldProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
    <div className="files-modal-field">
      {attachments.map((att, idx) => (
        <div key={idx} className="files-modal-item">
          {isImage(att.mime) ? (
            <a
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              className="files-modal-img-link"
              onClick={e => e.stopPropagation()}
            >
              <img
                src={att.url}
                alt={att.name}
                style={{ maxWidth: 60, maxHeight: 60, display: "block", borderRadius: 4, objectFit: "cover" }}
              />
            </a>
          ) : (
            <a
              href={att.url}
              download={att.name}
              className="files-modal-link"
              onClick={e => handleDownload(att, e)}
              title={att.name}
            >
              📎 {att.name}
            </a>
          )}
          <div className="files-modal-meta">
            <span className="files-modal-name" title={att.name}>
              {isImage(att.mime) ? att.name : null}
            </span>
            <span className="files-modal-size">{formatSize(att.size)}</span>
          </div>
          <button
            className="files-modal-del"
            title="删除附件"
            onClick={e => handleDelete(idx, e)}
          >
            ×
          </button>
        </div>
      ))}

      {attachments.length < MAX_ATTACHMENTS && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: "none" }}
            onChange={e => void handleUpload(e)}
          />
          <button
            className="files-modal-upload-btn"
            disabled={uploading}
            onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
          >
            {uploading ? "上传中…" : "上传文件"}
          </button>
        </>
      )}
    </div>
  );
}
