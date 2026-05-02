# REQ-061 技术评审报告

| 字段 | 内容 |
|------|------|
| REQ | REQ-061 |
| 评审角色 | 总架构师 |
| 日期 | 2026-05-02 |
| 状态 | 通过 |

---

## 一、现状分析

### 1.1 数据库路径（`server/cmd/main.go`）

```go
func dbFilePath() string {
    home, _ := os.UserHomeDir()
    return filepath.Join(home, ".local", "share", "noteyard", "noteyard.db")
}
```

- 路径硬编码，跨平台不规范（macOS 应用规范路径为 `~/Library/Application Support/noteyard/`）
- 无配置文件读写机制
- 无备份触发逻辑

### 1.2 迁移机制（`server/internal/repository/sqlite/db.go`）

现有 `migrate()` 已实现按 SQL 文件版本顺序执行的机制，但：
- 迁移表名为 `migrations`，REQ-061 要求新增 `schema_migrations`（可复用现有机制并重命名/新建）
- 无 `content_version` 字段及内容迁移注册表

### 1.3 前端设置（`web/src/components/settings/SettingsPanel.tsx`）

现有设置面板仅有字体/主题切换，无数据目录和备份阈值字段，无调用后端配置 API。

---

## 二、技术方案

### 2.1 配置文件模块（T1）

新增 `server/internal/config/config.go`：
- 使用 `github.com/BurntSushi/toml` 解析 `~/.config/noteyard/config.toml`
- 平台默认数据目录：
  - macOS → `~/Library/Application Support/noteyard/`
  - Windows → `%APPDATA%\noteyard\`
  - Linux → `~/.local/share/noteyard/`
- 读取失败时降级为平台默认值，写入日志
- 启动时若文件不存在，自动写入默认值

`server/cmd/main.go` 中 `dbFilePath()` 改为从 `config.DataDir` 读取。

**依赖库**：`github.com/BurntSushi/toml` v1.x（项目已有或新增）

---

### 2.2 设置页面 UI（T2）

扩展 `web/src/components/settings/SettingsPanel.tsx`，新增两个配置项：

| 字段 | UI 控件 |
|------|---------|
| 数据目录 | 文本输入 + Tauri 目录选择器按钮 |
| 备份阈值 | number input（1–9999，默认 50） |

只读展示：备份数量、最近备份时间。

新增后端 API：
- `GET /api/config` — 返回当前配置 + 备份统计
- `PUT /api/config` — 写入配置（触发目录迁移）

---

### 2.3 数据目录迁移（T3）

新增 `server/internal/config/migrate_dir.go`：
1. 先备份原 DB（`backups/` 中创建一份）
2. `os.Rename` 尝试原子迁移（同卷），失败则 `io.Copy` 复制后删除原文件
3. 同时移动 `backups/` 子目录
4. 任何步骤失败立即回滚，返回错误

---

### 2.4 备份逻辑（T4）

新增 `server/internal/backup/backup.go`：
- `Backup(dbPath, backupsDir string) error` — 直接 `io.Copy` + 原子重命名
- 文件命名：`noteyard-backup-2026-05-02T14-30-00.db`
- `server/cmd/main.go` 维护 `opsCounter int64`（原子计数），每次写操作 +1，达阈值触发备份
- 注册 Tauri `window-close-requested` 或 OS Signal handler 作为退出钩子

**异步策略**：备份在单独 goroutine 执行，失败仅记录日志。

---

### 2.5 Schema 迁移框架（T5）

保留现有 `migrate()` 机制（表名 `migrations`），同时新增 `schema_migrations` 表与独立迁移框架：

新增 `server/internal/db/migrate.go`：
```go
type Migration struct {
    Version int
    Up      func(db *sql.DB) error
}

var Migrations []Migration
```

- 启动时遍历 `Migrations`，跳过已在 `schema_migrations` 记录的版本
- 失败时回滚（`BEGIN/ROLLBACK`），不写入版本记录，返回错误拒绝启动

> 注：现有 SQL 文件迁移仍由 `db.go` 中 `migrate()` 负责（结构初始化）；`schema_migrations` 用于版本化变更，从版本 1 开始计数。

---

### 2.6 content_version 字段与迁移注册表（T6）

新增 `server/internal/db/content_migrate.go`：
```go
type ContentMigrateFn func(content string) (string, error)

var contentMigrations = map[int]ContentMigrateFn{
    // 版本 1→2 时注册转换函数（本期 no-op 示例）
    // 2: func(s string) (string, error) { return s, nil },
}
```

Schema 迁移版本 N：`ALTER TABLE notes ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1`

读写路径改造：
- 读取时若 `content_version < currentVersion`，按版本链逐步调用 `contentMigrations`
- 写入时设置 `content_version = currentVersion`

---

## 三、任务拆分表

| 任务 | 负责角色 | 涉及文件 | 依赖 | 可并行 |
|------|---------|---------|------|--------|
| T1 — 配置文件读写 | 后端工程师 | `server/internal/config/config.go`、`server/cmd/main.go` | 无 | 是 |
| T2 — 设置页面 UI | 前端工程师 | `web/src/components/settings/SettingsPanel.tsx` + 新 API | T1 | 否 |
| T3 — 数据目录迁移逻辑 | 后端工程师 | `server/internal/config/migrate_dir.go` | T1 | 否 |
| T4 — 备份逻辑 | 后端工程师 | `server/internal/backup/backup.go`、`server/cmd/main.go` | T1 | 否 |
| T5 — Schema 迁移框架 | 后端工程师 | `server/internal/db/migrate.go`、`server/cmd/main.go` | 无 | 是 |
| T6 — content_version | 后端工程师 | `server/internal/db/content_migrate.go`、迁移脚本 | T5 | 否 |
| T7 — 验收测试 | 测试执行者 | — | T1–T6 | 否 |

**并行启动建议**：T1 与 T5 同时启动；T1 完成后并行启动 T2/T3/T4；T5 完成后启动 T6。

---

## 四、风险与注意事项

1. **TOML 依赖**：确认 `go.mod` 中是否已有 `github.com/BurntSushi/toml`，若无需 `go get` 添加
2. **跨卷迁移**：目录迁移需处理跨文件系统场景（`os.Rename` 失败时 fallback `io.Copy`）
3. **并发写计数**：`opsCounter` 必须用 `sync/atomic` 或 `sync.Mutex` 保证线程安全
4. **退出钩子**：Tauri sidecar 模式下 Go server 以子进程运行，建议监听 `os.Signal (SIGTERM/SIGINT)` + Tauri `on_window_event` 双保险
5. **现有 `migrations` 表**：T5 新增 `schema_migrations` 不应与现有表冲突；两张表共存，各自职责独立

---

## 五、结论

方案可行，无阻塞性风险。按上述任务拆分表并行推进，预计 T1+T5 → T2+T3+T4+T6（T5 完成后）→ T7 顺序完成。
