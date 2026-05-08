# ISS-026 架构评审 — Table View 行拖拽排序

| 字段 | 内容 |
|------|------|
| 评审角色 | 总架构师（arch） |
| Dispatch | #157 |
| 上级 | dev-lead |
| 完成时间 | 2026-05-04 |
| 关联 ISS | ISS-026 |

---

## 一、需求摘要

Table View 目前无行拖拽排序功能，KanbanView 已有完整的 `@dnd-kit` 实现可复用。需在 Table View 的 `<tbody>` 中集成拖排序，`onDragEnd` 本地 `arrayMove` 重排后通过 PATCH 接口持久化到 `database_rows.order_index` 字段。

---

## 二、模块影响分析

| 模块/文件 | 变更类型 | 说明 |
|-----------|---------|------|
| `web/src/components/database/DatabaseView.tsx` | 修改 | Table View `<tbody>` 区域新增 DndContext + SortableContext；每行新增 useSortable + GripVertical 手柄 |
| `web/src/api/client.ts` | 修改 | 新增 `reorderRows` API 方法，调用后端新接口 |
| `server/internal/handler/database_handler.go` | 修改 | 新增 `ReorderRows` handler（POST `/api/databases/{id}/rows/reorder`） |
| `server/internal/repository/repository.go` | 修改 | DatabaseRepository 接口新增 `ReorderRows` 方法 |
| `server/internal/repository/sqlite/database_repo.go` | 修改 | 实现 `ReorderRows`：批量 UPDATE database_rows SET order_index=? WHERE id=? |
| `server/cmd/main.go` | 修改 | 注册新路由 POST `/api/databases/{id}/rows/reorder` |

**模块边界判断**：
- 前端变更在 `DatabaseView.tsx` 内（现有 Table View 渲染区域），边界安全
- 后端新增接口不修改现有接口语义，UpdateRow 仍保留（用于 content 更新），新增 ReorderRows 仅更新 order_index，边界清晰
- `database_rows.order_index` 字段已存在（002_database.sql），索引 `idx_db_rows_database` 覆盖 `(database_id, order_index)`，**无需数据库迁移**

---

## 三、后端方案

### 现状确认

`database_rows.order_index REAL NOT NULL DEFAULT 0` 已存在，`ListRows` 按 `ORDER BY order_index` 返回。`UpdateRow` 仅 UPDATE `content`，不含 `order_index`。`DBRow.OrderIndex float64` 已在 model 中。

### 方案选择

**方案 A（推荐）：新增批量重排接口 POST `/rows/reorder`**

```
POST /api/databases/{id}/rows/reorder
Body: { "order": ["row-id-1", "row-id-2", "row-id-3"] }
```

按前端传来的 id 数组，将 order_index 设为 `0, 1, 2...`（整数步进，不用浮点分数），一次事务内批量 UPDATE。

优点：语义明确，单次网络请求，前端无需知道 order_index 具体值
缺点：每次拖拽需传全量行 id（行数通常 <1000，可接受）

**方案 B：修改 PatchRow 支持 order_index 字段**

复用现有 PATCH `/rows/{row_id}`，让 body 包含 `order_index` 字段，每次拖拽对每行发一次 PATCH。

优点：无新接口
缺点：N 行 → N 次 HTTP 请求，且并发写入存在竞态风险；与 content 更新混用语义不清

**推荐：方案 A**。方案 B 的 N 次请求会在行数多时造成明显网络开销，且竞态风险更高。方案 A 单次事务保证原子性，语义清晰。

**长期来看**：方案 A 也更优。若未来支持多列排序或分页，批量接口更容易扩展；方案 B 的 per-row PATCH 路径会与业务字段混合，增加维护难度。

### 接口契约

```
POST /api/databases/{id}/rows/reorder
Content-Type: application/json

Request:
{
  "order": ["uuid-1", "uuid-2", "uuid-3"]  // 完整行 id 数组，按新顺序排列
}

Response 200: {} (空对象)
Response 400: {"error": "invalid order"}
Response 500: {"error": "internal error"}
```

ReorderRows repository 方法：

```go
ReorderRows(ctx context.Context, dbID string, rowIDs []string) error
// 事务内批量 UPDATE database_rows SET order_index=i WHERE id=rowIDs[i] AND database_id=dbID
```

---

## 四、前端方案

### 现状确认

`KanbanView.tsx` 已有完整 `@dnd-kit` 模式：`DndContext` + `SortableContext(verticalListSortingStrategy)` + `useSortable`。`@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities` 已安装。`DatabaseView.tsx` Table View 内无任何拖拽逻辑。

### 方案

在 Table View 的渲染区域（`<tbody>` 及其父层）外包裹 `DndContext`，每行用 `useSortable`，手柄用 `GripVertical` 图标。

**DndContext 包裹位置**：在 Table View 的 `<tbody>` 上方（与 `<table>` 平级或包裹整个 Table View 渲染分支）。`DndContext` 不应包裹 GroupBy/KanbanView 等其他视图分支，避免事件冒泡干扰。

**每行 useSortable 使用**：
- 每个 `<tr>` 使用 `useSortable({ id: row.id })`，将 `transform/transition` 作为 inline style，`setNodeRef` 绑定 `<tr>` 的 ref
- 拖拽手柄：最左列新增一个 `<td>` 包含 `<GripVertical>` 图标，`{...listeners}` 绑定到手柄元素（不绑定整行，避免干扰单元格点击）

**onDragEnd 逻辑**：
```
onDragEnd(event):
  if !event.over || event.active.id === event.over.id: return
  const oldIndex = rows.findIndex(r => r.id === active.id)
  const newIndex = rows.findIndex(r => r.id === over.id)
  const newRows = arrayMove(rows, oldIndex, newIndex)
  setRows(newRows)   // 乐观更新本地状态
  api.databases.reorderRows(db.id, newRows.map(r => r.id))  // 异步持久化，失败回滚
```

失败回滚：PATCH 失败时 toast 提示 + 恢复原始 rows 顺序。

### 分组视图（groupByColId 非空）处理规则

**结论：分组模式下禁用行拖排序。**

原因：分组模式下行按 groupByColId 的值聚合显示，跨分组的行相对顺序没有业务意义（同组内排序由分组值决定，不由 order_index 决定）。KanbanView 的行移动是改变分组值（onMoveRow），而非改变全局 order_index。若在分组模式 Table View 允许拖排序，持久化后重排会破坏分组内的稳定顺序，且与 sort_col（主动排序）冲突。

实现：当 `groupByColId !== ""` 时，不渲染 DndContext/SortableContext，`<tr>` 不调用 useSortable，手柄列隐藏或显示为 disabled 状态。

**与 sort_col 的交互**：当 `sortCol !== ""` 时（主动排序激活），行拖排序应同样禁用，因为主动排序会覆盖 order_index 顺序。禁用条件：`groupByColId !== "" || sortCol !== ""`。

---

## 五、状态管理设计

| 状态 | 类型 | 归属 | 说明 |
|------|------|------|------|
| `rows`（现有） | `DBRow[]` | DatabaseView | 拖排序后通过 setRows 乐观更新顺序 |
| `activeRowId` | `string \| null` | Table View 内（新增） | DragOverlay 用，显示被拖行 |

不引入新的全局状态，`rows` 的 setRows 已在 DatabaseView 内维护。

---

## 六、数据流设计

```
用户拖动行手柄（GripVertical）
  │
  ▼
useSortable listeners 触发，DndContext 计算位置
  │
  ▼
onDragEnd：arrayMove(rows, oldIndex, newIndex)
  │
  ├─ setRows(newRows)  → 本地立即重排（乐观更新）
  │
  └─ api.databases.reorderRows(dbId, newRows.map(r => r.id))
       │
       ├─ 成功 → 无操作（server 已持久化）
       └─ 失败 → setRows(原始 rows) + toast.error("排序保存失败")
```

---

## 七、可复用组件识别

`KanbanView.tsx` 的 dnd-kit 模式（sensors、DndContext、SortableContext、useSortable）可作为参考实现，但不提取为共享组件（两者场景差异较大：Kanban 是跨列移动，Table 是同列上下排序）。无需提取新公共逻辑。

---

## 八、模块列表

本次涉及以下模块（后续所有角色按此命名产出摘要文件）：

| 模块名称 | 模块描述 | 摘要文件 |
|---------|---------|---------|
| frontend | 前端 Table View dnd-kit 集成、API 调用 | arch-frontend.md / eng-frontend.md |
| backend | 后端 ReorderRows 接口与 repository 实现 | arch-backend.md / eng-backend.md |

---

## 九、回归影响分析

| 回归点 | 受影响模块 | 回归优先级 |
|--------|----------|-----------|
| Table View 行拖拽排序（主功能） | frontend | P1 |
| Table View 行顺序持久化（刷新后保持） | frontend + backend | P1 |
| Table View 分组模式下手柄隐藏/禁用 | frontend | P2 |
| Table View 主动排序（sort_col）激活时手柄禁用 | frontend | P2 |
| KanbanView 拖拽（不应受影响，独立 DndContext） | frontend | P2 |
| 现有 PATCH `/rows/{id}` 接口（不应受影响） | backend | P2 |
| ListRows 返回顺序（ORDER BY order_index，不应受影响） | backend | P2 |

---

## 十、任务拆分表

| # | 角色 | 任务 | 交付物 | 依赖 |
|---|------|------|--------|------|
| T1 | 后端工程师 | 新增 `ReorderRows` repository 方法 + `ReorderRows` handler + 路由注册 `POST /api/databases/{id}/rows/reorder` | 代码变更 + commit + make check 通过 | 无 |
| T2 | 前端工程师 | DatabaseView.tsx Table View 集成 dnd-kit（DndContext + SortableContext + useSortable + GripVertical 手柄）；onDragEnd 乐观更新 + 调用 reorderRows API；分组/排序激活时禁用；api/client.ts 新增 reorderRows | 代码变更 + commit + make check 通过 | T1（需 reorderRows API 路由存在） |
| T3 | 测试执行者 | 回归验证：行拖排序正常/持久化/分组禁用/排序禁用/KanbanView 不受影响 | 测试报告 | T1, T2 |

---

## N2 — 架构评审完成（ISS-026，自动通过）

后端 order_index 字段已就绪，无需迁移。方案清晰，风险低。N2 自动通过，研发负责人按拆分表委派 T1（后端）和 T2（前端）实现，T1 完成后 T2 可并行不阻塞（后端先提交 + make check，前端再集成 API 调用）。
