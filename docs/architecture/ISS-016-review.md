# ISS-016 前端架构评审 — 单选/多选交互根因分析与修复方案

| 字段 | 内容 |
|------|------|
| 评审角色 | 前端架构师（arch-frontend） |
| Dispatch | #121 |
| 上级 | dev-lead-ISS016-120 |
| 完成时间 | 2026-05-03 |
| 关联 ISS | ISS-016 |

---

## 一、根因分析

所有问题均位于 `web/src/components/database/DatabaseView.tsx`。

### 问题 1：多选面板在选一个选项后立即关闭

**根因（L557–559）**

```tsx
// toggleMultiSelectValue 末尾
if (multiSelectDropdown) {
  setMultiSelectDropdown(d => d ? { ...d } : null);
}
```

这段代码本意是"保持面板打开并触发重渲染"，但问题在于面板的 overlay `onClick` 是：

```tsx
<div className="col-menu-overlay" onClick={() => setMultiSelectDropdown(null)} />
```

`col-menu-overlay` 使用 `position: fixed; inset: 0; z-index: 99`，会捕获所有点击事件。选项按钮的 `onClick` 触发后，事件冒泡到 overlay，overlay 的 `onClick` 将 `multiSelectDropdown` 置为 `null`，面板随即关闭。

**正确处置**：在每个 `select-dd-item` 的 `onClick` 处理器中调用 `e.stopPropagation()`，阻止事件冒泡至 overlay。

> 注：单选 `selectOption` 中调用了 `setSelectDropdown(null)` 是主动关闭，行为符合预期（单选点选即关），无需修改冒泡逻辑。

---

### 问题 2：单选/多选下拉面板缺少"添加新选项"入口

**根因（L989–1014 单选，L1112–1150 多选）**

两个下拉面板的 JSX 均只渲染现有选项和"清除选择"按钮，没有"添加新选项"按钮：

```tsx
{selectDropdown.options.length > 0 && (
  <button className="select-dd-item select-dd-clear" ...>清除选择</button>
)}
// 无添加新选项按钮
```

`openSelectOptions` 函数（L487–494）已存在，接受 `(e: React.MouseEvent, col: DBColumn)`，负责打开选项管理 popover。但该函数需要 `DBColumn` 对象，而下拉面板的 state（`SelectDropdown`）中只存了 `colId`，没有完整的 `col` 对象。

**正确处置**：在两个下拉面板底部添加"+ 添加选项"按钮。由于 `db` 和 `db.columns` 在 `DatabaseView` 渲染作用域内可用，可通过 `colId` 查找出 `col` 对象，然后用一个合成的 `React.MouseEvent`（或通过 `useRef` 获取按钮位置）调用 `openSelectOptions`。

推荐方式：使用 `useRef` 绑定到"添加选项"按钮，在 `onClick` 中构造一个合成事件调用 `openSelectOptions`。

---

### 问题 3：已选中的选项无明显勾选状态（单选）

**根因（L989–1014）**

单选下拉面板 `selectDropdown` 渲染时，每个选项一律渲染为相同样式，没有将当前行的已选值与选项做对比：

```tsx
selectDropdown.options.map((opt, idx) => {
  const c = TAG_COLORS[opt.colorIdx % TAG_COLORS.length];
  return (
    <button key={idx} className="select-dd-item"  // 无 selected 状态
      onClick={() => void selectOption(...)}>
      <Chip label={opt.value} ... />              // 无勾选标记
    </button>
  );
})
```

多选面板（L1119–1135）已正确实现勾选状态（`isSelected` 变量 + `"✓ "` 前缀 + `.selected` class），但单选面板没有跟进相同模式。

**正确处置**：在单选下拉 map 中，从 `rows` 中查找当前行的已选值，与当前 `opt.value` 对比，添加 `selected` class 和 `✓` 前缀，与多选面板保持一致。同时，单选中点击已选中项应调用 `clearSelectCell`（取消选中+关闭），而非调用 `selectOption`（重复写入相同值）。

---

## 二、修复方案

### 改动范围

仅涉及 `web/src/components/database/DatabaseView.tsx` 和 `web/src/components/database/DatabaseView.css`，不触及 `date/number/text` 等字段的任何逻辑。

### 模块列表

| 模块 | 说明 |
|------|------|
| select-dropdown | 单选下拉面板渲染逻辑（L989–1015） |
| multi-select-dropdown | 多选下拉面板渲染逻辑（L1112–1150） |
| styles | `.select-dd-add-option` 样式 |

### 具体修改点

#### 修改 1 — 单选面板：添加勾选状态 + 取消逻辑

文件：`DatabaseView.tsx`，单选 dropdown JSX 段（约 L996–1001）

- 在 map 中读取当前行已选值：`const currentVal = rows.find(r => r.id === selectDropdown.rowId)?.cells[selectDropdown.colId] ?? ""`
- 计算 `const isSelected = currentVal === opt.value`
- 将 `className="select-dd-item"` 改为 `className={\`select-dd-item\${isSelected ? " selected" : ""}\`}`
- 将 `<Chip label={opt.value} ...>` 改为 `<Chip label={\`\${isSelected ? "✓ " : ""}\${opt.value}\`} ...>`
- `onClick` 改为：`isSelected` 时调用 `clearSelectCell`，否则调用 `selectOption`

#### 修改 2 — 多选面板：阻止事件冒泡

文件：`DatabaseView.tsx`，多选 dropdown map 中的按钮 `onClick`（约 L1126–1128）

在 `toggleMultiSelectValue` 调用前加 `e.stopPropagation()`：

```tsx
onClick={(e) => {
  e.stopPropagation();
  void toggleMultiSelectValue(...);
}}
```

#### 修改 3 — 单选面板：添加"+ 添加选项"入口

文件：`DatabaseView.tsx`，单选 dropdown 底部（约 L1006–1013 之后）

在"清除选择"按钮之后添加：

```tsx
<button
  className="select-dd-item select-dd-add-option"
  onClick={(e) => {
    e.stopPropagation();
    const col = db!.columns.find(c => c.id === selectDropdown.colId);
    if (col) openSelectOptions(e, col);
  }}
>
  + 添加选项
</button>
```

#### 修改 4 — 多选面板：添加"+ 添加选项"入口

文件：`DatabaseView.tsx`，多选 dropdown 底部（约 L1137–1148 之后）

与修改 3 相同模式，在"清除选择"按钮之后添加：

```tsx
<button
  className="select-dd-item select-dd-add-option"
  onClick={(e) => {
    e.stopPropagation();
    const col = db!.columns.find(c => c.id === multiSelectDropdown.colId);
    if (col) openSelectOptions(e, col);
  }}
>
  + 添加选项
</button>
```

#### 修改 5 — CSS：`.select-dd-add-option` 样式

文件：`DatabaseView.css`，`.select-dd-clear` 规则之后

```css
.select-dd-add-option {
  font-size: 12px;
  color: var(--color-accent);
}
.select-dd-add-option:hover {
  background: var(--color-hover-bg-medium);
}
```

---

## 三、回归影响分析

| 功能 | 影响风险 | 说明 |
|------|---------|------|
| 单选字段 | 低 | 仅单选下拉面板 JSX 内部变更，不影响数据写入路径 |
| 多选字段 | 低 | 仅在 onClick 加 stopPropagation，不改变数据更新逻辑 |
| date/number/text 字段 | 无 | 代码路径完全隔离 |
| RowModal 中的多选 | 无 | RowModal 使用独立渲染，不共用这两个 dropdown state |
| 看板/画廊/日历/时间轴视图 | 无 | 视图切换不影响 dropdown 面板逻辑 |

回归测试重点：
1. 多选：连续点击多个选项，面板保持打开
2. 多选：点击外区域 / Esc，面板关闭
3. 单选：点未选中项 → 选中 + 面板关闭
4. 单选：点已选中项 → 取消 + 面板关闭
5. 单选/多选：点"+ 添加选项"→ 选项管理 popover 弹出
6. text/number/date 字段：正常编辑，无异常

---

## 四、任务拆分表

| # | 角色 | 任务 | 交付物 | 依赖 |
|---|------|------|--------|------|
| T1 | 模块工程师（database） | 按修改 1–4 改 `DatabaseView.tsx` | 代码变更 | 无 |
| T2 | 模块工程师（database） | 按修改 5 改 `DatabaseView.css` | 样式变更 | 无 |
| T3 | 测试执行者 | 按回归影响分析执行回归 | 回归报告 | T1 + T2 |

T1 和 T2 可并行（零文件交叉：`.tsx` vs `.css`）。

---

## N2 — 架构评审完成，请研发负责人确认

前端架构评审已完成。三个问题根因均已定位，修复方案明确、改动局限于 `web/src/components/database/` 目录内两个文件，不影响其他字段类型。

**N2 结论**：方案可行，风险低，请研发负责人确认后委派工程师实现。
