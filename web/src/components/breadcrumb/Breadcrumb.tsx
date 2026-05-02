import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Page } from "../../types";
import "./Breadcrumb.css";

interface Props {
  pageId: string;
  onSelect: (id: string) => void;
}

export function Breadcrumb({ pageId, onSelect }: Props) {
  const [ancestors, setAncestors] = useState<Page[]>([]);

  useEffect(() => {
    void api.pages.getAncestors(pageId).then(setAncestors).catch(() => {});
  }, [pageId]);

  if (ancestors.length === 0) return null;

  return (
    <nav className="breadcrumb">
      {ancestors.map((page) => (
        <span key={page.id} className="breadcrumb-item">
          <button className="breadcrumb-btn" onClick={() => onSelect(page.id)}>
            {page.icon && <span className="breadcrumb-icon">{page.icon}</span>}
            <span className="breadcrumb-title">{page.title || "Untitled"}</span>
          </button>
          <span className="breadcrumb-sep">›</span>
        </span>
      ))}
    </nav>
  );
}
