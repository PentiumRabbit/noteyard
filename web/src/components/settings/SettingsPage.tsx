import { useEffect, useState } from "react";
import { exportAll, API_BASE } from "../../api/client";
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
  max_backups: number;
  backup_count: number;
  last_backup_at: string; // RFC3339 or ""
}

async function fetchConfig(): Promise<AppConfig | null> {
  try {
    const res = await fetch(API_BASE + "/api/config");
    if (!res.ok) return null;
    return (await res.json()) as AppConfig;
  } catch {
    return null;
  }
}

async function saveConfig(patch: { data_dir?: string; ops_threshold?: number; max_backups?: number }): Promise<AppConfig> {
  const res = await fetch(API_BASE + "/api/config", {
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
type Category = "appearance" | "data" | "shortcuts";

const CATEGORIES: { key: Category; label: string }[] = [
  { key: "appearance", label: "外观" },
  { key: "data", label: "数据 & 备份" },
  { key: "shortcuts", label: "快捷键" },
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
          {activeCategory === "shortcuts" && <ShortcutsSection />}
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
// Cleanup orphan uploads
// ---------------------------------------------------------------------------
interface CleanupResult {
  deleted: number;
  files: string[];
}

async function cleanupOrphanUploads(): Promise<CleanupResult> {
  const res = await fetch(API_BASE + "/api/uploads/cleanup", {
    method: "POST",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as CleanupResult;
}

// ---------------------------------------------------------------------------
// Data & Backup section
// ---------------------------------------------------------------------------
function DataSection() {
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [dataDir, setDataDir] = useState("");
  const [opsThreshold, setOpsThreshold] = useState(50);
  const [maxBackups, setMaxBackups] = useState(10);
  const [configSaving, setConfigSaving] = useState(false);
  const [configStatus, setConfigStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetchConfig().then((cfg) => {
      if (cfg) {
        setAppConfig(cfg);
        setDataDir(cfg.data_dir);
        setOpsThreshold(cfg.ops_threshold);
        setMaxBackups(cfg.max_backups);
      }
    });
  }, []);

  const handleCleanup = async () => {
    setCleanupRunning(true);
    setCleanupStatus(null);
    try {
      const result = await cleanupOrphanUploads();
      setCleanupStatus({
        ok: true,
        msg: result.deleted === 0 ? "无孤儿文件" : `已清理 ${result.deleted} 个文件`,
      });
    } catch (err) {
      setCleanupStatus({ ok: false, msg: String(err instanceof Error ? err.message : err) });
    } finally {
      setCleanupRunning(false);
    }
  };

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    setConfigStatus(null);
    try {
      const patch: { data_dir?: string; ops_threshold?: number; max_backups?: number } = {};
      if (appConfig && dataDir !== appConfig.data_dir) patch.data_dir = dataDir;
      if (appConfig && opsThreshold !== appConfig.ops_threshold) patch.ops_threshold = opsThreshold;
      if (appConfig && maxBackups !== appConfig.max_backups) patch.max_backups = maxBackups;
      if (Object.keys(patch).length === 0) {
        setConfigSaving(false);
        return;
      }
      const updated = await saveConfig(patch);
      setAppConfig(updated);
      setDataDir(updated.data_dir);
      setOpsThreshold(updated.ops_threshold);
      setMaxBackups(updated.max_backups);
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

      <div className="settings-page-field">
        <label className="settings-page-field-label">最多保留备份数</label>
        <input
          className="settings-page-field-input settings-page-field-input--number"
          type="number"
          min={0}
          max={9999}
          value={maxBackups}
          placeholder="0 = 不限制"
          onChange={(e) => setMaxBackups(Math.max(0, Math.min(9999, Number(e.target.value))))}
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

      <div className="settings-page-divider" />

      <div className="settings-page-field">
        <span className="settings-page-field-label">清理孤儿上传文件</span>
        <span className="settings-page-field-value settings-page-field-value--hint">
          删除不再被任何页面或数据库引用的上传文件
        </span>
      </div>

      <button
        className="settings-page-save-btn"
        onClick={() => void handleCleanup()}
        disabled={cleanupRunning}
      >
        {cleanupRunning ? "清理中…" : "立即清理"}
      </button>

      {cleanupStatus && (
        <div className={`settings-page-status${cleanupStatus.ok ? "" : " settings-page-status--error"}`}>
          {cleanupStatus.msg}
        </div>
      )}

      <div className="settings-page-divider" />

      <div className="settings-page-field">
        <span className="settings-page-field-label">导出全库</span>
        <span className="settings-page-field-value settings-page-field-value--hint">
          将所有页面打包为 ZIP 文件下载
        </span>
      </div>

      <div className="settings-page-options">
        <button
          className="settings-page-save-btn"
          onClick={() => exportAll('markdown')}
        >
          全部导出为 Markdown
        </button>
        <button
          className="settings-page-save-btn"
          onClick={() => exportAll('json')}
        >
          全部导出为 JSON
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shortcuts section
// ---------------------------------------------------------------------------
interface ShortcutRow {
  action: string;
  keys: string[];
}

const SHORTCUT_GROUPS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: "全局",
    rows: [
      { action: "打开全局搜索", keys: ["⌘K", "Ctrl+K"] },
    ],
  },
  {
    title: "编辑器",
    rows: [
      { action: "斜杠菜单", keys: ["/"] },
      { action: "撤销", keys: ["⌘Z", "Ctrl+Z"] },
      { action: "重做", keys: ["⌘⇧Z", "Ctrl+Shift+Z"] },
      { action: "加粗", keys: ["⌘B", "Ctrl+B"] },
      { action: "斜体", keys: ["⌘I", "Ctrl+I"] },
      { action: "代码", keys: ["⌘E", "Ctrl+E"] },
    ],
  },
  {
    title: "侧边栏",
    rows: [
      { action: "新建页面", keys: ["侧边栏 + 按钮"] },
    ],
  },
];

function ShortcutsSection() {
  return (
    <>
      {SHORTCUT_GROUPS.map((group, gi) => (
        <section key={group.title} className="settings-page-section">
          <div className="settings-page-section-title">{group.title}</div>
          <table className="settings-page-shortcuts-table">
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.action} className="settings-page-shortcuts-row">
                  <td className="settings-page-shortcuts-action">{row.action}</td>
                  <td className="settings-page-shortcuts-keys">
                    {row.keys.map((k, i) => (
                      <span key={k}>
                        <kbd className="settings-page-kbd">{k}</kbd>
                        {i < row.keys.length - 1 && (
                          <span className="settings-page-kbd-sep">/</span>
                        )}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {gi < SHORTCUT_GROUPS.length - 1 && <div className="settings-page-divider" />}
        </section>
      ))}
    </>
  );
}
