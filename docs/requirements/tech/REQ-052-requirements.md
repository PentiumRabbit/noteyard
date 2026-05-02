# REQ-052 需求文档 — Columns 块重构：对齐 Notion

| 字段 | 内容 |
|------|------|
| REQ ID | REQ-052 |
| 版本 | v1.0 |
| 状态 | 待确认 |
| 作者 | PM |
| 日期 | 2026-05-01 |

---

## 1. 用户故事

**US-01 — 插入分栏**
作为编辑者，我希望通过斜杠菜单插入 Columns 块，选择列数（2–5 列），以便将内容并排展示。

**US-02 — 列内编辑**
作为编辑者，我希望在每一列内自由输入文本、插入图片、代码块、引用等各类内容块，并与主编辑器共享完整的 undo/redo 历史，以便编辑体验与普通段落一致。

**US-03 — 调整列宽**
作为编辑者，我希望拖拽相邻列之间的分隔线来调整列宽，列宽以百分比保存，刷新后保持，以便精确控制版式比例。

**US-04 — 跨列拖拽块**
作为编辑者，我希望通过块拖拽手柄将某列内的块移动到另一列，或移出分栏成为独立块，以便灵活重组内容。

**US-05 — 删除/合并列**
作为编辑者，我希望在列为空时按 Backspace 触发列合并，或通过工具栏删除指定列，以便快速清理不需要的分栏。

**US-06 — 存量数据迁移**
作为系统，我希望在升级时自动将旧版 `columnsData` prop（JSON 序列化的 object[][] 格式）迁移为 `columnList → column[] → block[]` 的 children 结构，以便用户无感知地保留历史数据。

---

## 2. 场景矩阵

| # | 场景 | 前置条件 | 操作 | 预期结果 | 优先级 |
|---|------|---------|------|---------|--------|
| S-01 | 正常：插入 2 列分栏 | 光标在空段落 | 斜杠菜单输入 `/columns`，选择 2 列 | 插入 columnList，含 2 个等宽 column（各 50%），每列含 1 个空 paragraph | P0 |
| S-02 | 正常：插入 5 列分栏 | 光标在空段落 | 斜杠菜单选择 5 列 | 插入 columnList，含 5 个等宽 column（各 20%），每列含 1 个空 paragraph | P1 |
| S-03 | 正常：列内输入多种块 | 已插入 2 列分栏 | 在左列插入 heading、code、image；在右列插入 callout | 各列独立渲染，主编辑器 undo/redo 覆盖全部变更，内容随页面保存正常持久化 | P0 |
| S-04 | 正常：拖拽调整列宽 | 已插入 3 列分栏 | 拖拽第 1/2 列分隔线向右移动 | 第 1 列宽度增加，第 2 列宽度对应减少；单列最小宽度不低于 10%；松开后宽度持久化 | P1 |
| S-05 | 正常：跨列拖拽块 | 2 列各有内容 | 拖拽左列某块到右列 | 块从左列移除，插入右列目标位置；两列内容一致性保持，undo 可还原 | P1 |
| S-06 | 边界：单列剩最后一块，按 Backspace | 左列只有一个空 paragraph | 在空 paragraph 首位按 Backspace | 触发列合并逻辑（参考 BlockNote flattenColumns 行为）：columnList 中 column 数减 1，内容合并到相邻列 | P1 |
| S-07 | 边界：列宽拖拽至最小值 | 2 列分栏，某列宽度已接近 10% | 继续拖拽分隔线 | 列宽不低于 10%，分隔线停止移动，不发生布局溢出 | P1 |
| S-08 | 边界：6 列上限（超出 5 列） | 用户尝试通过 API 或代码插入 6 列 columnList | — | 系统限制最多 5 列，拒绝或自动截断为 5 列；界面不渲染异常状态 | P2 |
| S-09 | 异常：嵌套 columns 尝试 | 已在某列内 | 通过斜杠菜单尝试插入 columns 块 | 斜杠菜单中 Columns 选项不可见（被过滤）；列内 blockSpec 禁止 columnList 类型 | P0 |
| S-10 | 异常：存量 columnsData 迁移失败 | DB 中存在旧格式 columns 块（columnsData prop 格式） | 打开含旧 columns 块的页面 | 迁移脚本解析失败时降级：展示空列结构，不崩溃，控制台输出警告日志 | P1 |
| S-11 | 异常：columnsData 为非法 JSON | DB 中 columnsData 字段为损坏字符串 | 打开对应页面 | 各列降级为空内容（等同空 paragraph），不抛出未捕获异常，页面可继续编辑 | P1 |
| S-12 | 边界：存量数据迁移 — 列内含嵌套 columns | 旧格式某列内有 columns 子块 | 执行迁移 | 迁移时删除嵌套 columns 块（对齐 Notion 不支持嵌套），保留其余块内容，记录迁移日志 | P2 |

---

## 3. 验收标准

**AC-01 — 数据结构正确性**
保存后，`columnList` 块的 children 数组长度等于列数（2–5），每个 `column` 的 children 为有效 block 数组；后端 blocks 表中 `parent_block_id` 链正确无断链，可通过 `/api/pages/{id}/blocks` 接口完整还原 children 树。

**AC-02 — Undo/Redo 完整覆盖**
在列内进行 ≥ 3 次编辑（包含跨列操作），执行 Cmd+Z 逐步回退，每步均正确还原；连续 Ctrl+Z 直至文档初始状态，内容与插入前完全一致。实测不出现旧版 mini-editor 的 undo 失效问题（ISS-002/ISS-003 场景回归通过）。

**AC-03 — 列宽持久化精度**
拖拽调整列宽后，刷新页面，各列宽度与调整后数值误差不超过 0.1 个百分点（百分比保留 1 位小数存储）。所有列宽之和始终等于 100%（误差 ≤ 0.1%）。

**AC-04 — 嵌套禁止强制执行**
在任意 column 内，斜杠菜单不出现 Columns/columnList 选项；若通过程序直接调用 `editor.insertBlocks` 尝试在 column 内插入 columnList 类型，BlockNote schema 层拒绝插入（不渲染、不崩溃）。

**AC-05 — 存量数据零感知迁移**
对包含旧版 `columns` 块（columnsData prop 格式）的全部测试页面，执行迁移脚本后：页面正常打开，列数与列内块数量与迁移前一致，列宽比例保留（误差 ≤ 0.1%）；迁移脚本幂等（重复执行结果相同）。

---

## 4. 明确不支持的功能（对齐 Notion）

| 功能 | 说明 |
|------|------|
| 嵌套 columns | column 内禁止插入 columnList/columns 块，与 Notion 保持一致。schema 层 + 斜杠菜单双重拦截。 |
| 超过 5 列 | 列数上限为 5，与 Notion 常用限制对齐；超出时系统拒绝或截断。 |
| 固定像素列宽 | 列宽仅支持百分比，不支持固定 px 值，以保证响应式布局。 |
| 列的独立 undo 栈 | 不保留旧版 mini-editor 的列内独立 undo 栈；统一使用主编辑器 undo 历史。 |
| 移动端触摸拖拽调整列宽 | 当前版本仅支持桌面端鼠标拖拽，移动端触摸拖拽列宽不在本次范围内。 |

---

## 5. 数据迁移方案说明

### 5.1 旧格式（columnsData prop）

旧版 `columns` 块将所有列内容序列化为 props 中的 `columnsData` 字段（`JSON.stringify(object[][])`），列宽存储在 `widths` 字段（`JSON.stringify(number[])`）。这些数据以单行形式存储在 blocks 表的 `content` 或 `props` 列中，**没有** parent_block_id 关联的子块记录。

```
blocks 表（旧）:
  id: "abc"
  type: "columns"
  content: "{\"columnsData\": \"[[{...blocks...}],[{...blocks...}]]\", \"widths\": \"[50,50]\"}"
  parent_block_id: null
```

### 5.2 新格式（children 结构）

重构后采用 BlockNote 原生 children 结构，分层存储：

```
blocks 表（新）:
  columnList 块:
    id: "abc", type: "columnList", parent_block_id: <page_block>

  column 块（每列一行）:
    id: "abc-col-0", type: "column", parent_block_id: "abc"
    props: { width: "50" }   -- 列宽百分比

    id: "abc-col-1", type: "column", parent_block_id: "abc"
    props: { width: "50" }

  列内 block（每块一行）:
    id: "xyz", type: "paragraph", parent_block_id: "abc-col-0"
    ...
```

### 5.3 迁移逻辑

1. **扫描**：遍历 blocks 表，找出 `type = "columns"` 且 content 含 `columnsData` 字段的记录。
2. **解析**：`JSON.parse(content)` 取 `columnsData`（object[][]）和 `widths`（number[]）。
3. **写入**：
   - 将原 columns 块更新为 `columnList` 类型，清空旧 content/props。
   - 为每列创建 `column` 块，`parent_block_id = columnList.id`，`props.width = widths[i]`。
   - 将每列的 object[] 中每个 block 写入 blocks 表，`parent_block_id = column.id`，递归处理嵌套块（嵌套 columns 块跳过，记录日志）。
4. **幂等保障**：迁移前检查 columnList 是否已有 column 子块；若已存在则跳过该条记录。
5. **回滚**：迁移前对受影响行备份到 `blocks_migration_backup` 临时表；如迁移中断，可从备份恢复。
6. **降级处理**：`columnsData` 解析失败时，保留原 columnList 块结构但各列为空（含一个空 paragraph），不阻断页面加载。

### 5.4 前端兼容层

`toBlockNote.ts` 和 `fromBlockNote.ts` 需适配新的 children 递归结构。迁移完成前，前端读取逻辑保留对旧格式（`columnsData` prop）的 fallback 解析，迁移完成后删除 fallback 分支。
