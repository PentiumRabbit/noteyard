# 架构评审 — REQ-032 编辑器 UI 全面对齐 Notion

**评审日期**: 2026-04-30
**评审人**: 总架构师
**结论**: ✅ 通过，无高风险项

---

## 模块影响分析

| 模块 | 影响 | 说明 |
|------|------|------|
| `App.tsx` | 修改 | 新增页面标题编辑区，管理 title 状态和 sidebar 刷新 |
| `App.css` | 修改 | 整体布局调整（编辑区宽度/padding） |
| `Editor.tsx` | 小修 | 移除顶部 padding（由 App 层控制），接收 pageId 相关 title |
| `Editor.css` | 修改 | BlockNote 覆盖样式：H1/H2/H3、quote、code、list、divider 等 |
| `Sidebar.tsx` | 修改 | 页面项增加 icon 显示、⋯/+ 操作区重构、折叠箭头优化 |
| `Sidebar.css` | 修改 | hover 操作区样式、icon 样式、选中/hover 状态 |
| `DatabaseView.tsx` | 修改 | Select 下拉、Tab/Enter 导航、列宽拖拽、行展开 Modal |
| `DatabaseView.css` | 修改 | 列宽拖拽线、行展开 Modal 样式 |
| 后端 | 无 | 所有字段均已存在，无需新接口 |

---

## 实现方案

### C. 页面标题区
页面标题从 BlockNote 内部提取到 `App.tsx` 上层，独立渲染在 BlockNote 之上。
- `App` 层增加 `pageTitle` / `pageIcon` 状态，通过 `api.pages.get(pageId)` 加载
- 标题修改防抖 800ms 后调用 `api.pages.update`
- 修改后触发 `sidebarKey` 计数器变化，迫使 Sidebar 刷新

### D. BlockNote CSS 覆盖
BlockNote 元素类名：
- `.bn-block-content[data-content-type="heading"][data-level="1"]` → H1
- `.bn-block-content[data-content-type="heading"][data-level="2"]` → H2
- `.bn-block-content[data-content-type="heading"][data-level="3"]` → H3
- `.bn-block-content[data-content-type="quote"]` → 引用块
- `.bn-block-content[data-content-type="codeBlock"]` → 代码块
- `.bn-inline-content code` → 行内代码
- `.bn-block-content[data-content-type="checkListItem"][data-checked="true"]` → 已完成 todo

### E-01 Select 选项管理
- `DBColumn.options` 存储为 JSON 字符串（`string[]` 序列化），当前始终为 `"[]"`
- 解析 options 渲染下拉列表；新增/删除选项通过 `api.databases.updateColumn` 保存
- 编辑 select 单元格时显示 `<datalist>` 或自定义下拉

### E-02 键盘导航
在 `DatabaseView.tsx` 的 cell input `onKeyDown` 处理 `Tab` / `Shift+Tab` / `Enter`，根据当前 `[rowIdx, colIdx]` 计算下一个焦点位置

### E-03 列宽拖拽
每个 `<th>` 右侧添加不可见的拖拽 handle `div.col-resize-handle`，用 `mousedown/mousemove/mouseup` 实现宽度调整，宽度存于组件 state（不持久化到后端）

### E-04 行展开 Modal
`<div className="db-row-modal-overlay">` + `<div className="db-row-modal">` 显示所有列的 key-value 编辑区；保存时批量调用 `updateCells`

---

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| BlockNote 类名变更（版本升级） | 低 | CSS 仅覆盖视觉，功能无影响；`data-content-type` 属性稳定 |
| 列宽仅存 state 不持久化 | 低 | 刷新后恢复默认，可接受；后续有需求再加后端字段 |
| Select 下拉覆盖自由输入 | 低 | options 为空时降级为自由输入 |
| App 层 title 与 Sidebar 同步 | 低 | 通过 key++ 触发 Sidebar 重新加载，已有模式 |

---

## 任务拆分

| Task | 负责 | 内容 |
|------|------|------|
| Task-01 | 前端 | App.tsx：页面标题 + icon 编辑区，防抖保存，sidebar 同步 |
| Task-02 | CSS | Editor.css：BlockNote H1/H2/H3/quote/code/divider/list/checkbox CSS 覆盖 |
| Task-03 | 前端 | Sidebar.tsx：icon 显示、⋯+操作重构、hover 状态 |
| Task-04 | CSS | Sidebar.css：样式对齐 Notion |
| Task-05 | 前端 | DatabaseView.tsx：Select 选项管理 + 下拉 |
| Task-06 | 前端 | DatabaseView.tsx：Tab/Enter 键盘导航 |
| Task-07 | 前端 | DatabaseView.tsx：列宽拖拽 |
| Task-08 | 前端 | DatabaseView.tsx：行展开 Modal |
| Task-09 | CSS | DatabaseView.css：列宽拖拽线 + 行展开 Modal 样式 |
| Task-10 | TE | 验收：所有功能点对照 REQ-032 验收标准 |
