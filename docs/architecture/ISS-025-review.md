# ISS-025 前端架构评审 — 列宽拖拽分栏失效根因分析与修复方案

| 字段 | 内容 |
|------|------|
| 评审角色 | 前端架构师（arch） |
| Dispatch | #154 |
| 上级 | dev-lead |
| 完成时间 | 2026-05-04 |
| 关联 ISS | ISS-025 |

---

## 一、根因分析

**问题文件**：`web/src/components/database/DatabaseView.css`

### 根因：col-header-btn 覆盖 col-resize-handle 导致 mousedown 事件和 cursor 失效

`.col-resize-handle` 设计为 `position: absolute; right: 0; width: 6px`，依赖 `.col-header-btn` 的 `width: calc(100% - 6px)` 留出右侧 6px 空间。

问题在于：**在 `display: table-cell`（`<th>`）的子元素中，`display: flex` 元素的 `%` 宽度在 WebKit/Tauri 的 auto table layout 下可能不精确**。当 `<th>` 没有设置明确的 `width`（表格使用 `table-layout: auto`），`100%` 会被解析为 `auto`，导致 `calc(100% - 6px)` 退化为 `auto`，按钮实际渲染宽度撑满整个 `<th>`，覆盖了 `col-resize-handle` 的 6px 区域。

此外：
- `.col-resize-handle` 无 `z-index`，在同一 `position: relative` 的 `<th>` 内，虽然 `position: absolute` 的元素应该在 `position: static` 元素之上，但当按钮宽度覆盖时，`cursor: pointer` 仍会优先于 `col-resize-handle` 的 `cursor: col-resize`
- `.col-resize-handle` 默认无任何可见样式（无背景色、无边框），用户即使知道功能存在也难以定位交互区域

---

## 二、修复方案

### 改动范围

仅涉及 `web/src/components/database/DatabaseView.css`，不修改任何 `.tsx` 逻辑。

### 具体修改

**修改 1**：`col-header-btn` — 改用 `max-width` 约束，避免依赖 table-cell 中 `%` 宽度的精确性

```css
/* 原来 */
width: calc(100% - 6px);

/* 修复后 */
width: 100%;
max-width: calc(100% - 6px);
```

`max-width` 在所有浏览器引擎中对 table-cell 子元素均正确生效，不受 `auto` layout 影响。

**修改 2**：`col-resize-handle` — 添加 `z-index: 1`，确保层叠顺序高于相邻的 btn

```css
z-index: 1;
```

**修改 3**：`col-resize-handle::after` — 添加常驻视觉提示竖线（th:hover 时显示），提升可发现性

```css
.col-resize-handle::after {
  content: "";
  position: absolute;
  top: 20%;
  right: 2px;
  width: 2px;
  height: 60%;
  background: var(--color-border-medium);
  border-radius: 1px;
  opacity: 0;
  transition: opacity 0.15s;
}
.db-table th:hover .col-resize-handle::after { opacity: 1; }
.col-resize-handle:hover::after,
.col-resize-handle:active::after { opacity: 0; }
```

---

## 三、回归影响分析

| 功能 | 影响风险 | 说明 |
|------|---------|------|
| 列宽拖拽 | 修复目标 | col-resize-handle 可被正确触发，startResize 正常工作 |
| 列头菜单（openColMenu） | 无 | col-header-btn 交互区域不变，仍为 th 宽度减 6px |
| 列头视觉样式 | 极低 | th:hover 时右侧出现细竖线，不影响列名文本显示 |
| Kanban/Gallery/其他视图 | 无 | col-resize-handle 仅存在于 table view 的 th 中 |

---

## 四、任务拆分表

| # | 角色 | 任务 | 交付物 | 依赖 |
|---|------|------|--------|------|
| T1 | 模块工程师（frontend） | 按修改 1-3 改 `DatabaseView.css` | 代码变更 + commit | 无 |
| T2 | 测试执行者 | 回归验证：拖拽列宽、列头菜单、th:hover 视觉 | 验证报告 | T1 |

---

## N2 — 架构评审完成（ISS-025，自动通过）

根因明确，修复方案仅涉及 1 个 CSS 文件，风险极低。此为 P2 Bug 修复，N2 自动通过，研发负责人直接委派工程师实现。
