import { useEffect, useRef, useState } from "react";
import { FONTS } from "../../settings/fontConfig";
import { THEMES } from "../../settings/themeConfig";
import { useSettings } from "../../settings/settingsStore";
import "./SettingsPanel.css";

interface Props {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function SettingsPanel({ anchorRef, onClose }: Props) {
  const { fontId, themeId, setFont, setTheme } = useSettings();
  const [fontStatus, setFontStatus] = useState<string | null>(null);
  const [themeStatus, setThemeStatus] = useState<string | null>(null);
  const [loadingFont, setLoadingFont] = useState<string | null>(null);
  const [loadingTheme, setLoadingTheme] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Position panel above the anchor button
  const [pos, setPos] = useState({ bottom: 0, left: 0 });
  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ bottom: window.innerHeight - rect.top + 4, left: rect.left });
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const handleFont = async (id: string) => {
    setLoadingFont(id);
    setFontStatus(null);
    const result = await setFont(id);
    setLoadingFont(null);
    if (result.fallbackUsed) setFontStatus("无法加载网络字体，已使用默认字体");
    else if (result.fromCache) setFontStatus("已离线，使用上次下载版本");
    else setFontStatus(null);
  };

  const handleTheme = async (id: string) => {
    setLoadingTheme(id);
    setThemeStatus(null);
    const result = await setTheme(id);
    setLoadingTheme(null);
    if (result.fallbackUsed) setThemeStatus("主题加载失败，已切换至默认亮色");
    else if (result.fromCache) setThemeStatus("已离线，使用上次下载版本");
    else setThemeStatus(null);
  };

  return (
    <div
      ref={panelRef}
      className="settings-panel"
      style={{ bottom: pos.bottom, left: pos.left }}
    >
      <section className="settings-section">
        <div className="settings-section-title">字体</div>
        <div className="settings-options">
          {FONTS.map((f) => (
            <button
              key={f.id}
              className={`settings-option${fontId === f.id ? " active" : ""}`}
              onClick={() => void handleFont(f.id)}
              disabled={loadingFont === f.id}
            >
              <span className="settings-option-name">{f.name}</span>
              {f.type === "remote" && <span className="settings-option-badge">🌐</span>}
              {loadingFont === f.id && <span className="settings-option-loading" />}
            </button>
          ))}
        </div>
        {fontStatus && <div className="settings-status">{fontStatus}</div>}
      </section>

      <div className="settings-divider" />

      <section className="settings-section">
        <div className="settings-section-title">主题</div>
        <div className="settings-options">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`settings-option${themeId === t.id ? " active" : ""}`}
              onClick={() => void handleTheme(t.id)}
              disabled={loadingTheme === t.id}
            >
              <span className="settings-option-name">{t.name}</span>
              {t.type === "remote" && <span className="settings-option-badge">🌐</span>}
              {loadingTheme === t.id && <span className="settings-option-loading" />}
            </button>
          ))}
        </div>
        {themeStatus && <div className="settings-status">{themeStatus}</div>}
      </section>
    </div>
  );
}
