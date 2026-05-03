# REQ-055 + REQ-056 架构评审：关联列 / 汇总列

| 字段 | 内容 |
|------|------|
| 评审 ID | ARCH-REV-055-056 |
| 版本 | v1.0 |
| 日期 | 2026-05-03 |
| 评审人 | 总架构师 |
| 被评审需求 | REQ-055（关联列）、REQ-056（汇总列） |
| 评审结论 | **通过（附条件）** — 现有实现与需求高度一致，已实现占比约 90%；条件见"未闭合项" |

---

## 评审背景

本次评审基于对以下文件的全量阅读：

- `docs/requirements/features/REQ-055.md`、`REQ-056.md`
- `server/internal/model/model.go`
- `server/internal/repository/repository.go`
- `server/internal/repository/sqlite/database_repo.go`
- `server/internal/repository/sqlite/rollup_test.go`
- `server/internal/handler/database_handler.go`
- `server/cmd/main.go`
- `web/src/types/index.ts`
- `web/src/api/client.ts`
- `web/src/components/database/DatabaseView.tsx`
- `web/src/components/database/RelationCell.tsx`
- `web/src/components/database/RollupConfigPopover.tsx`

---

## 1. 技术方案 — 关联列（REQ-055）

### 1.1 数据模型

**列类型注册**

`DBColumn.type` 已在 `web/src/types/index.ts` 中加入 `"relation"` 枚举值；
`DatabaseView.tsx` 的 `COL_TYPES`、`COL_ICONS`、`COL_TYPE_LABELS` 均已注册。

**列配置存储**

`DBColumn.options`（`database_columns.options` 列，TEXT 类型）存储 `RelationColumnOptions` 的 JSON 序列化：

```typescript
interface RelationColumnOptions {
  target_database_id: string;
  display_column_id?: string;  // 默认第一列，可选
}
```

此方案复用 `select` 类型已有的 `options` 字段，无需数据库 DDL 变更，已实现且正确。

**单元格值格式**

`database_cells.value` 存储 `JSON.stringify(string[])` — 目标数据库行 ID 数组。
空值为 `"[]"` 或 `""`，读取时统一降级为空数组。`RelationCell.tsx` 的 `parseIds()` 函数已实现 try/catch 降级，符合 REQ-055 场景 12（JSON 损坏）。

**架构确认**：`relation` 类型列不需要新数据库表，数据完全存储在现有 `database_columns.options` + `database_cells.value` 中，无跨数据库 JOIN。

### 1.2 后端接口

| 方法 | 路径 | 状态 |
|------|------|------|
| `GET` | `/api/databases/:id/rows` | 已有，关联选择器复用 |
| `GET` | `/api/databases/:id/rows/:row_id` | **已实现** — `database_handler.go` `GetRow` + `database_repo.go` `GetRow` + `main.go` 路由注册 |

`GetRow` 实现要点（已验证）：
- 按 `database_id` + `row_id` 双条件查询（防跨库 ID 泄露）
- 读取该行所有 cells 并注入 `formula` 列计算值
- 行不存在时返回 404

REQ-055 需求的所有后端接口**均已实现**，无遗漏。

### 1.3 前端实现评估

**RelationCell.tsx**（已实现，完整度高）：

| 功能点 | 实现状态 | 说明 |
|--------|---------|------|
| 标签展示（已选行主列文案） | 已实现 | `rowLabel()` 取第一个 cell 值 |
| 目标行批量缓存 | 已实现 | `targetRowsCache` prop + `resolvedRows` Map |
| 选择器弹窗（搜索 + 多选） | 已实现 | 搜索过滤、✓ 标记 |
| 删除单个标签 | 已实现 | `removeId()` |
| 目标行被删除显示「已删除」 | 已实现 | `rowLabel()` 返回 `"已删除"` |
| JSON 损坏降级 | 已实现 | `parseIds()` try/catch |
| 「新建并关联」 | **超出 REQ-055 范围**（加分项）| 搜索无结果时自动创建目标行 |
| 分页/虚拟滚动（场景 11：>50 行） | **未实现** | 当前一次性加载全部行，200 行场景有卡顿风险 |

**DatabaseView.tsx 集成**（已实现）：
- `COL_TYPES`、`COL_ICONS`、`COL_TYPE_LABELS` 中 `"relation"` 已注册
- 新增列弹窗中 relation 类型展示目标数据库选择器
- 单元格渲染引用 `<RelationCell>`
- `READONLY_COL_TYPES` 中**未**包含 `"relation"`（正确——relation 列可编辑）

---

## 2. 技术方案 — 汇总列（REQ-056）

### 2.1 计算位置决策

**结论：后端 `ListRows` 时实时计算（已实现，方案正确）**

理由：
1. 汇总值依赖关联列的单元格数据（目标行 cells），前端在 `ListRows` 时才持有完整数据，如在前端计算需额外维护跨数据库的目标行缓存，状态复杂度高。
2. 与 `formula` 列保持一致的派生列模式：后端计算后注入 `row.Cells[colId]`，前端只读渲染，不写入 `database_cells`。
3. SQLite 单机场景无并发竞争，实时计算性能可接受；当前批量优化已消除 N+1。
4. 前端实时计算方案的问题：需要额外 `getRow` 调用（关联行数据）、关联更新后前端缓存失效逻辑复杂。

### 2.2 支持的聚合函数

7 种聚合函数已全部实现：

| 函数 | Go 实现 | 行为 |
|------|---------|------|
| `count` | `len(relatedIDs)` | 计数含空值的全部行 |
| `count_not_empty` | 过滤 cell 非空 | 只计非空目标值 |
| `sum` | 非法值按 0 | 数字求和，整数去小数点 |
| `avg` | 保留 2 位小数 | 非法值按 0，除数为关联行数 |
| `max` / `min` | `math.Inf` 初始值 | 空关联返回 `""` |
| `show_original` | `strings.Join` | 逗号拼接，保持 relatedIDs 顺序 |

`computeRollup` 函数位于 `database_repo.go`，单元测试覆盖所有函数及边界场景（rollup_test.go，共 20+ 个测试用例）。

### 2.3 数据模型

**列类型**：`"rollup"` 已在 `web/src/types/index.ts` 中注册。

**列配置**：`DBColumn.options` 存储 `RollupColumnOptions` JSON：

```typescript
interface RollupColumnOptions {
  relation_column_id: string;
  target_column_id: string;
  aggregation: RollupAggregation;
}
```

**单元格**：不写入 `database_cells`，在 `ListRows` 时注入 `row.Cells[colId]`，与 formula 列处理方式完全一致。

### 2.4 后端计算逻辑（已实现）

`database_repo.go` `ListRows` 中 rollup 计算段关键流程：

1. 解析 `col.Options` → `relation_column_id + target_column_id + aggregation`；options 损坏时 `continue`（跳过该列，不中断整体查询）
2. 检查关联列是否在 `colByID` 中存在；不存在时将该列所有行置空
3. 遍历全部行，收集所有 relatedIDs → 去重 → 一次性 `batchFetchCells` 批量查询（消除 N+1）
4. 对每行调用 `computeRollup` 注入结果

**批量优化确认**：`batchFetchCells` 使用 SQL `IN (?,?,...)` 一次性查询，不存在 N+1 问题。

### 2.5 是否需要新 API

**不需要新接口**。汇总值在 `GET /api/databases/:id/rows` 响应中随 `row.cells` 一同返回，前端只读渲染即可。`RollupConfigPopover.tsx` 配置保存时调用现有的 `updateColumn` 接口。

### 2.6 前端实现评估

**RollupConfigPopover.tsx**（已实现）：

| 功能点 | 状态 |
|--------|------|
| 关联列下拉（过滤 type=relation） | 已实现 |
| 目标属性下拉（读取目标数据库列） | 已实现，`api.databases.get(targetDbId)` 获取 |
| 聚合函数下拉（7 种） | 已实现 |
| 保存调用 `updateColumn` | 已实现 |
| 关联列为空时提示 | 已实现 |

**DatabaseView.tsx 集成**：
- `"rollup"` 在 `COL_TYPES`、`COL_ICONS`（Sigma 图标）、`COL_TYPE_LABELS` 已注册
- `READONLY_COL_TYPES` 已包含 `"rollup"`
- 汇总列单元格只读渲染

---

## 3. 任务拆分表

> 说明：经评审，REQ-055 和 REQ-056 的核心实现（约 90%）已存在于代码库中。以下任务为**补全项**和**验证项**，不是从零实现。

## 任务拆分

| 任务 | 角色 | 涉及文件 | 验收条件 |
|------|------|---------|---------|
| T1 关联选择器分页 | 前端工程师 | `web/src/components/database/RelationCell.tsx` | 目标数据库行数 > 50 时，选择器分批加载（虚拟滚动或分页），200 行场景不卡顿；REQ-055 场景 11 通过 |
| T2 关联列目标数据库删除提示 | 前端工程师 | `web/src/components/database/DatabaseView.tsx`、`RelationCell.tsx` | 目标数据库已删除时，关联列 header 标注「目标已删除」，单元格显示空；REQ-055 场景 13 通过 |
| T3 汇总列目标列/关联列删除提示 | 前端工程师 | `web/src/components/database/RollupConfigPopover.tsx`、`DatabaseView.tsx` | 关联列或目标属性列被删除后，汇总列 header/单元格标注「关联列已删除」或「目标属性已删除」；REQ-056 场景 11、12 通过 |
| T4 GetRow 不计算 rollup | 后端工程师 | `server/internal/repository/sqlite/database_repo.go` | `GetRow` 方法当前不计算 rollup 列（只计算 formula），行详情弹窗打开时 rollup 值为空；修复：在 `GetRow` 中补充 rollup 计算段，与 `ListRows` 保持一致 |
| T5 前端 E2E 验证 REQ-055 全场景矩阵 | 前端测试 | — | REQ-055 场景 1–13 全部通过（含 T1 分页、T2 删除提示） |
| T6 前端 E2E 验证 REQ-056 全场景矩阵 | 前端测试 | — | REQ-056 场景 1–13 全部通过（含 T3 删除提示） |
| T7 后端测试补充 GetRow rollup | 后端测试 | `server/internal/repository/sqlite/database_handler_test.go` | T4 修复后补充 `GetRow` 的 rollup 计算集成测试 |

---

## 4. 回归影响分析

### 4.1 现有关联列前端（已有实现）

`RelationCell.tsx` 是独立组件，通过 `DatabaseView.tsx` 的 `<RelationCell>` 引用挂载。改动 T1（分页）和 T2（删除提示）仅在组件内部添加逻辑，不影响其他列类型渲染。

风险等级：**低**

### 4.2 Cell API（`BatchUpdateCells`）

关联列写入与其他文本列相同，走 `PATCH /databases/:id/rows/:row_id/cells`，无特殊处理。relation 类型的值格式为 JSON 字符串，对现有接口透明。

风险等级：**无**

### 4.3 ListRows 汇总计算段

`ListRows` 新增 rollup 计算段位于 formula 计算段之后，已通过 `if col.Type != "rollup" { continue }` 过滤，不影响其他列类型。若数据库中无 rollup 列，新增代码路径零开销。

风险等级：**低**

### 4.4 数据库视图渲染（Kanban / Gallery / Calendar / Timeline / List）

这些视图读取 `rows[].cells[colId]` 并渲染。rollup 列已加入 `READONLY_COL_TYPES`，在 Kanban/Gallery 等视图中不可作为分组列（需确认各视图的 groupBy 列过滤逻辑）。relation 列的标签在非表格视图中可能渲染为原始 JSON 字符串 — 需确认 KanbanView/GalleryView 是否对 relation 类型做特殊渲染（当前评审未见实现，可接受为 P3 后续跟进）。

风险等级：**中（非表格视图中 relation 单元格渲染为 JSON 字符串的外观问题）**

### 4.5 行详情弹窗（RowModal）

`GetRow` 当前不计算 rollup（只计算 formula），导致行详情弹窗中汇总列显示空。这是 T4 需要修复的已知缺口，不是新引入的回归。

风险等级：**中（已知，T4 修复）**

### 4.6 Sort / Filter 功能

`applyFilter` 和 `applySort` 作用于 `row.cells[colId]`，relation 值为 JSON 字符串、rollup 值为计算字符串。两种列类型均不应参与排序和筛选（REQ-055/056 明确为「不在本期」）。当前代码不限制用户对 relation/rollup 列排序筛选，但排序结果为字典序字符串比较，行为不符合用户预期。

建议：在前端 sort/filter 面板中将 relation 和 rollup 列从可选列中排除（UI 层面屏蔽，不阻塞当前迭代）。

风险等级：**低（功能可用，结果不符预期，无崩溃）**

---

## 5. 技术风险

### 5.1 SQLite 跨数据库查询限制

**情况说明**：noteyard 仅使用单个 SQLite 文件（`noteyard.db`），所有数据库（Database）是逻辑隔离，共享同一物理 SQLite 文件。因此**不存在跨 SQLite 文件的 JOIN 问题**，无需 `ATTACH DATABASE`。

`batchFetchCells` 查询 `database_cells WHERE row_id IN (...) AND column_id=?`，跨逻辑数据库查询在同一物理文件中完全合法。

风险等级：**无**

### 5.2 N+1 查询问题（已解决）

rollup 计算中，`batchFetchCells` 对全量去重 rowID 一次性查询，时间复杂度为 O(1) 次 SQL 查询（不随行数增长）。`batchFetchAllCells` 同理。

确认：测试文件 `rollup_test.go` 的 `TestListRows_Rollup_*` 系列测试均通过 in-memory SQLite 验证计算正确性。

风险等级：**无**

### 5.3 循环引用检测

**关联列**：relation 列不参与循环引用（关联只是存储目标行 ID，不做计算派生）。场景 10 允许关联自身数据库，不会产生无限递归。

**rollup → relation 依赖链**：rollup 列依赖 relation 列的 cell 值，relation 列是普通存储列，不存在递归计算。不可能出现 rollup A → rollup B → rollup A 的循环（因为 rollup 是单向聚合，且 rollup 列不可作为另一个 rollup 的 `target_column_id`，因为目标列来自另一个数据库，当前没有跨数据库 rollup 的需求）。

**formula 列**：`checkFormulaLoop` 已实现 DFS 循环检测，与 relation/rollup 功能无交叉影响。

风险等级：**无**

### 5.4 大量关联行的性能问题（T1 未修复前）

当目标数据库有 200 行时，`RelationCell` 在打开选择器时调用 `api.databases.listRows(targetDbId)` 一次性加载全部行，存在前端渲染卡顿和网络负载问题。T1 任务需要实现分页（建议首次加载 50 行，搜索时服务端过滤或客户端过滤剩余结果）。

后端目前 `ListRows` 不支持 `limit/offset`，T1 实现时可先用客户端搜索截断（100 行以下无明显感知），200 行场景需要后端分页支持（可列为 P3 需求）。

风险等级：**中（场景 11 验收可能不通过）**

### 5.5 `options` 字段 JSON 的向后兼容性

relation 和 rollup 列配置均存储于 `database_columns.options`（TEXT 列）。该字段无 schema 约束，不同类型列的 options 格式完全不同，依赖应用层解析。`getOpts()`（前端）和 `json.Unmarshal` + 字段存在性检查（后端）均已实现容错，损坏时降级为空。

风险等级：**低（已有降级处理）**

---

## 6. 未闭合项（须在迭代结束前处理）

| # | 类型 | 描述 | 对应任务 |
|---|------|------|---------|
| GAP-1 | 功能缺口 | `RelationCell` 无分页/虚拟滚动，场景 11（200 行）可能卡顿 | T1 |
| GAP-2 | 功能缺口 | 目标数据库被删除时，关联列前端无「目标已删除」提示 | T2 |
| GAP-3 | 功能缺口 | rollup 列依赖的关联列/目标列被删除时，前端无标注提示 | T3 |
| GAP-4 | Bug | `GetRow`（行详情弹窗）未计算 rollup 列，汇总值为空 | T4 |
| GAP-5 | 体验 | 非表格视图（Kanban/Gallery 等）中 relation 单元格显示原始 JSON 字符串 | 后续 P3 |
| GAP-6 | 体验 | Sort/Filter 面板未屏蔽 relation/rollup 列 | 后续 P3 |

---

## 7. 总结

REQ-055（关联列）和 REQ-056（汇总列）的技术选型和数据模型设计均合理，已实现部分与需求文档高度一致：

- 数据模型（`options` 字段 JSON + `cells` JSON 数组）完全符合需求规格
- 后端所有接口（`GetRow`、`ListRows` 含 rollup 计算、`BatchUpdateCells`）均已实现并注册路由
- 前端核心组件（`RelationCell.tsx`、`RollupConfigPopover.tsx`）已实现并集成进 `DatabaseView.tsx`
- `computeRollup` 的 7 种聚合函数有完整单元测试覆盖

主要风险点：T1（选择器分页）和 T4（`GetRow` rollup 补全）是必须修复的功能缺口，T2/T3 为用户体验保障项。四项任务完成后可进入 QA 全场景验收。
