import { useEffect, useState } from "react";
import { FONTS } from "../../settings/fontConfig";
import { THEMES } from "../../settings/themeConfig";
import { useSettings } from "../../settings/settingsStore";
import "./SettingsPage.css";

// ---------------------------------------------------------------------------
// Types for /api/config
// ---------------------------------------------------------------------------
interface AppConfig {
  data_dir: string;
  ops_threshold: number;
  backup_count: number;
  last_backup_at: string; // RFC3339 or ""
}

async function fetchConfig(): Promise<AppConfig | null> {
  try {
    const res = await fetch("http://localhost:8080/api/config");
    if (!res.ok) return null;
    return (await res.json()) as AppConfig;
  } catch {
    return null;
  }
}

async function saveConfig(patch: { data_dir?: string; ops_threshold?: number }): Promise<AppConfig> {
  const res = await fetch("http://localhost:8080/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as AppConfig;
}

// ---------------------------------------------------------------------------
// Category types
// ---------------------------------------------------------------------------
type Category = "appearance" | "data";

const CATEGORIES: { key: Category; label: string }[] = [
  { key: "appearance", label: "外观" },
  { key: "data", label: "数据 & 备份" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Props {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------
export function SettingsPage({ onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<Category>("appearance");

  return (
    <div className="settings-page">
      <div className="settings-page-nav">
        <div className="settings-page-nav-title">设置</div>
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={`settings-page-nav-item${activeCategory === c.key ? " active" : ""}`}
            onClick={() => setActiveCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="settings-page-content">
        <div className="settings-page-content-header">
          <h2 className="settings-page-content-title">
            {CATEGORIES.find((c) => c.key === activeCategory)?.label}
          </h2>
          <button className="settings-page-close-btn" onClick={onClose} title="关闭设置">
            ✕
          </button>
        </div>

        <div className="settings-page-body">
          {activeCategory === "appearance" && <AppearanceSection />}
          {activeCategory === "data" && <DataSection />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appearance section
// ---------------------------------------------------------------------------
function AppearanceSection() {
  const { fontId, themeId, setFont, setTheme } = useSettings();
  const [fontStatus, setFontStatus] = useState<string | null>(null);
  const [themeStatus, setThemeStatus] = useState<string | null>(null);
  const [loadingFont, setLoadingFont] = useState<string | null>(null);
  const [loadingTheme, setLoadingTheme] = useState<string | null>(null);

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
    <>
      <section className="settings-page-section">
        <div className="settings-page-section-title">字体</div>
        <div className="settings-page-options">
          {FONTS.map((f) => (
            <button
              key={f.id}
              className={`settings-page-option${fontId === f.id ? " active" : ""}`}
              onClick={() => void handleFont(f.id)}
              disabled={loadingFont === f.id}
            >
              <span className="settings-page-option-name">{f.name}</span>
              {f.type === "remote" && <span className="settings-page-option-badge">🌐</span>}
              {loadingFont === f.id && <span className="settings-page-option-loading" />}
            </button>
          ))}
        </div>
        {fontStatus && <div className="settings-page-status">{fontStatus}</div>}
      </section>

      <div className="settings-page-divider" />

      <section className="settings-page-section">
        <div className="settings-page-section-title">主题</div>
        <div className="settings-page-options">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`settings-page-option${themeId === t.id ? " active" : ""}`}
              onClick={() => void handleTheme(t.id)}
              disabled={loadingTheme === t.id}
            >
              <span className="settings-page-option-name">{t.name}</span>
              {t.type === "remote" && <span className="settings-page-option-badge">🌐</span>}
              {loadingTheme === t.id && <span className="settings-page-option-loading" />}
            </button>
          ))}
        </div>
        {themeStatus && <div className="settings-page-status">{themeStatus}</div>}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Data & Backup section
// ---------------------------------------------------------------------------
function DataSection() {
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [dataDir, setDataDir] = useState("");
  const [opsThreshold, setOpsThreshold] = useState(50);
  const [configSaving, setConfigSaving] = useState(false);
  const [configStatus, setConfigStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetchConfig().then((cfg) => {
      if (cfg) {
        setAppConfig(cfg);
        setDataDir(cfg.data_dir);
        setOpsThreshold(cfg.ops_threshold);
      }
    });
  }, []);

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    setConfigStatus(null);
    try {
      const patch: { data_dir?: string; ops_threshold?: number } = {};
      if (appConfig && dataDir !== appConfig.data_dir) patch.data_dir = dataDir;
      if (appConfig && opsThreshold !== appConfig.ops_threshold) patch.ops_threshold = opsThreshold;
      if (Object.keys(patch).length === 0) {
        setConfigSaving(false);
        return;
      }
      const updated = await saveConfig(patch);
      setAppConfig(updated);
      setDataDir(updated.data_dir);
      setOpsThreshold(updated.ops_threshold);
      setConfigStatus({ ok: true, msg: "已保存" });
    } catch (err) {
      setConfigStatus({ ok: false, msg: String(err instanceof Error ? err.message : err) });
    } finally {
      setConfigSaving(false);
    }
  };

  const formatBackupTime = (iso: string) => {
    if (!iso) return "无";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  return (
    <section className="settings-page-section">
      <div className="settings-page-section-title">数据 &amp; 备份</div>

      <div className="settings-page-field">
        <label className="settings-page-field-label">数据目录</label>
        <input
          className="settings-page-field-input"
          type="text"
          value={dataDir}
          onChange={(e) => setDataDir(e.target.value)}
          placeholder="数据目录路径"
          spellCheck={false}
        />
      </div>

      <div className="settings-page-field">
        <label className="settings-page-field-label">备份阈值（操作次数）</label>
        <input
          className="settings-page-field-input settings-page-field-input--number"
          type="number"
          min={1}
          max={9999}
          value={opsThreshold}
          onChange={(e) => setOpsThreshold(Math.max(1, Math.min(9999, Number(e.target.value))))}
        />
      </div>

      {appConfig && (
        <div className="settings-page-field settings-page-field--readonly">
          <span className="settings-page-field-label">备份数量</span>
          <span className="settings-page-field-value">{appConfig.backup_count}</span>
        </div>
      )}
      {appConfig && (
        <div className="settings-page-field settings-page-field--readonly">
          <span className="settings-page-field-label">最近备份</span>
          <span className="settings-page-field-value">{formatBackupTime(appConfig.last_backup_at)}</span>
        </div>
      )}

      <button
        className="settings-page-save-btn"
        onClick={() => void handleSaveConfig()}
        disabled={configSaving}
      >
        {configSaving ? "保存中…" : "保存"}
      </button>

      {configStatus && (
        <div className={`settings-page-status${configStatus.ok ? "" : " settings-page-status--error"}`}>
          {configStatus.msg}
        </div>
      )}
    </section>
  );
}
