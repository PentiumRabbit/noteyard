# arch-backend 后端架构摘要

> 产出角色：后端架构师（arch-backend）
> 最后更新：2026-05-02 · dispatch #57

---

## 1. 分层结构

```
server/
├── cmd/main.go                          # 入口：路由注册、DB 初始化、config 加载
└── internal/
    ├── config/config.go                 # 配置读取（~/.config/noteyard/config.toml）
    ├── model/model.go                   # 纯数据结构，无业务逻辑
    ├── repository/repository.go         # 接口定义（PageRepository / BlockRepository / DatabaseRepository）
    ├── repository/sqlite/               # SQLite 实现层
    │   ├── page_repo.go
    │   ├── block_repo.go
    │   ├── database_repo.go             # 含 batchFetchAllCells（批量 cell 查询）
    │   ├── formula_eval.go              # 公式计算，含循环依赖 DFS 检测
    │   └── db.go                        # DB 连接封装
    ├── handler/                         # HTTP handler 层
    │   ├── page_handler.go
    │   ├── block_handler.go
    │   ├── database_handler.go
    │   ├── meta_handler.go              # 书签 meta 抓取（SSRF 防护）
    │   ├── upload_handler.go
    │   ├── config_handler.go
    │   ├── sort_filter.go               # filter/sort 权威实现 + ParseSortFilter helper
    │   └── util.go
    ├── backup/backup.go                 # 定期备份（atomic.Bool CAS 防竞态）
    └── db/
        ├── migrate.go                   # schema 迁移
        └── seed.go                      # 开发种子数据
```

---

## 2. 关键接口（repository.go）

**PageRepository**：GetByID、ListChildren、ListAll、ListTrashed、GetAncestors、Create、Update、SoftDelete、Restore、PermanentDelete、Move、Search、Backlinks

**BlockRepository**：ListByPage、GetByID、Create、Update、Delete、BatchUpdate

**DatabaseRepository**：Create、GetByID、UpdateTitle、Delete、AddColumn、UpdateColumn、DeleteColumn、AddRow、UpdateRow、DeleteRow、ListRows、GetRow、BatchUpdateCells、ReorderRows

---

## 3. 数据模型（model.go）

| 类型 | 关键字段 |
|------|---------|
| `Page` | ID, ParentID, Title, Icon, Cover, OrderIndex, CreatedAt/UpdatedAt/DeletedAt |
| `Block` | ID, PageID, ParentBlockID, Type, Content, ContentVersion, Props, OrderIndex |
| `Database` | ID, PageID, Title, Columns([]*DBColumn), CreatedAt/UpdatedAt |
| `DBColumn` | ID, DatabaseID, Name, Type, Options, Formula, IsHidden, OrderIndex |
| `DBRow` | ID, DatabaseID, Cells(map[string]string), OrderIndex |
| `DatabaseSummary` | ID, Name, PageID（轻量列表接口用，不含 Columns/Rows） |

---

## 4. 数据库访问模式

- 所有 handler 通过 repository 接口访问 DB，**无直接 DB 操作**
- SQLite 单文件：`~/.local/share/noteyard/noteyard.db`（路径由 config 决定）
- `ListRows`：REQ-065 后已改为 `batchFetchAllCells` 批量查询（原 N+1 已修复）
  - 批量 SQL：`SELECT row_id, column_id, value FROM database_cells WHERE row_id IN (...)`
  - 内存中按 `row_ID` 分组，赋值回 `row.Cells`
- formula/rollup 在 `formula_eval.go` 中独立计算，含循环依赖 DFS 检测

---

## 5. HTTP 路由约定（main.go）

- 前缀 `/api`，使用 chi router
- 核心路由：`/api/pages`、`/api/blocks`、`/api/databases`、`/api/uploads`、`/api/meta`、`/api/config`
- `GET /api/databases`（无 `{id}`）：ListAll，返回 `[]*DatabaseSummary` 数组
- `GET /api/databases/{id}/rows`：支持 filter/sort query params（见第 6 节）

---

## 6. filter/sort 契约（sort_filter.go 为权威实现）

Query params（`GET /api/databases/{id}/rows`）：

| 参数 | 说明 |
|------|------|
| `sort_col` | 排序列 ID |
| `sort_order` | `"asc"` / `"desc"` |
| `filter_col` | 过滤列 ID |
| `filter_op` | 操作符（见下） |
| `filter_val` | 过滤值 |

支持操作符：`contains`、`not_contains`、`equals`、`not_equals`、`is_empty`、`is_not_empty`、`gt`、`lt`

- 未知操作符：返回 `false`（server 端 warn log，不泄漏给客户端）
- `contains`/`not_contains`：大小写不敏感；`equals`/`not_equals`：大小写敏感
- `ParseSortFilter(r *http.Request)` helper 统一解析参数，`database_handler.go` `ListRows` 已使用

---

## 7. 重要约束

1. **handler 不得直接访问 DB**，必须通过 repository 接口——场景矩阵 #8 验证通过
2. **model 层纯数据结构**，不含业务逻辑
3. **备份并发安全**：`Manager.running atomic.Bool` CAS 保护，同一时刻最多一个 `triggerAsync`
4. **MetaHandler SSRF 防护**：拒绝 RFC1918 / loopback / link-local IP（`isPrivateHost` 函数）
5. **错误码规范**：`sql.ErrNoRows` → 404；其他 DB 错误 → 500（日志记录完整错误，响应只返回通用描述）
6. **sort_filter.go default case** 返回 `false`，防止未知操作符全通行为
7. **`DatabaseSummary`** 用于 ListAll 接口，不加载 Columns/Rows，保持轻量

---

## 8. 上次变更摘要（REQ-065 · dispatch #40-46）

| 问题 | 修复内容 | 文件 |
|------|---------|------|
| I-004 N+1 查询 | 新增 `batchFetchAllCells`，`ListRows` 改为批量查询 | `database_repo.go` |
| I-010 SSRF | 新增 `isPrivateHost`，MetaHandler 插入 IP 校验 | `meta_handler.go` |
| I-014 错误码混用 | `Get` handler 区分 404/500 | `database_handler.go`, `page_handler.go` |
| I-015 backup 竞态 | `running atomic.Bool` CAS 保护 `triggerAsync` | `backup.go` |
| I-021 sort_filter 全通 | default case → false + warn log；降序改为显式 `>` | `sort_filter.go` |
| 新增接口 | `GET /api/databases`（ListAll）+ `DatabaseSummary` model | 多文件 |
| ParseSortFilter | 提取 helper，`ListRows` 使用 | `sort_filter.go`, `database_handler.go` |

## 9. ISS-026 变更摘要（dispatch #158，2026-05-04）

新增 `POST /api/databases/{id}/rows/reorder` 接口，支持 Table View 行拖拽排序持久化。

- `ReorderRows(ctx, dbID, rowIDs)` 在单一事务内批量 UPDATE `database_rows.order_index`，`database_rows.order_index` 字段已存在无需迁移
- 现有 `UpdateRow` 接口不受影响（仅更新 content）
- 错误处理遵循现有规范：事务失败返回 500
