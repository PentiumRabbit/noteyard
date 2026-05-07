# REQ-087 前端架构评审 — 编辑器内块拖拽视觉增强

> **适用场景**：评估 REQ-087 视觉增强需求与现有 REQ-086 pointer events 实现的契合度，识别差距并产出工程师任务拆分。
>
> 架构师: 前端架构师（arch-frontend）
> REQ: REQ-087
> 日期: 2026-05-07
> 状态: 已确认
> 前置: REQ-086（pointer events 拖拽基础实现已完成）

---

## 一、需求摘要

REQ-087 在 REQ-086 pointer events 拖拽引擎基础上，增强编辑器内块拖拽的视觉反馈：
- **FR-1 条目跟随**：拖拽时半透明 ghost（`opacity: 0.6`）跟随鼠标，源位覆盖 `rgba(255,255,255,0.55)` 遮罩
- **FR-2 挤压效果**：目标位置相邻块 `translateY` 动画让位（`150ms ease`），`rAF` 节流
- **FR-3 落点指示线**：目标块上/下边界渲染水平指示线（`position: fixed`，宽度对齐 `blockOuter`）
- **FR-4 水平分栏保持现有行为**：边缘 15% 触发 `columnList`，走 HTML5 原生拖拽路径
- **FR-5 ISS-048 修复**：`regular` 分支改用 BlockNote API（`removeBlocks` + `insertBlocks`），消除前导空白

---

## 二、模块影响分析

| 模块/文件 | 变更类型 | 说明 |
|-----------|---------|------|
| `web/src/components/editor/dropOverlayPlugin.ts` | 增量修改 | 核心文件。REQ-086 已实现 FR-1~FR-3 的主体逻辑；REQ-087 需补齐 Escape 取消、ghost 偏移量优化、columnList 目标命中等边界场景 |
| `web/src/components/editor/Editor.css` | 增量修改 | `.bn-drag-ghost` 和 `.bn-drop-line` 样式已在 REQ-086 中添加；REQ-087 可能需要微调（如 ghost 的 `transform` 偏移、`box-shadow` 等） |

**模块边界判断**：
- 所有变更均在 `web/src/components/editor/` 模块边界内
- `dropOverlayPlugin` 工厂函数签名不变，与 `Editor.tsx` 接口无变更
- 不涉及后端、DB、或其他前端模块

---

## 三、功能分层设计

| 功能点 | 落层 | 当前实现状态 | 差距 |
|--------|------|-------------|------|
| FR-1 ghost 元素创建（`cloneNode`，`position: fixed`，`opacity: 0.6`，`z-index: 100`） | UI 层（Plugin View） | ✅ 已实现（`onPointerDown` L465-477） | ghost 以 `(clientX, clientY)` 为左上角跟随，未做居中偏移；缺少 `box-shadow` 等视觉增强 |
| FR-1 源位遮罩（`rgba(255,255,255,0.55)` 独立 div） | UI 层（Plugin View） | ✅ 已实现（`onPointerDown` L481-493） | 遮罩尺寸在拖拽过程中不随源块 DOM 尺寸变化更新（如 React re-render 改变块高度） |
| FR-1 ghost 销毁（`pointerup`/`pointercancel` 时从 DOM 移除） | UI 层（Plugin View） | ✅ 已实现（`cleanupDrag` L680-715） | — |
| FR-1 React 重渲染后源块引用恢复（`data-id` 重查找） | 业务逻辑层（Plugin View） | ✅ 已实现（`onPointerMove` L559-570） | 仅在 `topLevelBlockOuters` 中查找，若源块在 column 内部则可能找不到 |
| FR-2 hit-test（编辑器水平中心 + 钳制 Y） | 业务逻辑层（Plugin View） | ✅ 已实现（`onPointerMove` L530-533） | — |
| FR-2 挤压范围计算（Y 坐标比较，`draggingDown` 方向判断） | 业务逻辑层（Plugin View） | ✅ 已实现（`onPointerMove` L600-634） | — |
| FR-2 `translateY` 动画（`150ms ease`，rAF 节流） | UI 层（Plugin View） | ✅ 已实现（`onPointerMove` L628-633） | — |
| FR-2 挤压清除（指针移出目标或移回源块） | UI 层（Plugin View） | ✅ 已实现（`_clearYieldTransforms` L659-667） | — |
| FR-3 落点指示线（`position: fixed`，宽度对齐 `blockOuter`） | UI 层（Plugin View） | ✅ 已实现（`onPointerMove` L637-653） | — |
| FR-3 指示线隐藏（指针移出目标） | UI 层（Plugin View） | ✅ 已实现（`_hideDropLine` L669-676） | — |
| FR-4 水平分栏（`SIDE_THRESHOLD = 0.15`，HTML5 原生拖拽路径） | 业务逻辑层（Plugin props） | ✅ 已实现（`handleMultiColumnDrop` + `onDragOver`） | — |
| FR-5 ISS-048 修复（`regular` 分支使用 BlockNote API） | 业务逻辑层（Plugin props） | ✅ 已实现（`handleMultiColumnDrop` L144-186） | — |
| Escape 键取消拖拽 | UI 层（Plugin View） | ❌ 未实现 | 需求文档验收标准明确要求"按 Escape 取消时，所有视觉元素完全清除" |
| ghost 偏移量（居中于指针） | UI 层（Plugin View） | ❌ 未实现 | 当前 ghost 以 `(clientX, clientY)` 为左上角，视觉上指针位于 ghost 左上角而非中心 |

---

## 四、技术方案设计

### 4.1 Ghost 创建/销毁

**当前实现**（`onPointerDown` L464-477）：

```typescript
// 创建：cloneNode(true) 完整克隆 blockOuter DOM
const ghost = blockOuter.cloneNode(true) as HTMLElement;
ghost.className = "bn-drag-ghost";
ghost.style.cssText = [
  "position: fixed", "pointer-events: none",
  "opacity: 0.6", "z-index: 100",
  `left: ${rect.left}px`, `top: ${rect.top}px`,
  `width: ${rect.width}px`,
].join("; ");
document.body.appendChild(ghost);
```

**销毁**（`cleanupDrag` L688-693）：

```typescript
if (this.ghostEl) {
  if (this.ghostEl.isConnected) {
    this.ghostEl.parentNode?.removeChild(this.ghostEl);
  }
  this.ghostEl = null;
}
```

**评审结论**：✅ 创建/销毁路径正确。`cloneNode(true)` 完整保留子块结构，`isConnected` 检查确保幂等安全。

**待优化**：
- ghost 初始位置为源块 `rect`，首次 `pointermove` 时跳变到 `(clientX, clientY)`。建议在 `pointerdown` 时记录 `offsetX = clientX - rect.left, offsetY = clientY - rect.top`，后续 ghost 定位使用 `(clientX - offsetX, clientY - offsetY)`，消除跳变。
- 可考虑添加 `box-shadow: 0 4px 12px rgba(0,0,0,0.15)` 增强立体感。

### 4.2 挤压动画实现

**当前实现**（`onPointerMove` L600-634）：

核心逻辑：
1. 通过 `sourceRect.top` 与 `targetRect.top` 比较判断拖拽方向（`draggingDown`）
2. 计算 `yieldAbove` / `yieldBelow` 阈值边界
3. 遍历当前 `topLevelBlockOuters`（实时 DOM 查询，非快照），对范围内的块应用 `translateY(±sourceHeight)`
4. 范围外恢复 `translateY(0)`

```typescript
// 核心动画样式
el.style.transform = `translateY(${delta}px)`;
el.style.transition = "transform 150ms ease";
```

**rAF 节流**（`onPointerMove` L513-515）：

```typescript
if (this.rafId !== null) return; // 已有待执行帧，跳过
this.rafId = requestAnimationFrame(() => { /* ... */ });
```

**评审结论**：✅ 方案正确。Y 坐标比较法比索引法更鲁棒（不受 React re-render 导致的 DOM 顺序变化影响）。`150ms ease` 过渡自然，rAF 节流有效避免高频 `pointermove` 导致的卡顿。

**注意事项**：
- 实时 DOM 查询（`querySelectorAll`）在每帧 rAF 回调中执行，50+ 块场景下性能可接受（`querySelectorAll` 是同步但快速的 C++ 级操作）
- `_clearYieldTransforms` 清理时设置 `el.style.transform = ""` 和 `el.style.transition = ""`（空字符串），而非 `"none"`，这确保 CSS 级联规则恢复生效

### 4.3 Hit-test 逻辑

**当前实现**（`onPointerMove` L526-533）：

```typescript
// 使用编辑器水平中心 + 钳制 Y 坐标
const editorRect = this.editorView.dom.getBoundingClientRect();
const hitX = editorRect.left + editorRect.width / 2;
const hitY = Math.max(editorRect.top + 1, Math.min(editorRect.bottom - 1, clientY));
const targetResult = getBlockPosFromPoint(this.editorView, hitX, hitY);
```

**`getBlockPosFromPoint` 三级回退**（L17-74）：
1. `view.posAtCoords` → 遍历 `bnBlock` group 祖先
2. `document.elementFromPoint` → `[data-node-type='blockOuter']` → `data-id` 反查 ProseMirror 位置
3. `[data-node-type='blockContainer']` → `view.posAtDOM`

**评审结论**：✅ 方案健壮。水平中心命中确保始终命中编辑器内块（不受拖拽手柄左侧偏移影响）；Y 钳制确保指针超出编辑器边界时仍能命中首/尾块。三级回退覆盖 `content:"none"` 块（database、button、subpage 等）的 `posAtCoords` 返回 `null` 场景。

**上/下半区判断**（L595）：

```typescript
const placement = clientY < targetRect.top + targetRect.height / 2 ? "before" : "after";
```

**评审结论**：✅ 简洁正确。使用 `clientY`（实际指针 Y）而非 `hitY`（钳制后），确保在编辑器边界附近仍能正确判断上下半区。

### 4.4 ColumnList 目标命中（pointer events 路径）

**当前状态**：pointer events 路径的 hit-test 通过 `getBlockPosFromPoint` 找到目标块。若目标为 `columnList` 节点（无 `blockOuter` 包装），`getBlockPosFromPoint` 的 `posAtCoords` 路径会向上查找到 `bnBlock` group 节点（`columnList` 属于 `bnBlock` group），返回其 `posBeforeNode`。但后续 `targetBlockOuter` 查找（L586-592）依赖 `[data-node-type='blockOuter']`，`columnList` 没有此属性，会回退到 `elementFromPoint` 查找其内部 block。

**评审结论**：⚠️ 需关注。当拖拽到 `columnList` 上方时，hit-test 可能命中 `columnList` 内部的第一个 block。此时挤压动画仅作用于顶层块（`topLevelBlockOuters` 过滤掉 column 内块），行为符合 FR-2 要求。但若 `columnList` 是文档中唯一的顶层节点（无其他顶层块），挤压动画无可见效果，落点指示线仍正常显示。

**建议**：在 pointer events 路径的 `onPointerUp` 中增加 `columnList` 目标检测：若目标块在 column 内部，将 `placement` 调整为相对于 `columnList` 的位置（而非 column 内 block），确保 `insertBlocks` 将块插入到 `columnList` 的同级而非 column 内部。

---

## 五、与现有 pointer events 拖拽流程的集成

### 5.1 双路径共存架构

```
                    ┌─── pointerdown（拖拽手柄）─── pointer events 路径
                    │    ├─ ghost 创建 + 源位遮罩
                    │    ├─ pointermove → rAF 节流 → ghost 跟随 + 挤压动画 + 落点线
                    │    └─ pointerup → 清理 + BlockNote API 提交
拖拽手柄 mousedown ──┤
                    │
                    └─── dragstart（浏览器原生）─── HTML5 drag 路径
                         ├─ dragover → lastDragoverSide + 分栏 overlay
                         └─ drop → handleMultiColumnDrop（分栏创建/regular 排序）
```

**隔离机制**：
- `pointerdown` 中调用 `e.preventDefault()` 阻止浏览器触发 `dragstart`（L457）
- `dragstart` 监听器（L415-421）作为兜底：若 `pointerdown` 的 `preventDefault` 未生效（极端情况），`dragstart` 也调用 `preventDefault` 阻止 HTML5 拖拽
- 两条路径通过 `isDragging` flag 隔离：pointer events 路径激活时 `isDragging = true`，HTML5 路径的 `handleMultiColumnDrop` 不受影响（它通过 ProseMirror `handleDrop` prop 触发，不依赖 `isDragging`）

### 5.2 ISS-048 修复与 pointer events 路径的兼容性

**ISS-048 修复位置**：`handleMultiColumnDrop` 的 `side === "regular"` 分支（L144-186），使用 `editor.removeBlocks` + `editor.insertBlocks`。

**pointer events 路径的事务提交**：`onPointerUp`（L717-772），同样使用 `editor.removeBlocks` + `editor.insertBlocks`。

**兼容性分析**：
- 两条路径使用相同的 BlockNote API，行为一致
- `handleMultiColumnDrop` 通过 `lastDragoverSide` 判断分栏意图（来自 `dragover` 事件），pointer events 路径通过 `currentPlacement` 判断上下半区（来自 `pointermove` hit-test）
- 两条路径不会同时触发：`pointerdown` 的 `preventDefault` 阻止了 `dragstart`，因此 pointer events 激活时 HTML5 drop 不会触发

**评审结论**：✅ 完全兼容。两条路径互斥，使用相同的 BlockNote API，无冲突风险。

### 5.3 新增 Escape 键取消的集成点

**插入位置**：`DropOverlayView` 构造函数中新增 `keydown` 监听器。

```typescript
// 伪代码 — 集成方案
this.onKeyDownBound = (e: KeyboardEvent) => {
  if (e.key === "Escape" && this.isDragging) {
    this.cleanupDrag(); // 复用现有清理逻辑，不提交事务
  }
};
document.addEventListener("keydown", this.onKeyDownBound);
```

**与现有流程的关系**：`cleanupDrag` 已实现完整的视觉清理（ghost、遮罩、挤压变换、落点线、userSelect），Escape 只需触发清理即可，无需额外逻辑。

---

## 六、状态管理设计

**当前状态**（均为 `DropOverlayView` 实例私有状态，已在 REQ-086 中定义）：

| 状态名 | 类型 | 说明 | REQ-087 变更 |
|--------|------|------|-------------|
| `isDragging` | `boolean` | 拖拽激活标志 | 不变 |
| `sourceBlockEl` | `HTMLElement \| null` | 源块 DOM 引用 | 不变 |
| `sourceBlockPos` | `number` | 源块 ProseMirror 位置 | 不变 |
| `sourceOverlayEl` | `HTMLElement \| null` | 源位遮罩 DOM | 不变 |
| `ghostEl` | `HTMLElement \| null` | ghost 元素 | 不变 |
| `dropLineEl` | `HTMLElement \| null` | 落点指示线 | 不变 |
| `currentTargetPos` | `number \| null` | 当前目标块位置 | 不变 |
| `currentPlacement` | `"before" \| "after" \| null` | 插入方向 | 不变 |
| `pointerId` | `number \| null` | 捕获的 pointer ID | 不变 |
| `rafId` | `number \| null` | rAF 帧 ID | 不变 |
| `latestPointerX` / `latestPointerY` | `number` | 最新指针坐标 | 不变 |

**REQ-087 新增状态**：

| 状态名 | 类型 | 说明 |
|--------|------|------|
| `ghostOffsetX` / `ghostOffsetY` | `number` | ghost 相对于指针的偏移量（`pointerdown` 时记录），用于消除首次 `pointermove` 跳变 |

**状态通信方式**：全部为 `DropOverlayView` 实例内部状态，无跨组件通信。

---

## 七、数据流设计

```
pointerdown（拖拽手柄）
  │
  ├─ 找到 sourceBlock DOM + ProseMirror 位置
  ├─ 记录 ghostOffsetX/Y = clientX/Y - rect.left/top  ← REQ-087 新增
  ├─ 创建 ghost 元素（cloneNode，fixed 定位，opacity:0.6）
  ├─ 创建源位遮罩（独立 div，rgba(255,255,255,0.55)，z-index:99）
  ├─ document.body.style.userSelect = "none"
  └─ setPointerCapture(pointerId)

pointermove（rAF 节流，每帧最多一次）
  │
  ├─ 更新 ghost 坐标：left = clientX - ghostOffsetX, top = clientY - ghostOffsetY  ← REQ-087 优化
  ├─ hit-test：编辑器水平中心 + 钳制 Y → getBlockPosFromPoint
  ├─ 跳过源块自身命中
  ├─ 判断上/下半区（clientY vs rect.top + rect.height/2）
  ├─ 计算挤压范围（Y 坐标比较，draggingDown 方向）
  ├─ 应用 translateY(±sourceHeight) + transition: 150ms ease
  └─ 更新落点指示线（position:fixed，宽度对齐 blockOuter）

keydown Escape  ← REQ-087 新增
  │
  └─ cleanupDrag()（清理所有视觉元素，不提交事务）

pointerup
  │
  ├─ 捕获 targetPos / placement / sourceBlockPos（在 cleanupDrag 前）
  ├─ cleanupDrag()（清理 ghost、遮罩、挤压、落点线、userSelect）
  ├─ 解析 sourceBlock / targetBlock（从 editor.document）
  ├─ 跳过 sourceBlock.id === targetBlock.id
  └─ 提交：editor.removeBlocks + editor.insertBlocks（try/catch 保护）

pointercancel
  │
  └─ cleanupDrag()（不提交事务）

destroy()
  │
  └─ 移除所有事件监听器（pointer + keydown + dragstart）+ cleanupDrag
```

---

## 八、接口契约

**`dropOverlayPlugin` 工厂函数签名不变**：

```typescript
// web/src/components/editor/dropOverlayPlugin.ts
export function dropOverlayPlugin(editor: BlockNoteEditor<any, any, any>): Plugin
```

**现有 CSS 类**（已在 REQ-086 中添加，REQ-087 不变）：

```css
/* .bn-drag-ghost — ghost 元素 */
.bn-drag-ghost {
  position: fixed;
  pointer-events: none;
  opacity: 0.6;
  z-index: 100;
}

/* .bn-drop-line — 蓝色插入指示线 */
.bn-drop-line {
  position: fixed;
  pointer-events: none;
  z-index: 100;
  height: 2px;
  background: rgba(59, 130, 246, 0.9);
  border-radius: 1px;
}
```

**REQ-087 可选 CSS 增强**：

```css
/* ghost 立体阴影（可选） */
.bn-drag-ghost {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-radius: 4px;
}
```

**保留的内部函数**（零修改）：
- `handleMultiColumnDrop`：分栏创建 + ISS-048 regular 修复
- `getBlockPosFromPoint`：三级回退 hit-test
- `findBlockById`：文档树递归查找
- `lastDragoverSide`：模块级变量，供 `handleMultiColumnDrop` 读取

---

## 九、可复用组件 / 公共逻辑识别

| 候选项 | 当前位置 | 复用场景 | 提取建议 |
|--------|---------|---------|---------|
| `getBlockPosFromPoint` | `dropOverlayPlugin.ts` | pointer events 路径 + HTML5 drop 路径共用 | 留原位，已是模块内共享函数 |
| ghost 创建/销毁逻辑 | `dropOverlayPlugin.ts` | 仅此一处 | 留原位，单次使用不抽象 |
| rAF 节流 wrapper | `dropOverlayPlugin.ts` | 仅此一处 | 留原位，无跨模块复用场景 |
| Escape 取消逻辑 | `dropOverlayPlugin.ts`（新增） | 仅此一处 | 留原位 |

**提取决策**：不提取。所有逻辑仅在 `dropOverlayPlugin.ts` 内使用，提取无复用价值。

---

## 十、方案对比

### 10.1 Ghost 偏移策略

| 维度 | 方案 A：左上角跟随（当前） | 方案 B：居中偏移（推荐） |
|------|--------------------------|------------------------|
| 描述 | ghost 以 `(clientX, clientY)` 为左上角定位 | ghost 以 `(clientX - offsetX, clientY - offsetY)` 定位，指针位于 ghost 内部 |
| 优点 | 实现简单 | 视觉上指针位于 ghost 中心区域，更自然；消除首次 pointermove 跳变 |
| 缺点 | 指针位于 ghost 左上角，视觉不自然；首次 pointermove 时 ghost 从源块位置跳到指针位置 | 需额外记录 `offsetX/Y` |
| 推荐 | ❌ | ✅ |

**推荐方案**：方案 B。`pointerdown` 时记录 `offsetX = clientX - rect.left, offsetY = clientY - rect.top`，后续 ghost 定位使用 `(clientX - offsetX, clientY - offsetY)`。实现仅需新增 2 个实例变量 + 修改 2 行定位代码。

### 10.2 Escape 取消实现

**唯一解**：在 `constructor` 中注册 `document.addEventListener("keydown", ...)`，`destroy` 中移除。`Escape` 按下时若 `isDragging` 为 `true`，调用 `cleanupDrag()`。

**与 `pointercancel` 的区别**：
- `pointercancel`：浏览器触发（如触摸中断、模态对话框弹出），自动清理
- `Escape`：用户主动取消，需手动监听键盘事件

两者均调用 `cleanupDrag()`，不提交事务。

---

## 十一、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| ghost 偏移量计算在 React re-render 后源块尺寸变化时偏移失效 | 低 | 低 | 偏移量基于 `pointerdown` 时刻的 `rect`，后续 ghost 定位仅依赖 `clientX/Y` 和固定偏移量，不受源块尺寸变化影响 |
| Escape 监听器在编辑器卸载后残留 | 低 | 中 | `destroy()` 中移除 `keydown` 监听器（与 pointer 监听器一同管理） |
| columnList 作为目标时 pointer events 路径的 `insertBlocks` 将块插入 column 内部而非同级 | 中 | 中 | 在 `onPointerUp` 中检测目标块是否在 column 内，若是则提升 `placement` 到 columnList 级别（参考 `handleMultiColumnDrop` L110-117 的 column 提升逻辑） |
| 源块在 column 内部时 `data-id` 重查找失败（当前仅搜索 `topLevelBlockOuters`） | 低 | 中 | 扩展重查找范围：先搜 `topLevelBlockOuters`，再搜 `allBlockOuters`（当前已实现 L564），但需同步更新 `sourceBlockPos`（ProseMirror 位置可能因 React re-render 变化） |
| ghost 的 `cloneNode(true)` 克隆了 BlockNote 的事件监听器（React 合成事件） | 低 | 低 | `cloneNode` 不克隆 JS 事件监听器，仅克隆 DOM 结构和内联属性；ghost 设置了 `pointer-events: none`，即使有残留监听器也不会触发 |
| 遮罩尺寸不随源块变化更新 | 低 | 低 | 遮罩在 `pointerdown` 时创建，拖拽期间源块高度通常不变（内容不变）；若确实变化（如 React re-render 改变布局），遮罩可能不完全覆盖，但视觉影响小 |

---

## 十二、工程师任务拆分表

> 供研发负责人直接使用，每行对应一个委派任务。

| # | 任务描述 | 负责角色 | 涉及文件 | 依赖 | 可并行 |
|---|---------|---------|---------|------|--------|
| T1 | **Escape 键取消拖拽**：`DropOverlayView` 构造函数中注册 `document.addEventListener("keydown", ...)`；`Escape` 按下且 `isDragging` 时调用 `cleanupDrag()`；`destroy()` 中移除监听器 | 工程师 | `dropOverlayPlugin.ts` | — | ❌ |
| T2 | **Ghost 偏移量优化**：`pointerdown` 时记录 `ghostOffsetX = clientX - rect.left, ghostOffsetY = clientY - rect.top`；`pointermove` 中 ghost 定位改为 `(clientX - ghostOffsetX, clientY - ghostOffsetY)`；可选：CSS 添加 `box-shadow` 立体阴影 | 工程师 | `dropOverlayPlugin.ts`、`Editor.css` | — | ✅（与 T1 并行） |
| T3 | **ColumnList 目标命中修复**：`onPointerUp` 中检测目标块是否在 column 内部（`resolved.parent.type.name === "column"`），若是则将 `placement` 提升到 columnList 级别；确保 `insertBlocks` 将块插入到 columnList 同级而非 column 内部 | 工程师 | `dropOverlayPlugin.ts` | — | ✅（与 T1/T2 并行） |
| T4 | **源块 column 内重查找修复**：扩展 `onPointerMove` 中源块 `data-id` 重查找逻辑，当 `topLevelBlockOuters` 中找不到时，在 `allBlockOuters` 中找到后同步更新 `sourceBlockPos`（通过 `getBlockPosFromPoint` 重新解析 ProseMirror 位置） | 工程师 | `dropOverlayPlugin.ts` | — | ✅（与 T1/T2/T3 并行） |
| T5 | **验收回归**：场景矩阵全覆盖（REQ-087.md §场景矩阵）；Escape 取消验证；ghost 偏移视觉验证；columnList 目标拖拽验证；ISS-048 回归（拖拽后无前导空白）；`tsc --noEmit` 零错误 | 测试执行者 | — | T1+T2+T3+T4 | ❌ |

---

## 十三、模块列表

本次涉及以下模块（后续所有角色按此命名产出摘要文件）：

| 模块名称 | 模块描述 | 摘要文件举例 |
|---------|---------|------------|
| editor | 编辑器插件与样式（`web/src/components/editor/`） | arch-frontend.md / eng-editor.md |

> 说明：`editor` 模块已在现有摘要体系中使用（`docs/summaries/eng-editor.md` 已存在），本次变更沿用此模块划分。

---

## 十四、回归影响分析

本次变更影响以下回归点（测试执行者回归时必须覆盖）：

| 回归点 | 受影响模块 | 回归优先级 |
|--------|----------|-----------|
| 普通块拖拽排序（向上/向下，上/下半区命中） | `editor/dropOverlayPlugin.ts` | P0 |
| ghost 跟随视觉（偏移量自然，无跳变） | `editor/dropOverlayPlugin.ts` | P0 |
| Escape 取消拖拽（所有视觉元素清除，块回原位） | `editor/dropOverlayPlugin.ts` | P0 |
| 拖拽后文本无前导空白（ISS-048 回归） | `editor/dropOverlayPlugin.ts` | P0 |
| 分栏创建：left/right drop → columnList | `editor/dropOverlayPlugin.ts` | P0 |
| 拖拽到 columnList 目标（块插入到 columnList 同级） | `editor/dropOverlayPlugin.ts` | P1 |
| 拖拽 column 内部块（源块重查找正确） | `editor/dropOverlayPlugin.ts` | P1 |
| pointercancel 后块回原位，无残留 DOM | `editor/dropOverlayPlugin.ts` | P1 |
| 连续 10 次拖拽无 DOM 泄漏 | `editor/dropOverlayPlugin.ts` | P1 |
| `tsc --noEmit` 零错误 | `web/src/components/editor/` | P0 |

---

## 十五、ISS-048 修复方案确认

**修复位置**：`handleMultiColumnDrop` L144-186（`side === "regular"` 分支）

**修复逻辑**：
1. 从 `dataTransfer` 的 `blocknote/html` 中提取 `data-id`，通过 `findBlockById` 在 `editor.document` 树中查找原始 block（避免 `nodeToBlock` 生成新 ID 导致 `removeBlocks` 失败）
2. 解析目标 block：若命中 `columnList` 节点则以其自身为目标；否则通过 `getNearestBlockPos` + `getBlockInfo` + `nodeToBlock` 解析
3. 判断上下半区（`event.clientY < rect.top + rect.height / 2`）
4. 调用 `editor.removeBlocks([draggedBlock])` + `editor.insertBlocks([draggedBlock], targetBlock, placement)`
5. 返回 `true`（告知 ProseMirror 已处理，跳过默认 `replaceRange` 路径）

**评审结论**：✅ 修复方案正确且已实现。BlockNote API 操作 Block 对象而非 ProseMirror Slice，不经过有问题的 `parseFromClipboard` / `replaceRange` 路径，从根本上规避了 ISS-048 根因（`onDragStart` 重建的 `view.dragging.slice` 中 `openStart=0, openEnd=0` 导致的空白字符问题）。

**与 pointer events 路径的关系**：pointer events 路径的 `onPointerUp` 同样使用 `removeBlocks` + `insertBlocks`，两条路径行为一致。`handleMultiColumnDrop` 仅在 HTML5 drag 路径触发（`dragstart` → `dragover` → `drop`），pointer events 激活时 `dragstart` 被 `preventDefault` 阻止，不会触发 `handleMultiColumnDrop`。

---

## 十六、总结

REQ-087 的核心视觉增强需求（FR-1~FR-5）已在 REQ-086 的 pointer events 实现中完成主体逻辑。本次评审识别出 4 个待补齐项：

1. **Escape 键取消**（T1）：需求明确要求，当前缺失
2. **Ghost 偏移量优化**（T2）：消除首次 pointermove 跳变，提升视觉体验
3. **ColumnList 目标命中**（T3）：确保拖拽到 columnList 时块插入到正确层级
4. **源块 column 内重查找**（T4）：覆盖 column 内部块拖拽的 React re-render 场景

4 个任务可完全并行执行，总改动量约 50–80 行，均在 `dropOverlayPlugin.ts` 单文件内。不涉及后端、DB、或其他前端模块。
