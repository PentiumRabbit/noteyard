import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { Page } from "../../types";
import "./SearchModal.css";

interface Props {
  onSelect: (pageId: string) => void;
  onClose: () => void;
}

export function SearchModal({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Page[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      const pages = await api.pages.search(query.trim());
      setResults(pages ?? []);
      setActiveIndex(0);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[activeIndex]) { onSelect(results[activeIndex].id); }
    else if (e.key === "Escape") { onClose(); }
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={e => e.stopPropagation()}>
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            ref={inputRef}
            className="search-input"
            placeholder="搜索页面…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
          {query && <button className="search-clear" onClick={() => setQuery("")}>✕</button>}
        </div>
        {results.length > 0 && (
          <div className="search-results">
            {results.map((page, i) => (
              <button
                key={page.id}
                className={`search-result-item${i === activeIndex ? " active" : ""}`}
                onClick={() => onSelect(page.id)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="search-result-icon">{page.icon ?? "📄"}</span>
                <span className="search-result-title">{page.title || "Untitled"}</span>
              </button>
            ))}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <div className="search-empty">无匹配结果</div>
        )}
      </div>
    </div>
  );
}
