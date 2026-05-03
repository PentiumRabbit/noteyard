# REQ-070 执行计划 — 欢迎页 Seed 内容与代码分离

| 字段 | 内容 |
|------|------|
| REQ ID | REQ-070 |
| PM | pm-REQ-070 (DISPATCH#128) |
| 计划版本 | v1.0 |
| 日期 | 2026-05-03 |
| 状态 | 已交付 |

---

## 一、需求范围确认

### 核心目标

将 `server/internal/db/seed.go` 中硬编码的欢迎页内容（45 个块）提取为独立 JSON 文件，服务端读取后写入数据库，实现内容与代码分离。同时修复旧迁移表兼容性问题，确保全新数据库和旧数据库均能正确触发欢迎页。

### 不在范围

- 数据库块的 seed 格式支持
- Markdown 导入转换器
- seed 文件热重载
- 多语言 seed 支持

---

## 二、任务拆解

### T1 — 新建 seeds/welcome.json

**负责角色**：工程师（后端）

**交付物**：
- `server/internal/db/seeds/welcome.json`

**要求**：
- 格式符合 REQ-070 规定的 BlockNote Seed 方言（version=1，page 元数据，blocks 数组）
- 内容与现有 `seed.go` 中的文案保持一致，格式迁移
- `page.id` 固定为 `00000000-0000-0000-0000-000000000001`
- 所有块 id 与 `seed.go` 中保持一致，便于幂等检查
- 覆盖以下 8 个章节：标题+简介 callout、分割线、页面与导航、块编辑器、数据库、页面装饰、并排布局、常用快捷键、尾注

**验收标准**：
- JSON 可被 `json.Unmarshal` 成功解析
- blocks 数量与 `seed.go` 中一致（45 个）

---

### T2 — 新建 seeds/loader.go 提供 LoadSeed / ParseSeed / ApplySeed

**负责角色**：工程师（后端）

**交付物**：
- `server/internal/db/seeds/loader.go`
- `server/internal/db/seeds/embed.go`（go:embed 嵌入 welcome.json）

**要求**：

`LoadSeed(path string) (*SeedPage, []SeedBlock, error)`
- 读取磁盘上的 JSON 文件，解析后返回 SeedPage 和展开的 SeedBlock 列表

`ParseSeed(data []byte) (*SeedPage, []SeedBlock, error)`
- 解析 bytes，供 go:embed 路径使用

`ApplySeed(tx *sql.Tx, page *SeedPage, blocks []SeedBlock) error`
- 幂等写入：若 `page.id` 已存在则跳过，不存在则插入 page + blocks
- blocks 需正确设置 `page_id`、`parent_block_id`（columnList/column 嵌套场景）、`order_index`

转换规则：
- `content` 为字符串 → 展开为 `[{"type":"text","text":"...","styles":{}}]`
- `content` 为数组 → 原样序列化
- `props` 缺省 → 各类型有合理默认值（heading 默认 level=1，callout 默认 icon=💡 等）
- `order_index` 按块在数组中的位置自动生成（1.0, 2.0, ...），嵌套子块同理
- `parent_block_id`：顶层块为 NULL，嵌套块指向父块 id

**验收标准**：
- 函数签名与 REQ-070 规范完全一致
- columnList/column 嵌套时 parent_block_id 赋值正确

---

### T3 — 新增 migration v4，注册 ApplySeed

**负责角色**：工程师（后端）

**交付物**：
- `server/internal/db/seed.go`（修改：新增 `welcomeSeedV4` 函数 + init() 注册）

**要求**：
- 新增内部函数 `welcomeSeedV4`：调用 `seeds.ParseSeed(seeds.WelcomeJSON)` + `seeds.ApplySeed`
- 在 `init()` 中注册 `Migration{Version: 4, Up: welcomeSeedV4}`
- 旧 v2（`WelcomeSeedMigration`）和 v3（`cleanWelcomeBlocks`）函数体保留，不删除

**验收标准**：
- v4 迁移在全新数据库上运行后欢迎页存在
- 已有欢迎页时 v4 幂等跳过

---

### T4 — 修复旧迁移表兼容性（syncLegacyMigrations）

**负责角色**：工程师（后端）

**交付物**：
- `server/internal/db/migrate.go`（修改：新增 `syncLegacyMigrations` 函数）

**要求**：
- `RunMigrations` 启动时，若旧 `migrations` 时间戳表存在，将其中的版本号同步写入 `schema_migrations`
- 同步使用 `INSERT OR IGNORE`，不覆盖已有记录
- 读完 rows 再关闭游标，避免 SQLite MaxOpenConns=1 死锁

**验收标准**：
- 已有旧 `migrations` 表的数据库启动后，v2/v3/v4 不重复执行
- 旧数据不丢失

---

### T5 — loader_test.go 单元测试

**负责角色**：工程师（后端）/ 测试执行者

**交付物**：
- `server/internal/db/seeds/loader_test.go`

**要求**：
- 覆盖 `expandContent` 字符串展开场景
- 覆盖 `expandContent` 数组透传场景
- 覆盖 `expandContent` null/空值场景
- 覆盖 `LoadSeed` columnList 嵌套场景（验证 parent_block_id 赋值和 content 展开）
- 覆盖 `LoadSeed` 加载实际 welcome.json 场景（验证格式合法性）

**验收标准**：
- `go test ./server/internal/db/seeds/...` 全部通过
- 测试覆盖 content 字符串展开和 columnList 嵌套两个核心场景

---

## 三、交付顺序

```
T2（loader.go + embed.go）→ T1（welcome.json）→ T3（v4 迁移注册）→ T4（迁移兼容）→ T5（测试）
```

T2 先于 T1，因为 loader.go 定义类型和接口；T5 在 T1/T2 完成后可以独立进行。

---

## 四、验收矩阵

| 场景 | 预期结果 | 关联任务 |
|------|---------|---------|
| 全新数据库启动 | 侧边栏出现欢迎页，内容与 welcome.json 一致 | T1, T2, T3 |
| 已有旧 `migrations` 表数据库启动 | 欢迎页正常出现，旧数据不丢失，v2/v3 不重复执行 | T3, T4 |
| 已有新 `schema_migrations` 表（v2/v3 已执行）启动 | v4 幂等跳过，不重复插入 | T3 |
| 修改 welcome.json 后删除欢迎页重启 | 新内容生效 | T1, T2, T3 |
| 运行单元测试 | 全部通过，覆盖 string 展开和 columnList 嵌套 | T5 |

---

## 五、实际交付记录

全部任务已由 `dev-lead#74` 在一次 commit 中完成并合入主分支：

- commit: `dc5591a feat(seed)[dev-lead#74]: REQ-070 欢迎页 seed 内容与代码分离`
- 交付文件：
  - `server/internal/db/seeds/welcome.json`
  - `server/internal/db/seeds/loader.go`
  - `server/internal/db/seeds/embed.go`
  - `server/internal/db/seeds/loader_test.go`
  - `server/internal/db/seed.go`（新增 v4 迁移）
  - `server/internal/db/migrate.go`（新增 syncLegacyMigrations）

所有验收标准已满足。
