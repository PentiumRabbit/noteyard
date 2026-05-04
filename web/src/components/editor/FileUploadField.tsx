import React from "react";
import { api } from "../../api/client";

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
    try {
      const data = await api.uploads.upload(file);
      onUpload(file, data.url);
    } catch { alert("上传失败"); }
  };

  return (
    <label className="file-attach-upload">
      <span>{uploading ? "上传中…" : label}</span>
      <input type="file" accept={accept} style={{ display: "none" }} onChange={e => void handleChange(e)} />
    </label>
  );
}
