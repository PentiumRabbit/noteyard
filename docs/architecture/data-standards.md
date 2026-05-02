# noteyard 数据规范

> 本文件定义 noteyard 项目的数据存储、配置、备份、Schema 迁移、内容版本迁移等技术规范。
> 所有涉及数据层的开发必须遵守本文件，变更需更新本文件。

---

## 一、数据目录结构

```
{data_dir}/
├── noteyard.db          # 主数据库
└── backups/             # 备份目录（自动创建）
    └── noteyard-backup-YYYY-MM-DDTHH-MM-SS.db
```

### 平台默认路径

| 平台 | 默认 data_dir |
|------|--------------|
| macOS | `~/Library/Application Support/noteyard/` |
| Windows | `%APPDATA%\noteyard\` |
| Linux | `~/.local/share/noteyard/` |

- 用户可在设置页面修改 `data_dir`，修改后数据库和备份目录整体迁移
- Go server 通过配置文件读取 `data_dir`，不得硬编码路径

---

## 二、配置文件

**路径**：`~/.config/noteyard/config.toml`（跨平台固定，不随 data_dir 变化）

**格式**：

```toml
[data]
dir = "/Users/xxx/Library/Application Support/noteyard"

[backup]
ops_threshold = 50
```

**规则**：
- 应用启动时读取；文件不存在时写入平台默认值
- 设置页面保存后立即同步写入
- 读取失败（格式错误等）时使用默认值启动，记录日志，不崩溃
- 外部修改配置文件后下次启动生效，不需热更新

---

## 三、备份规范

### 触发时机

1. **操作计数达阈值**：写操作（新建/编辑/删除）累计达到 `ops_threshold`（默认 50）后触发，计数归零
2. **应用退出时**：Tauri 收到退出事件，若距上次备份有写操作则触发一次

### 文件命名

```
noteyard-backup-{YYYY-MM-DD}T{HH-MM-SS}.db
```

示例：`noteyard-backup-2026-05-02T14-30-00.db`

### 其他规则

- 备份为 `.db` 文件直接复制，可用任意 SQLite 工具打开
- 备份过程异步执行，不阻塞用户操作
- 备份失败静默降级（记录日志，不弹错误）
- 本期不限制备份数量，不做自动清理

---

## 四、Schema 迁移规范

### 迁移版本表

数据库内维护 `schema_migrations` 表：

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL
);
```

### 规则

- 初始 schema 为版本 0，无需记录；第一次结构变更从版本 1 开始
- 每个版本对应一个迁移函数，按版本号顺序执行
- 应用启动时检查最高已迁移版本，依次执行尚未执行的版本
- 迁移成功后写入版本记录；失败时不写入（幂等）
- 迁移失败时终止启动，向用户展示错误原因
- 迁移代码统一放在 `server/internal/db/migrate.go`

### 新增迁移步骤

1. 在 `migrate.go` 的迁移列表末尾追加新版本函数
2. 版本号必须连续递增，不得跳号
3. 迁移函数必须幂等（可重复执行不报错）

---

## 五、内容版本迁移规范

### 字段定义

`notes` 表含 `content_version INTEGER NOT NULL DEFAULT 1`，标识该笔记 BlockNote JSON 格式的版本号。

### 规则

- 读取笔记时，Go server 根据 `content_version` 决定是否执行格式转换
- 写入笔记时，始终以当前最新版本存储，并更新 `content_version`
- 版本升级路径逐步执行（1→2→3…），不跳级
- 转换函数注册在 `server/internal/db/content_migrate.go` 的注册表中（`map[int]ContentMigrateFn`）
- 当前最新版本为 **1**，无实际转换逻辑（框架占位）

### 新增内容版本步骤

1. 在 `content_migrate.go` 的注册表中追加新版本转换函数
2. 更新本文件中「当前最新版本」字段
3. 版本号必须连续递增

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-05-02 | 初始版本，来自 REQ-061 |
