import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { Page, SearchResultItem } from "../../types";
import "./SearchModal.css";

const RECENT_KEY = "noteyard_recent_pages";
const RECENT_MAX = 8;

const HISTORY_KEY = "noteyard_search_history";
const HISTORY_MAX = 10;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(term: string): void {
  const trimmed = term.trim();
  if (!trimmed) return;
  const history = loadHistory().filter((h) => h !== trimmed);
  history.unshift(trimmed);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_MAX)));
}

function deleteHistoryItem(term: string): void {
  const history = loadHistory().filter((h) => h !== term);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function clearHistory(): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify([]));
}

function getRecentPageIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRecentPageId(pageId: string): void {
  const ids = getRecentPageIds().filter((id) => id !== pageId);
  ids.unshift(pageId);
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_MAX)));
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

interface Props {
  onSelect: (pageId: string) => void;
  onClose: () => void;
  allPages?: Page[];
}

export function SearchModal({ onSelect, onClose, allPages }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentPageIds] = useState<string[]>(getRecentPageIds);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.globalSearch(query.trim());
        setResults(res?.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
      setActiveIndex(0);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Compute recent pages from allPages or skip if no allPages provided
  const recentItems: Page[] = recentPageIds
    .map((id) => allPages?.find((p) => p.id === id))
    .filter((p): p is Page => p !== undefined);

  const trimmedQuery = query.trim();

  // Active list is either search results or recent items
  const activeList = trimmedQuery ? results : recentItems;

  const handleSelectResult = (pageId: string) => {
    if (trimmedQuery) {
      saveHistory(trimmedQuery);
      setHistory(loadHistory());
    }
    onSelect(pageId);
  };

  const handleHistoryClick = (term: string) => {
    setQuery(term);
  };

  const handleDeleteHistory = (e: React.MouseEvent, term: string) => {
    e.stopPropagation();
    deleteHistoryItem(term);
    setHistory(loadHistory());
  };

  const handleClearHistory = () => {
    clearHistory();
    setHistory([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, activeList.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (trimmedQuery && results[activeIndex]) {
        handleSelectResult(results[activeIndex].page_id);
      } else if (!trimmedQuery && recentItems[activeIndex]) {
        onSelect(recentItems[activeIndex].id);
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            ref={inputRef}
            className="search-input"
            placeholder="搜索页面和内容..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery("")}>
              ✕
            </button>
          )}
        </div>

        {/* Search results */}
        {trimmedQuery && results.length > 0 && (
          <div className="search-results">
            {results.map((item, i) => (
              <button
                key={item.page_id}
                className={`search-result-item${i === activeIndex ? " active" : ""}`}
                onClick={() => handleSelectResult(item.page_id)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="search-result-icon">{item.page_icon ?? "📄"}</span>
                <span className="search-result-body">
                  <span className="search-result-title">
                    {highlight(item.page_title || "Untitled", query.trim())}
                  </span>
                  {item.page_path.length > 0 && (
                    <span className="search-result-path">
                      {item.page_path.join(" / ")}
                    </span>
                  )}
                  {item.snippet && (
                    <span className="search-result-snippet">{item.snippet}</span>
                  )}
                </span>
                {item.match_type === "content" && (
                  <span className="search-result-badge">内容</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* No results */}
        {trimmedQuery && !loading && results.length === 0 && (
          <div className="search-empty">
            未找到与「{trimmedQuery}」匹配的内容
          </div>
        )}

        {/* Search history (empty query) */}
        {!trimmedQuery && history.length > 0 && (
          <>
            <div className="search-section-label search-section-label--with-action">
              <span>搜索历史</span>
              <button className="search-history-clear-all" onClick={handleClearHistory}>
                清除全部
              </button>
            </div>
            <div className="search-results">
              {history.map((term) => (
                <div key={term} className="search-history-item">
                  <button
                    className="search-history-term"
                    onClick={() => handleHistoryClick(term)}
                  >
                    <span className="search-history-icon">🕐</span>
                    <span className="search-result-title">{term}</span>
                  </button>
                  <button
                    className="search-history-delete"
                    onClick={(e) => handleDeleteHistory(e, term)}
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Recent pages (empty query) */}
        {!trimmedQuery && recentItems.length > 0 && (
          <>
            <div className="search-section-label">最近访问</div>
            <div className="search-results">
              {recentItems.map((page, i) => (
                <button
                  key={page.id}
                  className={`search-result-item${i === activeIndex ? " active" : ""}`}
                  onClick={() => onSelect(page.id)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <span className="search-result-icon">{page.icon ?? "📄"}</span>
                  <span className="search-result-body">
                    <span className="search-result-title">
                      {page.title || "Untitled"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Empty state (no query, no recent, no history) */}
        {!trimmedQuery && recentItems.length === 0 && history.length === 0 && (
          <div className="search-empty">输入关键词搜索页面和内容</div>
        )}
      </div>
    </div>
  );
}
