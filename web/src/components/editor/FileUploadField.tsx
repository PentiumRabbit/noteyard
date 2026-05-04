import React from "react";
import { API_BASE } from "../../api/client";

interface FileUploadFieldProps {
  accept?: string;
  maxSizeMB: number;
  label: string;
  onUpload: (file: File, url: string) => void;
  uploading?: boolean;
}

export function FileUploadField({ accept, maxSizeMB, label, onUpload, uploading }: FileUploadFieldProps) {
  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > maxSizeMB * 1024 * 1024) {
      alert(`文件不超过 ${maxSizeMB}MB`);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/api/uploads`, { method: "POST", body: form });
    if (!res.ok) { alert("上传失败"); return; }
    const data = await res.json() as { url: string };
    onUpload(file, data.url);
  };

  return (
    <label className="file-attach-upload">
      <span>{uploading ? "上传中…" : label}</span>
      <input type="file" accept={accept} style={{ display: "none" }} onChange={e => void handleChange(e)} />
    </label>
  );
}
