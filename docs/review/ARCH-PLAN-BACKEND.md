# ARCH-PLAN-BACKEND — 后端修复技术方案

| 字段 | 内容 |
|------|------|
| 文档 ID | ARCH-PLAN-BACKEND |
| 对应需求 | REQ-065 |
| 审查来源 | CODE-REVIEW-001 |
| 日期 | 2026-05-02 |
| 角色 | 后端架构师（arch-backend） |
| dispatch ID | 40 |

---

## 1. 执行摘要

本方案覆盖 CODE-REVIEW-001 报告中 6 个后端问题的修复设计：

| 问题 ID | 优先级 | 类型 | 一句话描述 |
|---------|--------|------|-----------|
| I-004 | P0 | 性能 | ListRows N+1 查询 → 批量 IN 查询 |
| I-005 | P1 | 架构 | 前后端 filter/sort 重复 → 后端为权威，输出 API 契约 |
| I-010 | P1 | 安全 | MetaHandler SSRF → 拒绝私有/loopback IP |
| I-014 | P1 | 错误处理 | Get handler 错误码混用 → 区分 404/500 |
| I-015 | P1 | 并发 | backup 竞态 → atomic.Bool CAS 保护 |
| I-021 | P2 | 代码质量 | sort_filter.go 默认全通 + !less 误导 → 语义修正 |

同时覆盖：
- 新增 `GET /api/databases` 接口（I-020 前端需求的后端侧）
- `ParseSortFilter` helper 提取（复用机会）
- filter/sort API 契约（AR-3 前后端对齐）

---

## 2. 每个问题的修复方案

---

### I-004 — ListRows N+1 查询

**问题描述**  
`ListRows`（`database_repo.go` L191–205）在外层 `for rows.Next()` 循环中，对每行单独执行一次 `SELECT column_id,value FROM database_cells WHERE row_id=?`。100 行产生 101 次 SQL 查询。

**唯一解说明**  
复用已有的 `batchFetchCells` 模式（L282）——但需扩展为"所有列"的批量查询，而非指定单个 `columnID`。

**修复设计**

第一步：在完成行查询后，收集所有 `row.ID` 到一个 `[]string`。

第二步：新增私有方法 `batchFetchAllCells`，一次查询所有行的全部 cell：

```
func (r *DatabaseRepo) batchFetchAllCells(
    ctx context.Context,
    rowIDs []string,
) (map[string]map[string]string, error)
```

SQL 模板：
```sql
SELECT row_id, column_id, value
FROM database_cells
WHERE row_id IN (?, ?, ...)
```

返回 `map[rowID]map[colID]value`。

第三步：在 `ListRows` 中，收集完所有 rows 后调用 `batchFetchAllCells` 一次，然后内存中赋值：
```
for _, row := range result {
    row.Cells = allCells[row.ID]
    if row.Cells == nil {
        row.Cells = make(map[string]string)
    }
}
```

第四步：之后 formula / rollup 计算保持现有逻辑不变。

**影响文件/函数清单**

| 文件 | 变更 |
|------|------|
| `server/internal/repository/sqlite/database_repo.go` | `ListRows` L191–214 重构；新增 `batchFetchAllCells` 方法 |

**实现复杂度**：S（小，纯 repository 层，模式已有参考）

---

### I-005 — 前后端 filter/sort 重复

**问题描述**  
前端 `DatabaseView.tsx` L876–909 实现了与后端 `sort_filter.go` L11–66 功能重复的 filter+sort 逻辑，操作符集合有差异（大小写敏感性、数字比较精度）。

**方案说明**  
后端已是权威实现（AR-3）。后端侧无需新增逻辑，只需：
1. 确认并固化操作符集合（见第 4 节契约）
2. 提取 `ParseSortFilter` helper（见第 5 节），减少 handler 内散落的参数解析
3. 输出契约文档供前端架构师使用

前端需删除的重复逻辑范围见第 4 节。

**影响文件/函数清单**

| 文件 | 变更 |
|------|------|
| `server/internal/handler/sort_filter.go` | I-021 修正后即为标准实现，无需其他改动 |
| `server/internal/handler/database_handler.go` | `ListRows` L147–158 中参数解析代码替换为 `ParseSortFilter` 调用 |

**实现复杂度**：S（后端侧改动极小，主要工作在前端）

---

### I-010 — MetaHandler SSRF 风险

**问题描述**  
`meta_handler.go` L34 仅校验 scheme 为 `http/https`，未阻止访问私有 IP，导致 SSRF 攻击面。

**方案对比**

| 方案 | 描述 | 推荐 |
|------|------|------|
| **A：IP 解析 + 私有地址拒绝** | DNS 解析目标 hostname，检查每个返回 IP 是否属于私有/loopback/link-local 范围，拒绝则返回 400 | ✅ 推荐 |
| B：域名白名单 | 只允许请求特定域名集合 | 过于严格，破坏书签功能 |
| C：通过 Tauri Origin 校验 | 检查 `Origin` header 是否来自 Tauri | 单独使用不可靠，Origin 可伪造 |

**推荐方案 A 详细设计**

在 `MetaHandler` 中，完成 `url.Parse` 后、发起 HTTP 请求前，插入 IP 校验步骤：

```
func isPrivateHost(hostname string) (bool, error)
```

内部逻辑：
1. `net.LookupHost(hostname)` 解析所有 IP
2. 对每个 IP：`net.ParseIP(ip)` 后检查是否落在以下范围：
   - `127.0.0.0/8`（loopback IPv4）
   - `::1`（loopback IPv6）
   - `10.0.0.0/8`（RFC1918）
   - `172.16.0.0/12`（RFC1918）
   - `192.168.0.0/16`（RFC1918）
   - `169.254.0.0/16`（link-local）
   - `fc00::/7`（IPv6 ULA）
3. 任意一个 IP 命中则返回 `true`

调用位置：`MetaHandler` L37 之后，发起 `client.Do(req)` 之前：
```go
if private, err := isPrivateHost(parsed.Hostname()); err != nil || private {
    http.Error(w, "forbidden url", http.StatusBadRequest)
    return
}
```

**注意**：`net.LookupHost` 会阻塞（DNS 查询），应使用带超时的 context，或在 handler 的 `client` 超时内覆盖（当前已有 8s 超时）。推荐新建带 3s 超时的 context 用于 DNS 解析。

**影响文件/函数清单**

| 文件 | 变更 |
|------|------|
| `server/internal/handler/meta_handler.go` | 新增 `isPrivateHost(hostname string) (bool, error)` 函数；`MetaHandler` 插入调用 |

**实现复杂度**：S（纯函数，标准库 `net` 即可，无外部依赖）

---

### I-014 — handler 错误码不区分 404/500

**问题描述**  
`database_handler.go` L37–39 和 `page_handler.go` L51–53 的 `Get` handler 对所有 repository 错误统一返回 404，暴露内部错误字符串。

**唯一解说明**

统一错误处理模式：
```go
if errors.Is(err, sql.ErrNoRows) {
    writeError(w, http.StatusNotFound, "database not found")
    return
}
log.Printf("[handler] GetDatabase: %v", err)
writeError(w, http.StatusInternalServerError, "internal server error")
```

对比现有 `GetRow`（L169–173）和 `PatchRow`（L190–194）已正确实现此模式，本次只需对 `Get` handler 补齐。

`page_handler.go` 的 `Get` 同理。

**影响文件/函数清单**

| 文件 | 变更位置 | 变更内容 |
|------|---------|---------|
| `server/internal/handler/database_handler.go` | `Get` L37–39 | 区分 `sql.ErrNoRows` vs 其他错误；日志记录非 404 错误 |
| `server/internal/handler/page_handler.go` | `Get` L51–53 | 同上 |

**实现复杂度**：S（局部改动，2 处，模式已有参考）

---

### I-015 — backup 并发竞态

**问题描述**  
`RecordWrite`（`backup.go` L36–42）中，两次并发调用可能同时将计数器归零并各自启动 `go triggerAsync()`，导致两个备份 goroutine 并发写相同文件名的 `.tmp`，race 条件下互相覆盖。

**方案对比**

| 方案 | 描述 | 优缺点 | 推荐 |
|------|------|--------|------|
| **A：`atomic.Bool` running 标志（CAS）** | 在 `triggerAsync` 入口用 `running.CompareAndSwap(false, true)` 设置；退出时 `running.Store(false)` | 简单直接；若 backup 失败仍能在下次触发时重试 | ✅ 推荐 |
| B：带缓冲 channel（容量 1）作为 token | `trigger chan struct{}` 容量 1；`RecordWrite` 发送非阻塞（select + default 丢弃）；单独 goroutine 消费 | 可防积压；但需要后台消费 goroutine，增加生命周期管理复杂度 | 次选 |

**推荐方案 A 详细设计**

在 `Manager` 结构体新增字段：
```go
running atomic.Bool
```

`triggerAsync` 修改为：
```go
func (m *Manager) triggerAsync() {
    if !m.running.CompareAndSwap(false, true) {
        return  // 已有备份进行中，跳过
    }
    defer m.running.Store(false)
    if err := Backup(m.dbPath, m.backupsDir()); err != nil {
        log.Printf("[backup] async backup failed: %v", err)
    }
}
```

`RecordWrite` 无需改动（竞态窗口在 `triggerAsync` 入口已被 CAS 消除）。

**关于文件名冲突**：方案 A 在 CAS 保护下最多只有一个 `triggerAsync` 并发运行，不再产生同名文件。若仍需防御性处理，可在 `Backup` 内追加纳秒精度时间戳（`time.Now().Format("2006-01-02T15-04-05.000000000")`），但在方案 A 下不是必须的。

**影响文件/函数清单**

| 文件 | 变更 |
|------|------|
| `server/internal/backup/backup.go` | `Manager` 新增 `running atomic.Bool` 字段；`triggerAsync` 入口添加 CAS 检查 |

**实现复杂度**：S（2-3 行改动，标准库 `sync/atomic` 已导入）

---

### I-021 — sort_filter.go 默认全通行为

**问题描述**  
`matchFilter` L44–46 的 `default case` 返回 `true`，对未知操作符默认放行所有行。`applySort` 中 `!less`（L62）对 desc 语义表达不直观。

**唯一解说明**

两处独立修复：

**修复 1：`matchFilter` default case**  
将：
```go
default:
    return true
```
改为：
```go
default:
    log.Printf("[sort_filter] unknown filter operator: %q", op)
    return false
```

**修复 2：`applySort` 降序逻辑**  
将：
```go
if order == "desc" {
    return !less
}
return less
```
改为：
```go
if order == "desc" {
    if aerr == nil && berr == nil {
        return af > bf
    }
    return strings.ToLower(a) > strings.ToLower(b)
}
return less
```

注意：需要将 `af`, `bf`, `aerr`, `berr`, `a`, `b` 提升到 `if order == "desc"` 之前的作用域（当前已在同 closure 内，无作用域问题）。

**影响文件/函数清单**

| 文件 | 变更 |
|------|------|
| `server/internal/handler/sort_filter.go` | `matchFilter` L44–46；`applySort` L61–64 |

**实现复杂度**：S（纯逻辑修改，4 行以内）

---

## 3. API 接口变更

### 新增接口：GET /api/databases

**背景**：前端 `loadAvailableDatabases`（`DatabaseView.tsx` L617）当前通过三层嵌套请求枚举所有数据库，O(pages × blocks_per_page) 复杂度。后端提供此接口后，前端一次请求即可获取全部数据库列表。

**路由注册**（`server/cmd/main.go`）

在 `/api/databases` 路由组顶部增加：
```go
r.Route("/databases", func(r chi.Router) {
    r.Get("/", dh.ListAll)   // ← 新增
    // ...现有路由保持不变
})
```

**handler 函数签名**

```go
// server/internal/handler/database_handler.go
func (h *DatabaseHandler) ListAll(w http.ResponseWriter, r *http.Request)
```

实现逻辑：调用 `h.db.ListAll(ctx)`，结果为空时返回 `[]`（非 `null`），返回 200。

**repository 接口新增方法**（`server/internal/repository/repository.go`）

```go
type DatabaseRepository interface {
    // ...现有方法
    ListAll(ctx context.Context) ([]*model.DatabaseSummary, error)   // 新增
}
```

**新增 model 类型**（`server/internal/model/model.go`）

```go
// DatabaseSummary 供 ListAll 使用，不含列/行数据，减少传输量。
type DatabaseSummary struct {
    ID     string `json:"id"`
    Name   string `json:"name"`
    PageID string `json:"page_id"`
}
```

注意：使用 `DatabaseSummary` 而非完整 `Database`，避免为每个数据库加载 columns，保持接口轻量。

**repository 层实现**（`server/internal/repository/sqlite/database_repo.go`）

```go
func (r *DatabaseRepo) ListAll(ctx context.Context) ([]*model.DatabaseSummary, error)
```

SQL：
```sql
SELECT id, title, page_id FROM databases ORDER BY created_at
```

**响应格式**

```json
{
  "databases": [
    { "id": "uuid", "name": "My Table", "page_id": "uuid" }
  ]
}
```

或直接返回数组（与现有接口风格保持一致，推荐与前端架构师确认）。现有接口如 `GET /api/pages/` 返回裸数组，建议统一：

```json
[
  { "id": "uuid", "name": "My Table", "page_id": "uuid" }
]
```

### 其他接口变更

**`GET /api/databases/{id}/rows`**：现有接口已支持 filter/sort query params，本轮 I-005 修复后操作符集合固化（见第 4 节），接口路径和参数名无需变更。

---

## 4. 与前端对齐的 filter/sort 契约（I-005 AR-3）

### 4.1 Query Params 规范

适用于：`GET /api/databases/{id}/rows`

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `sort_col` | `string` | 否 | 排序列 ID（`DBColumn.id`）。不传则按 `order_index` 自然序 |
| `sort_order` | `"asc" \| "desc"` | 否 | 排序方向，缺省值 `"asc"` |
| `filter_col` | `string` | 否 | 过滤列 ID |
| `filter_op` | `string` | 否（`filter_col` 存在时必填）| 操作符（见下表） |
| `filter_val` | `string` | 否 | 过滤值（`is_empty`/`is_not_empty` 时忽略） |

### 4.2 支持的操作符集合（标准列表）

后端为权威实现，以下为固化后的完整操作符集合：

| 操作符 | 适用类型 | 描述 |
|--------|----------|------|
| `contains` | text | 包含（大小写不敏感） |
| `not_contains` | text | 不包含（大小写不敏感） |
| `equals` | text, number | 精确匹配 |
| `not_equals` | text, number | 不匹配 |
| `is_empty` | all | 值为空字符串 |
| `is_not_empty` | all | 值非空 |
| `gt` | number | 数值大于（非数字时忽略，返回 false） |
| `lt` | number | 数值小于（非数字时忽略，返回 false） |

未知操作符：返回 `false`（I-021 修复后行为），不泄漏警告信息到客户端（仅服务端日志）。

### 4.3 后端为权威实现说明

- **后端权威**：所有 filter/sort 语义由后端定义和执行。前端通过 query params 表达意图。
- **前端应删除的重复逻辑范围**：`DatabaseView.tsx` L876–909 中的 `applyFilter` 和 `activeSorts` 本地计算逻辑（即 `filteredRows` 和 `sortedRows` 的客户端计算）。
- **前端保留职责**：UI 状态管理（当前选中的 filter/sort 配置），在用户操作时拼装 query params 发起请求。
- **即时响应**：若需要输入过程中的即时过滤（无 API 延迟），可在前端做轻量的乐观本地过滤，后台同步 API 结果后覆盖。本轮不要求实现此优化。

### 4.4 大小写敏感性约定

- `contains` / `not_contains`：大小写不敏感（后端已 `strings.ToLower`）
- `equals` / `not_equals`：大小写敏感（精确匹配）
- `gt` / `lt`：仅对可解析为 float64 的值生效，字符串比较不适用

---

## 5. ParseSortFilter 提取设计

### 5.1 函数签名

新增文件或扩展 `sort_filter.go`：

```go
// ParseSortFilter 从 HTTP 请求的 URL query 参数中解析排序和过滤参数。
// 返回值均为空字符串表示未传。
func ParseSortFilter(r *http.Request) (sortCol, sortOrder, filterCol, filterOp, filterVal string) {
    q := r.URL.Query()
    sortCol = q.Get("sort_col")
    sortOrder = q.Get("sort_order")
    filterCol = q.Get("filter_col")
    filterOp = q.Get("filter_op")
    filterVal = q.Get("filter_val")
    return
}
```

位置：`server/internal/handler/sort_filter.go`（追加到文件末尾）

### 5.2 调用方变更

`database_handler.go` `ListRows` L147–158：

```go
// 当前（5 行散落逻辑）
q := r.URL.Query()
sortCol := q.Get("sort_col")
sortOrder := q.Get("sort_order")
filterCol := q.Get("filter_col")
filterOp := q.Get("filter_op")
filterVal := q.Get("filter_val")

// 替换为
sortCol, sortOrder, filterCol, filterOp, filterVal := ParseSortFilter(r)
```

如未来其他 handler（如 `ListRows` 的分页扩展、或新的批量查询接口）也需要 filter/sort 参数，直接复用此 helper。

---

## 6. 实现任务拆分建议

### P0 先行（阻塞性能，须优先交付）

**T-001：I-004 ListRows N+1 修复**
- 文件：`database_repo.go`
- 新增 `batchFetchAllCells(ctx, rowIDs []string) (map[string]map[string]string, error)`
- 重构 `ListRows` 中 L191–214 的 per-row cell 查询循环
- 验收：100 行数据下 SQL 查询次数 = 2（1 次行查询 + 1 次 cell 批量查询）
- 工作量：**0.5 天**

---

### P1 次之（安全、正确性，应在近期 sprint 交付）

**T-002：I-010 MetaHandler SSRF 修复**
- 文件：`meta_handler.go`
- 新增 `isPrivateHost(hostname string) (bool, error)`，覆盖 RFC1918 + loopback + link-local
- `MetaHandler` 插入调用，非法 IP 返回 400
- 单元测试：覆盖 `127.0.0.1`、`10.0.0.1`、`192.168.1.1`、`172.16.0.1`、`169.254.0.1` 均返回 true；`8.8.8.8`、`1.1.1.1` 返回 false
- 工作量：**0.5 天**

**T-003：I-014 handler 错误码 404/500 区分**
- 文件：`database_handler.go`（`Get`）、`page_handler.go`（`Get`）
- 参考现有 `GetRow`/`PatchRow` 模式
- 工作量：**0.25 天**

**T-004：I-015 backup 并发竞态修复**
- 文件：`backup.go`
- 新增 `running atomic.Bool` 字段
- `triggerAsync` 入口 CAS 检查
- 工作量：**0.25 天**

**T-005：I-005 ParseSortFilter helper 提取**
- 文件：`sort_filter.go`（新增函数）、`database_handler.go`（替换调用）
- 工作量：**0.25 天**

**T-006：新增 GET /api/databases 接口**
- 文件：`repository.go`（接口扩展）、`database_repo.go`（实现）、`database_handler.go`（handler）、`main.go`（路由注册）、`model.go`（新增 `DatabaseSummary`）
- 工作量：**0.5 天**

---

### P2 最后（代码质量，可在条件允许时处理）

**T-007：I-021 sort_filter.go 默认全通 + !less 修正**
- 文件：`sort_filter.go`
- `matchFilter` default 改为 false + warn log
- `applySort` 降序逻辑改为显式 `>`
- 工作量：**0.25 天**

---

### 任务依赖关系

```
T-001（I-004）    独立
T-002（I-010）    独立
T-003（I-014）    独立
T-004（I-015）    独立
T-005（I-005）    独立
T-006（新接口）   依赖 T-005 完成后一起做（sort_filter helper 可被新接口复用）
T-007（I-021）    独立，但建议在 T-005 之后做（同文件）
```

### 总估算工作量

| 优先级 | 任务 | 工作量 |
|--------|------|--------|
| P0 | T-001 | 0.5 天 |
| P1 | T-002 + T-003 + T-004 + T-005 + T-006 | 1.75 天 |
| P2 | T-007 | 0.25 天 |
| **合计** | | **2.5 天** |

---

*方案由后端架构师（arch-backend）于 2026-05-02 产出，对应 dispatch #40 / REQ-065。本文档仅为方案规划，不含任何实现代码，不修改现有源文件。*
