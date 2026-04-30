import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Editor, type EditorHandle } from "./components/editor/Editor";
import { Breadcrumb } from "./components/breadcrumb/Breadcrumb";
import { SearchModal } from "./components/search/SearchModal";
import { api } from "./api/client";
import { SettingsContext, loadSavedSettings, saveFont, saveTheme } from "./settings/settingsStore";
import { loadResource } from "./settings/resourceLoader";
import { FONTS, DEFAULT_FONT_ID } from "./settings/fontConfig";
import { THEMES, DEFAULT_THEME_ID } from "./settings/themeConfig";
import "./App.css";

const EMOJI_COMMON = ["📄","📝","📌","📎","🗒","🗃","📂","📁","⭐","🔖","💡","🔍","🎯","🚀","✅","❌","⚠️","🔧","🔑","📊","📈","📉","🗓","💬","📧","🏠","🌟","💎","🎨","🎵"];

interface PageMeta { title: string; icon: string | null; cover: string | null }

export default function App() {
  const saved = loadSavedSettings();
  const [fontId, setFontId] = useState(saved.fontId);
  const [themeId, setThemeId] = useState(saved.themeId);

  const setFont = async (id: string) => {
    const entry = FONTS.find((f) => f.id === id) ?? FONTS.find((f) => f.id === DEFAULT_FONT_ID)!;
    const result = await loadResource(entry);
    if (!result.fallbackUsed) {
      setFontId(id);
      saveFont(id);
    } else {
      setFontId(DEFAULT_FONT_ID);
      saveFont(DEFAULT_FONT_ID);
    }
    return result;
  };

  const setTheme = async (id: string) => {
    const entry = THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
    const result = await loadResource(entry);
    if (!result.fallbackUsed) {
      setThemeId(id);
      saveTheme(id);
    } else {
      setThemeId(DEFAULT_THEME_ID);
      saveTheme(DEFAULT_THEME_ID);
    }
    return result;
  };

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [sidebarKey, setSidebarKey] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const editorRef = useRef<EditorHandle>(null);
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);

  const refreshSidebar = useCallback(() => setSidebarKey(k => k + 1), []);

  const loadPageMeta = useCallback(async (id: string) => {
    const page = await api.pages.get(id);
    setPageMeta({ title: page.title ?? "", icon: page.icon, cover: page.cover ?? null });
    setTitleDraft(page.title ?? "");
  }, []);

  useEffect(() => {
    if (!selectedPageId) { setPageMeta(null); return; }
    void loadPageMeta(selectedPageId);
  }, [selectedPageId, loadPageMeta]);

  const handleSelect = (id: string) => {
    editorRef.current?.flush();
    setSelectedPageId(id);
  };

  const handleTitleChange = (val: string) => {
    setTitleDraft(val);
    if (!selectedPageId) return;
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    titleSaveTimer.current = setTimeout(async () => {
      await api.pages.update(selectedPageId, { title: val });
      refreshSidebar();
    }, 800);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // focus editor first block
      const editorEl = document.querySelector<HTMLElement>(".bn-editor [contenteditable]");
      editorEl?.focus();
    }
  };

  const handleIconSelect = async (emoji: string) => {
    if (!selectedPageId) return;
    setIconPickerOpen(false);
    setPageMeta(m => m ? { ...m, icon: emoji } : m);
    await api.pages.update(selectedPageId, { icon: emoji });
    refreshSidebar();
  };

  const handleRemoveIcon = async () => {
    if (!selectedPageId) return;
    setIconPickerOpen(false);
    setPageMeta(m => m ? { ...m, icon: null } : m);
    await api.pages.update(selectedPageId, { icon: "" });
    refreshSidebar();
  };

  const handleAddCover = async () => {
    if (!selectedPageId) return;
    // default Notion-style gradient cover
    const defaultCover = "linear-gradient(135deg,#667eea 0%,#764ba2 100%)";
    setPageMeta(m => m ? { ...m, cover: defaultCover } : m);
    await api.pages.update(selectedPageId, { cover: defaultCover });
  };

  const handleChangeCover = async () => {
    if (!selectedPageId) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 512 * 1024) { alert("封面图片不超过 500KB"); return; }
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        setPageMeta(m => m ? { ...m, cover: dataUrl } : m);
        await api.pages.update(selectedPageId, { cover: dataUrl });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleRemoveCover = async () => {
    if (!selectedPageId) return;
    setPageMeta(m => m ? { ...m, cover: null } : m);
    await api.pages.update(selectedPageId, { cover: "" });
  };

  // Cmd+K 全文搜索 / Cmd+S 阻止浏览器保存对话框（内容已自动保存）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(v => !v); }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); editorRef.current?.flush(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSearchSelect = (pageId: string) => {
    setSearchOpen(false);
    handleSelect(pageId);
  };

  // auto-resize textarea
  useEffect(() => {
    const el = titleInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [titleDraft]);

  return (
    <SettingsContext.Provider value={{ fontId, themeId, setFont, setTheme }}>
    <div className="app">
      <Sidebar key={sidebarKey} selectedId={selectedPageId} onSelect={handleSelect} />
      {searchOpen && <SearchModal onSelect={handleSearchSelect} onClose={() => setSearchOpen(false)} />}
      <main className="main">
        {selectedPageId && pageMeta !== null ? (
          <>
            {pageMeta.cover && (
              <div
                className="page-cover"
                style={pageMeta.cover.startsWith("linear-gradient") ? { background: pageMeta.cover } : { backgroundImage: `url(${pageMeta.cover})` }}
              >
                <div className="page-cover-actions">
                  <button className="page-cover-action-btn" onClick={() => void handleChangeCover()}>更换封面</button>
                  <button className="page-cover-action-btn" onClick={() => void handleRemoveCover()}>删除封面</button>
                </div>
              </div>
            )}
          <div className="page-wrap">
            <div className="page-header">
              <Breadcrumb pageId={selectedPageId} onSelect={(id) => handleSelect(id)} />
              {/* icon area */}
              <div className="page-icon-row">
                {pageMeta.icon ? (
                  <button className="page-icon-btn" onClick={() => setIconPickerOpen(v => !v)}>
                    {pageMeta.icon}
                  </button>
                ) : (
                  <button className="page-icon-add-btn" onClick={() => setIconPickerOpen(v => !v)}>
                    添加图标
                  </button>
                )}
              </div>
              {!pageMeta.cover && (
                <button className="page-cover-add-btn" onClick={() => void handleAddCover()}>添加封面</button>
              )}
              {iconPickerOpen && (
                <>
                  <div className="icon-picker-overlay" onClick={() => setIconPickerOpen(false)} />
                  <div className="icon-picker-popover">
                    <div className="icon-picker-grid">
                      {EMOJI_COMMON.map(e => (
                        <button key={e} className="icon-picker-emoji" onClick={() => void handleIconSelect(e)}>{e}</button>
                      ))}
                    </div>
                    {pageMeta.icon && (
                      <button className="icon-picker-remove" onClick={() => void handleRemoveIcon()}>移除图标</button>
                    )}
                  </div>
                </>
              )}
              {/* title */}
              <textarea
                ref={titleInputRef}
                className="page-title-input"
                value={titleDraft}
                placeholder="Untitled"
                onChange={e => handleTitleChange(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                rows={1}
              />
            </div>
            <Editor key={selectedPageId} ref={editorRef} pageId={selectedPageId} onSelectPage={handleSelect} />
          </div>
          </>
        ) : selectedPageId ? (
          <div className="page-wrap">
            <div className="page-header-loading" />
            <Editor key={selectedPageId} ref={editorRef} pageId={selectedPageId} onSelectPage={handleSelect} />
          </div>
        ) : (
          <div className="empty-state">
            <p>从左侧选择页面，或点击 + 新建</p>
          </div>
        )}
      </main>
    </div>
    </SettingsContext.Provider>
  );
}
