# TD-001 — Columns Block 架构迁移评审

**评审人**：总架构师  
**日期**：2026-05-03  
**状态**：已完成

---

## 1. 现状分析

### 1.1 当前实现的核心文件

| 文件 | 作用 |
|------|------|
| `web/src/components/editor/Editor.tsx` | schema 注册（`withMultiColumn`）、`buildDtosRecursive`（序列化写库）、加载逻辑 |
| `web/src/utils/toBlockNote.ts` | 反序列化：DB flat rows → BlockNote 树形结构（含旧 `columns` fallback） |
| `web/src/types/blockTypes.ts` | 枚举 `COLUMN_LIST`、`COLUMN`、`COLUMNS`（旧类型保留向后兼容） |
| `web/src/types/blocknote.ts` | `BNBlock` 接口，`children?: BNBlock[]` 支持树形 |
| `server/internal/model/model.go` | `Block` 结构体：`ParentBlockID *string`，schema 层面已支持父子树 |
| `server/internal/repository/sqlite/block_repo.go` | `BatchUpdate`（UPSERT）、`ListByPage`（返回 flat 列表） |
| `server/cmd/migrate_columns/main.go` | 一次性数据迁移工具：旧 `columns`（含 `columnsData`）→ `columnList/column/子块` 新格式 |
| `server/internal/repository/sqlite/006_migrate_columns.sql` | Schema 阶段 0：备份旧 `columns` 记录到 `blocks_migration_backup` |

### 1.2 数据流（当前，含已部分迁移的状态）

```
用户在编辑器拖拽/插入分栏
         │
         ▼
BlockNote @xl-multi-column  ──→  editor.document 中产生
columnList { children: [column, column] }
每个 column.children 是普通 BNBlock[]
         │
         ▼ onChange → buildDtosRecursive()（Editor.tsx line 656）
         │
         ├─ columnList  → {id, page_id, parent_block_id=null,  type="columnList", content="{}", props="{}"}
         ├─ column[0]   → {id, page_id, parent_block_id=columnList.id, type="column",  props={"width":1}}
         ├─ inner-block → {id, page_id, parent_block_id=column[0].id, type="paragraph", content=...}
         └─ ...
         │
         ▼ POST /api/pages/:id/blocks/batch
         │
         ▼ BatchUpdate（UPSERT）→ SQLite blocks 表（flat，以 parent_block_id 建树）
         │
         ▼ GET /api/pages/:id/blocks → 返回 flat []Block
         │
         ▼ toBlockNote(blocks)：
         │  1. 找顶层块（parent_block_id 不在集合中的块）
         │  2. columnList → 递归组装 column[]，column → 递归组装 children[]
         │  3. 旧 type="columns" + columnsData → fallback 降级为空列占位结构
         ▼
         editor.replaceBlocks(...)
```

### 1.3 已知缺陷

| # | 缺陷 | 根因 | 影响范围 |
|---|------|------|---------|
| 1 | **undo/redo 断层** | 旧方案A（columnsData prop）将列内容序列化为 props JSON 字符串，整个列组是一个不透明的 BlockNote 块，列内的细粒度改动不进入 ProseMirror 历史栈 | 已通过 xl-multi-column 原生节点解决，但旧 `columns` 格式数据回显为空，用户感知丢失历史内容 |
| 2 | **旧 `columns` 数据降级为空列** | `toBlockNote.ts` 对含 `columnsData` 的旧块只能生成空占位符（内容丢失） | 已有 `migrate_columns` 工具做一次性修复，但如未执行则数据库中仍有旧格式数据 |
| 3 | **`columns` 类型残留** | `BLOCK_TYPES.COLUMNS = "columns"` 仍在 `blockTypes.ts` 中存在；`toBlockNote.ts` 有 fallback 分支 | 代码噪声；旧库如未跑迁移脚本，渲染异常 |
| 4 | **删孤块问题** | `BatchUpdate` 用 UPSERT，但不删除当前 pageId 中不再出现在 DTO 集合里的块（列被删除时 column/子块 孤立留在数据库） | 数据库中累积垃圾 column 和子块；重新加载页面时会出现幽灵列 |
| 5 | **`buildDtosRecursive` 不递归处理 column 内的嵌套结构** | 目前 `columnList` 分支只展开两层（column → inner）；若 inner 块本身有 `children`（如 toggle）则丢失 | toggle、嵌套列表等复杂块在分栏内可能序列化不完整 |
| 6 | **拖拽 overlay 是自制的视觉覆盖层** | `Editor.tsx` 中手动监听 `dragover` 画蓝色遮罩；实际合并成两列依赖 `multiColumnDropCursor`，两者可能出现状态不一致 | 视觉噪声，且与 BlockNote 内部拖拽状态有细微耦合风险 |

---

## 2. 迁移方案对比

当前代码库**实际上已经完成了向方案C（BlockNote 原生 xl-multi-column）的技术架构迁移**（schema 注册、序列化、反序列化均已就位）。以下对比回溯已走过的路径，并评估是否存在尚未完成的工作。

### 方案B：columnsData → BlockNote children 结构（columns 存为子块）

> 描述：保留自定义 `columns` 块类型，但将列内内容从 `columnsData` JSON 字符串迁移为真正的 DB 子块（`parent_block_id` 树），不依赖 xl-multi-column。

| 维度 | 评分 | 说明 |
|------|------|------|
| 实现复杂度 | 中 | 需要维护自定义 `columns/column` blockSpec；斜杠菜单、拖拽 UI 需自制 |
| undo/redo | 部分支持 | 列内块是真实 ProseMirror 节点，undo/redo 可感知；但列本身的增删仍走自定义路径 |
| 服务端改动量 | 小 | `parent_block_id` 树形结构已存在，无需新增字段 |
| 数据迁移成本 | 中 | 旧 `columnsData` 需要拆解为 DB 子块（`migrate_columns` 工具已实现此功能） |
| 长期维护 | 差 | 需要长期维护与 BlockNote 版本脱钩的自定义列逻辑；无法受益于官方 bug fix |

### 方案C：完全迁移至 BlockNote 原生 xl-multi-column columnList/column 节点（**当前已采用**）

> 描述：使用 `@blocknote/xl-multi-column` 提供的 `withMultiColumn` schema 包裹，`columnList`/`column` 是原生 ProseMirror 节点，服务端用 `parent_block_id` 树存储。

| 维度 | 评分 | 说明 |
|------|------|------|
| 实现复杂度 | 低（初始），已完成 | schema 注册 3 行代码；拖拽分栏由官方 `multiColumnDropCursor` 实现；斜杠菜单由 `getMultiColumnSlashMenuItems` 注入 |
| undo/redo | 完整支持 | 所有列内操作走同一个 ProseMirror 历史栈，undo/redo 完全感知列内变更 |
| 服务端改动量 | 零 | `parent_block_id` + `order_index` 已足够表达 columnList→column→inner 三层树；BatchUpdate 无需修改 |
| 数据迁移成本 | 中（一次性） | 旧 `columns`+`columnsData` 数据需跑 `migrate_columns` 工具；已有完整实现和回滚机制 |
| 长期维护 | 优 | 与 BlockNote 版本同步；官方 bug fix 自动受益；无需维护私有列类型 |
| 风险 | 中 | 依赖 `@blocknote/xl-multi-column` 包的稳定性；版本升级需关注 breaking change |

### 对比总结

```
方案B：可行，但维护成本高，undo/redo 仅部分支持，长期来看是技术债
方案C：已采用，架构最优，但存在几个未收尾的实现缺陷（见第1.3节缺陷4、5、6）
```

---

## 3. 推荐方案及理由

**推荐：继续完善方案C（xl-multi-column 原生节点），重点修复三个未收尾缺陷。**

理由：

1. **schema 层已完成**：`withMultiColumn(BlockNoteSchema.create(...))` 正确注册，`multiColumnDropCursor` 正确替换，`dictionary` 正确嵌套。代码库处于"架构已到位、部分细节待修"的状态。

2. **最小风险路径**：已有真实用户数据（数据库中已存在 `columnList/column` 格式的块），回退到方案B会带来新的迁移成本。

3. **最需要解决的遗留问题**：

   - **缺陷4（删孤块）**：最高优先级。`BatchUpdate` 需在事务中先删除属于该 page 且不在本次 DTO 集合中的孤立 `column/columnList` 类型块，或在前端 flush 前计算 delta 删除。
   
   - **缺陷5（buildDtosRecursive 不够深）**：`buildDtosRecursive` 中处理 column 内层时应继续递归调用自身，而非只处理两层。
   
   - **缺陷2（旧数据迁移）**：确认生产 DB 已执行 `migrate_columns`，将 `columns+columnsData` 记录清零；迁移完成后可移除 `toBlockNote.ts` 中的 `BLOCK_TYPES.COLUMNS` fallback 分支。

4. **长期**：xl-multi-column 是 BlockNote 官方扩展，undo/redo 完全支持是核心优势，不值得为维护自定义实现而放弃。

---

## 4. 任务拆分表

| # | 任务 | 角色 | 涉及文件 | 验收条件 |
|---|------|------|---------|---------|
| T1 | 修复 BatchUpdate 删孤块：flush 时删除页面内不在 DTO 集合中的孤立 column/columnList 子块 | 前端工程师 | `Editor.tsx`（buildDtos 逻辑）、`server/internal/repository/sqlite/block_repo.go`（新增 DeleteOrphans 接口） | 删列后刷新页面不再出现幽灵列；已删列不在数据库中 |
| T2 | 修复 buildDtosRecursive 递归深度：column 内层块继续调用 buildDtosRecursive 而非硬编码两层 | 前端工程师 | `Editor.tsx`（buildDtosRecursive 函数） | toggle/callout 等复杂块在列内正确序列化；保存后重新加载内容无丢失 |
| T3 | 确认并完成旧 columns 数据迁移：在测试/生产 DB 执行 migrate_columns --dry-run=false，验证零旧格式记录 | 后端工程师 / DevOps | `server/cmd/migrate_columns/main.go` | `SELECT COUNT(*) FROM blocks WHERE type='columns'` = 0 |
| T4 | 清理遗留代码：移除 toBlockNote.ts 中 BLOCK_TYPES.COLUMNS fallback 分支，移除 blockTypes.ts 中 COLUMNS 常量 | 前端工程师 | `web/src/utils/toBlockNote.ts`、`web/src/types/blockTypes.ts` | 相关测试用例（旧 columns fallback 测试）同步移除；CI 通过 |
| T5 | 移除自制拖拽 overlay（columnOverlayRef 相关逻辑） | 前端工程师 | `Editor.tsx`（columnOverlayRef useEffect，约第 795-888 行） | 拖拽行为视觉与 multiColumnDropCursor 一致；无重复遮罩 |
| T6 | 补充 column 内层复杂块序列化的集成测试 | 测试工程师 | `web/src/utils/toBlockNote.test.ts` | toggle、callout 在 columnList 内序列化/反序列化往返无丢失 |

---

## 5. 回归影响分析

### 5.1 现有列内容

- **新格式数据（columnList/column/子块）**：完全兼容，`toBlockNote` 树形重建路径已覆盖并有完整测试。
- **旧格式数据（columns+columnsData）**：当前 `toBlockNote` 有 fallback，渲染为空占位列（内容不显示）。执行 `migrate_columns` 工具后全量转换，fallback 分支可删除。
- **影响范围**：T3 迁移执行时间窗口内（秒级），旧格式页面会短暂展示空列；建议在低峰期执行并提前备份。

### 5.2 服务端序列化

- **BlockRepo**：当前 `BatchUpdate` 是纯 UPSERT，无删除语义。T1 修复后需在同一事务中执行 `DELETE FROM blocks WHERE page_id=? AND id NOT IN (...)` 以清理孤立子块。需注意：DELETE 需要递归（级联 ON DELETE CASCADE 已在 DDL 中配置，删除 column 会级联删除 column 内所有子块）。
- **ListByPage**：返回 flat 列表，`toBlockNote` 负责重建树。此路径无需改动。
- **API 层**：无需改动，`/api/pages/:id/blocks` 和 `/api/pages/:id/blocks/batch` 接口语义不变。

### 5.3 已有数据库中的 columns 数据

- **blocks_migration_backup 表**：006_migrate_columns.sql 已在 DB 迁移时创建备份表，可安全回滚。
- **执行 migrate_columns 后**：`blocks_migration_backup` 表保留（可用于审计），`type='columns'` 记录数量归零。
- **T3 执行验收 SQL**：

  ```sql
  -- 验证旧格式全部清理
  SELECT COUNT(*) FROM blocks WHERE type = 'columns';
  -- 期望：0

  -- 验证新格式正常
  SELECT type, COUNT(*) FROM blocks WHERE type IN ('columnList','column') GROUP BY type;
  -- 期望：columnList 和 column 行数符合页面中分栏数量
  ```

- **风险**：`migrate_columns` 工具会跳过嵌套 columns 块（`inner.Type == "columns"`），即旧格式中列内嵌列的内容会被丢弃。这是已知设计决策（嵌套列在新架构中通过前端过滤 `isInsideColumn` 防止创建），需在用户沟通文档中说明。
