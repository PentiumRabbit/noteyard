import React from "react";

interface UrlInputFieldProps {
  placeholder: string;
  onConfirm: (url: string) => void;
  loading?: boolean;
  icon?: string;
}

export function UrlInputField({ placeholder, onConfirm, loading, icon }: UrlInputFieldProps) {
  const [urlDraft, setUrlDraft] = React.useState("");

  return (
    <div className="url-input-wrap">
      {icon && <span className="url-input-icon">{icon}</span>}
      <input
        className="url-input"
        placeholder={placeholder}
        value={urlDraft}
        onChange={e => setUrlDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") onConfirm(urlDraft); }}
        onBlur={() => { if (urlDraft) onConfirm(urlDraft); }}
      />
      {loading && <span className="url-input-loading">加载中…</span>}
    </div>
  );
}
