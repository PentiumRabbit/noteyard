# REQ-052 架构评审报告 — Columns 块重构

| 字段 | 内容 |
|------|------|
| REQ ID | REQ-052 |
| 评审人 | 研发负责人 |
| 评审日期 | 2026-05-01 |
| 状态 | 已完成 |

---

## 1. 现状分析

### 1.1 当前实现的结构性缺陷

当前 `ColumnsBlock`（`Editor.tsx` L226–L273）采用"每列一个独立 BlockNote 实例（mini-editor）"方案：

- **`ColumnsBlock`**：`content: "none"`，所有列数据压缩到 `columnsData`（JSON.stringify object[][]）和 `widths`（JSON.stringify number[]）两个 prop 字段中。
- **`ColumnCell`**：每列独立调用 `useCreateBlockNote`，产生独立的 TipTap/ProseMirror 文档实例和独立的 undo 历史栈。
- **`columnCellSchema`**：为列内 mini-editor 单独创建一套 schema，与主编辑器 schema 分离，需手动同步。

已知缺陷（来自 ISS-002 / ISS-003）：
- 列内操作的 undo/redo 与主编辑器完全隔离，跨列或跨主-列操作无法统一回退；
- mini-editor schema 与主 schema 不同步，导致块类型注册崩溃；
- 保存逻辑：列内内容触发 `saveColBlocks` → `editor.updateBlock`（将全部列数据序列化写入 prop），每次修改一列需重写所有列数据，I/O 放大严重；
- `toBlockNote.ts` 将 `columns` 块当作 props-as-content 类型处理（L6），服务端 `ListByPage` 返回扁平数组，columns 块无 children，列内块不持久化到 blocks 表独立行。

### 1.2 数据库现状

`blocks` 表（`001_init.sql` + `004_block_props.sql`）已有 `parent_block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE` 字段，外键已在初始建表时定义，**children 结构所需的父子关联字段已存在，无需 DDL 变更**。

`BatchUpdate` 使用 `ON CONFLICT(id) DO UPDATE`（upsert），支持任意深度树形结构写入，无需修改存储层接口。

---

## 2. 方案对比

### 方案 A：原地增量改造（Mini-Editor 修复）

在不改变当前 `content: "none"` / props 序列化架构的前提下，修补已知问题：

- 用单一受控 React state 替代多个 mini-editor 实例，列内内容全部通过主编辑器 `editor.updateBlock` 写入 props；
- 抽取 `columnCellSchema` 与主 schema 共享同一份 blockSpec 注册，消除 ISS-002/ISS-003 的 schema 不同步根因；
- undo/redo 问题通过"每次更新 props 触发主编辑器历史"部分缓解（但列内细粒度编辑仍无法逐键回退）。

| 维度 | 评估 |
|------|------|
| 改动文件数 | 1（Editor.tsx） |
| 工作量 | 小（约 2–3 天） |
| undo/redo 完整性 | 仍不满足 AC-02：列内字符级编辑无法逐步回退 |
| 数据模型 | 维持 prop 序列化，不符合 AC-01（blocks 表无 parent_block_id 链） |
| 嵌套禁止 | 可通过 slashMenu 过滤实现，但 schema 层无法强制 |
| 存量迁移 | 不需要 |
| 技术债清零 | 否，mini-editor 结构性隔离问题依然存在 |
| 风险 | 低（改动面小），但 ISS-002/ISS-003 根因未消除，未来仍会复发 |

**结论：方案 A 仅为打补丁，无法满足 AC-01/AC-02，不推荐作为最终方案。**

---

### 方案 B：BlockNote children 原生结构重构（推荐）

按 BlockNote 0.26 框架对 columnList/column 的内置感知，自行实现 TipTap 节点定义 + React blockSpec，将 columns 块迁移为 `columnList → column[] → block[]` 的 children 结构。

#### 2.1 核心思路

BlockNote 框架已预留 columnList/column 的节点 content 类型：
- `columnList`：content = `"column column+"`（TipTap group）
- `column`：content = `"blockContainer+"`

框架内置行为（UniqueID 分配、Backspace 合并/flattenColumns、HTML 导出）在注册正确 TipTap 节点后自动生效。列内块成为普通 BlockNote 块，共享主编辑器的单一 ProseMirror 文档树和 undo 历史。

#### 2.2 实现步骤概述

1. **定义 TipTap 节点**：在 `Editor.tsx` 新增 `columnListNode`（content: "column column+"）和 `columnNode`（content: "blockContainer+"，props: width），通过 `createStronglyTypedTiptapNode` 或低层 TipTap Node API 定义。
2. **注册 blockSpec**：用 `createReactBlockSpec` 包装，`ColumnListBlock` 渲染横排 flex 容器（含拖拽分隔条逻辑），`ColumnBlock` 渲染单列容器，`contentRef` 挂载到列内 blockContainer。
3. **更新主 schema**：将 `columns` 替换为 `columnList` + `column`，删除 `columnCellSchema`、`ColumnCell`、`ColumnsBlockInner` 及 mini-editor 相关代码。
4. **更新序列化层**：
   - `toBlockNote.ts`：对 `columnList` 块递归构建 children 树（`column` 子块 → 列内块），不再走 props-as-content 分支；
   - `Editor.tsx` 的 `buildDtos`：递归展开 children，为每个 column 和列内块生成独立的 `Partial<Block>` DTO，携带正确的 `parent_block_id`。
5. **数据迁移**：按 REQ-052-requirements.md §5.3 步骤，将 `type="columns"` 旧记录迁移为 columnList + column + 子块结构（见第 4 节）。

| 维度 | 评估 |
|------|------|
| 改动文件数 | 3–4（Editor.tsx, toBlockNote.ts, 迁移脚本 × 1，可能新增 migrate_columns.go） |
| 工作量 | 中（约 5–8 天，含迁移脚本和测试） |
| undo/redo 完整性 | 完全满足 AC-02：列内块共享主 ProseMirror 文档树 |
| 数据模型 | 完全满足 AC-01：blocks 表 parent_block_id 链正确 |
| 嵌套禁止 | schema 层强制（columnList 的 content 类型不含 columnList），AC-04 满足 |
| 存量迁移 | 需要（见第 4 节） |
| 技术债清零 | 是，ISS-002/ISS-003 根因消除 |
| 风险 | 中（TipTap 节点定义需与 BlockNote 0.26 内部结构对齐，存在 API 探索成本；存量数据迁移不可逆，需充分测试） |

---

## 3. 推荐方案

**推荐方案 B（children 原生结构重构）。**

理由：
1. **根因消除**：ISS-002/ISS-003 崩溃根因是 mini-editor schema 隔离，方案 B 从架构层消除该根因，方案 A 仅治标。
2. **AC-01/AC-02 强制满足**：children 结构天然对齐 AC-01 数据完整性要求；共享文档树天然对齐 AC-02 undo/redo 要求，这两条是 P0 验收标准，无替代路径。
3. **BlockNote 框架契合**：框架已内置对 columnList/column 的感知（键盘、UniqueID、flattenColumns），方案 B 利用这些内置行为，方案 A 需在 props 层绕过框架约束，长期维护成本更高。
4. **数据库无 DDL 变更**：`parent_block_id` 字段和 `BatchUpdate` upsert 机制已就绪，后端改动量极小。

主要风险及缓解措施：
- **TipTap 节点 API 适配风险**：BlockNote 0.26 未直接导出 `createStronglyTypedTiptapNode`，需参考源码或使用 `@tiptap/core` 原生 `Node.create` API。建议研发阶段先用 spike 分支验证 columnList/column 节点注册可用性（1 天）。
- **存量迁移不可逆**：执行前备份到 `blocks_migration_backup` 表，迁移脚本幂等，支持从备份回滚（见第 4 节）。

---

## 4. 改动文件清单

### 前端

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `web/src/components/editor/Editor.tsx` | 重写局部 | 删除 `ColumnsBlock`、`ColumnsBlockInner`、`ColumnCell`、`columnCellSchema`；新增 `ColumnListBlock`（TipTap 节点 + React 渲染，含列宽拖拽）、`ColumnBlock`（TipTap 节点 + React 渲染）；更新 `schema` 注册；更新 `buildDtos` 递归展开 children；更新斜杠菜单 `columnsItem` 插入逻辑（列数选择 2–5）；列内斜杠菜单过滤 columnList 类型 |
| `web/src/utils/toBlockNote.ts` | 修改 | 新增 `columnList` 分支：将 DB 扁平 blocks 按 `parent_block_id` 构建 columnList → column → 列内块的 children 树；删除 `columns` 旧 props-as-content 分支（迁移完成后）；迁移完成前保留 fallback 兼容旧格式 |
| `web/src/utils/toBlockNote.test.ts` | 修改 | 更新 `columns` 旧测试用例；新增 columnList/column children 结构的序列化/反序列化测试 |

### 后端

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `server/internal/handler/block_handler.go` | 不变 | `BatchUpdate` 已支持 `parent_block_id`，无需修改 |
| `server/internal/repository/sqlite/block_repo.go` | 不变 | `BatchUpdate` upsert 已覆盖 children 写入场景 |
| `server/internal/repository/sqlite/XXX_migrate_columns.sql` | 新增 | 数据迁移 SQL（见第 4.1 节），作为 `006_migrate_columns.sql` 追加到 migration 序列中 |
| `server/cmd/migrate_columns/main.go`（可选独立脚本） | 新增 | 供一次性手动执行的迁移工具，含 dry-run 模式和回滚能力；若仅通过 SQL migration 文件执行则可省略 |

> 注：blocks 表 DDL（`parent_block_id` 字段）已存在，**无需新增 SQL ALTER TABLE**。

### 4.1 数据迁移脚本关键逻辑

迁移脚本分为以下阶段，每阶段在事务内执行：

**阶段 0 — 备份**
```sql
CREATE TABLE IF NOT EXISTS blocks_migration_backup AS
  SELECT * FROM blocks WHERE type = 'columns';
```

**阶段 1 — 扫描旧记录**
```sql
SELECT id, page_id, content, order_index
FROM blocks
WHERE type = 'columns'
  AND content LIKE '%columnsData%'
  AND NOT EXISTS (
    SELECT 1 FROM blocks child WHERE child.parent_block_id = blocks.id
  );
-- NOT EXISTS 子查询确保幂等：已迁移的记录不重复处理
```

**阶段 2 — 应用层转换（Go 脚本）**

对每条旧记录：
1. `JSON.parse(content)` 取 `columnsData`（object[][]）和 `widths`（number[]）；
2. 将原 `columns` 块更新为 `type = 'columnList'`，`content = '{}'`，`props = '{}'`；
3. 为每列 i 插入 `column` 块：`id = uuid`，`parent_block_id = columnList.id`，`props = '{"width":"<widths[i]>"}'`，`order_index = i`；
4. 将 `columnsData[i]` 中每个 block 递归写入，`parent_block_id = column.id`；嵌套 `columns` 块跳过，写入 warn 日志；
5. 解析失败时：保留 columnList 结构，各列插入一个空 paragraph，写入 error 日志，不回滚整体事务。

**阶段 3 — 回滚**（仅在迁移失败且需人工介入时执行）
```sql
DELETE FROM blocks WHERE id IN (
  SELECT id FROM blocks_migration_backup
);
INSERT INTO blocks SELECT * FROM blocks_migration_backup;
DROP TABLE blocks_migration_backup;
```

---

## 5. 测试策略

### 5.1 单元测试

| 测试文件 | 覆盖场景 |
|---------|---------|
| `web/src/utils/toBlockNote.test.ts` | columnList 块带 column children 的正确构建；column 块 props.width 解析；列内任意块类型递归；fallback：旧格式 columnsData prop 正常降级 |
| 迁移脚本 Go 单测（`migrate_columns_test.go`） | 正常 2/5 列迁移；widths 长度不匹配时自动均分；columnsData 解析失败降级；幂等（重复执行无副作用）；嵌套 columns 块跳过并记录日志 |

### 5.2 集成测试

| 测试场景 | 对应验收标准 |
|---------|------------|
| 插入 2/3/5 列 columnList，保存后 `ListByPage` 返回完整 parent_block_id 链 | AC-01 |
| 列内执行 ≥ 3 次编辑，Cmd+Z 逐步回退至初始状态 | AC-02 |
| 拖拽列宽至指定值，刷新页面后误差 ≤ 0.1% | AC-03 |
| 列内斜杠菜单无 Columns 选项；`editor.insertBlocks` 在 column 内插入 columnList 被拒 | AC-04 |
| 含旧格式 columns 块的测试页面执行迁移后正常打开，列数/内容/宽度一致 | AC-05 |
| ISS-002/ISS-003 场景回归：列内插入/删除全类型块不崩溃 | AC-02 回归 |

### 5.3 E2E 回归（手动 / Playwright）

- S-01 插入 2 列分栏，列内输入文本，刷新验证持久化；
- S-03 列内插入 heading、code、image 和 callout，undo 历史覆盖全部变更；
- S-06 空列 Backspace 触发列合并（flattenColumns 行为）；
- S-09 列内斜杠菜单无 Columns 选项；
- S-10 / S-11 旧格式 columnsData 解析失败时页面不崩溃、展示空列结构。

### 5.4 迁移验证清单

- [ ] dry-run 模式输出受影响记录数，人工 review；
- [ ] 备份表 `blocks_migration_backup` 行数与扫描到的旧 columns 记录数一致；
- [ ] 迁移后所有测试页面人工抽检：列数、列宽、列内块数量与迁移前记录对比；
- [ ] 重复执行迁移脚本，blocks 表无重复行，结果与首次执行完全相同（幂等验证）。

---

## 6. 工作量与排期估算

| 任务 | 估算 |
|------|------|
| TipTap 节点 API spike（columnList/column 注册验证） | 1 天 |
| Editor.tsx 重构（新增节点定义 + 删除 mini-editor + schema 更新 + buildDtos 递归） | 3 天 |
| toBlockNote.ts 适配（children 树构建 + fallback 兼容） | 1 天 |
| 迁移脚本（Go，含 dry-run + 幂等 + 回滚） | 1.5 天 |
| 单元测试更新 + 新增 | 1 天 |
| 集成 + E2E 测试 | 1 天 |
| **合计** | **约 8.5 天** |

---

## 7. 不在本次范围内的功能

与 REQ-052-requirements.md §4 一致，以下功能明确不做：

| 功能 | 说明 |
|------|------|
| 嵌套 columns | schema 层禁止，斜杠菜单过滤，迁移时跳过并记录日志 |
| 超过 5 列 | 列数上限为 5，插入时验证 |
| 固定像素列宽 | 仅支持百分比 |
| 列的独立 undo 栈 | 统一使用主编辑器 undo 历史 |
| 移动端触摸拖拽调整列宽 | 不在本次范围 |
