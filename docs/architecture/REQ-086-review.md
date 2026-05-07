# REQ-086 架构评审 (Architecture Review)

> **适用场景**：单需求增量评审（评估 REQ-086 对现有架构的影响、模块拆分、接口设计）。
>
> 架构师: 前端架构师（arch-frontend）
> REQ: REQ-086
> 日期: 2026-05-07
> 状态: 已确认

---

## 一、需求摘要

REQ-086 将编辑器拖拽系统从 HTML5 drag-and-drop API 完全重写为 pointer events 实现，以支持 ghost 跟随、其他块实时让位、蓝色插入指示线等 Notion 级体验；同时必须保留 ISS-048 修复引入的 `handleMultiColumnDrop` 分栏逻辑（left/right drop → columnList 创建）。

---

## 二、模块影响分析

| 模块/文件 | 变更类型 | 说明 |
|-----------|---------|------|
| `web/src/components/editor/dropOverlayPlugin.ts` | 重写 | 移除 HTML5 drag 事件监听（dragover/dragend/drop/dragleave）；新增 pointerdown/pointermove/pointerup/pointercancel 处理；实现 ghost 创建/跟随/销毁；实现 translateY 让位计算（rAF 节流）；实现 ProseMirror 事务提交；destroy() 全量清理；保留 `handleMultiColumnDrop` 分栏路径 |
| `web/src/components/editor/Editor.css` | 修改 | 新增 `.bn-drag-ghost` 样式；新增 `.bn-drop-line` 样式；旧 `.bn-drop-overlay` 填充框样式可保留（列场景备用）或移除 |

**模块边界判断**：
- 所有变更均在 `web/src/components/editor/` 模块边界内，不跨越任何其他模块
- `dropOverlayPlugin.ts` 是自包含的 ProseMirror Plugin，无对外 API 变更，与 `Editor.tsx` 的接口（`dropOverlayPlugin(editor)` 函数签名）保持不变

---

## 三、功能分层设计

| 功能点 | 落层 | 理由 |
|--------|------|------|
| FR-1 pointerdown/pointermove/pointerup/pointercancel 事件监听 | UI 层（Plugin View） | 纯事件捕获，无业务规则 |
| ghost 元素创建、坐标更新、销毁 | UI 层（Plugin View） | 纯 DOM 操作，跟随指针坐标 |
| setPointerCapture / user-select 管理 | UI 层（Plugin View） | 浏览器 API 调用，无业务逻辑 |
| FR-2 让位目标块计算（sourceBlock 与 insertionPoint 之间的块） | 业务逻辑层（Plugin View） | 需要理解文档结构和拖拽方向，含规则判断 |
| translateY 计算与应用（rAF 节流） | UI 层（Plugin View） | 纯视觉位移，值由业务逻辑层提供 |
| 蓝色指示线位置计算（上/下半区） | 业务逻辑层（Plugin View） | 需要判断 clientY 与 block 中心的关系 |
| FR-3 ProseMirror 事务提交（pointerup） | 业务逻辑层（Plugin props.handleDrop 保留路径） | 通过 BlockNote API（removeBlocks + insertBlocks）操作文档结构 |
| pointercancel 回滚（不提交事务） | 业务逻辑层（Plugin View） | 判断是否提交的规则 |
| destroy() 全量清理 | UI 层（Plugin View） | 资源释放，DOM 清理 |
| ISS-048 handleMultiColumnDrop 分栏路径 | 业务逻辑层（Plugin props.handleDrop） | 保留现有逻辑，不做修改 |

**分层规则**：
- Plugin View（`DropOverlayView` 类）负责所有指针事件监听与视觉状态管理
- Plugin props（`handleDrop`）保留 `handleMultiColumnDrop` 用于 HTML5 drag 的分栏路径（drag handle 仍触发 HTML5 dragstart，需保留此路径）

---

## 四、状态管理设计

**新增/修改的状态**（均为 `DropOverlayView` 实例私有状态）：

| 状态名 | 类型 | 归属 | 共享范围 | 说明 |
|--------|------|------|---------|------|
| `isDragging` | `boolean` | DropOverlayView | 仅本实例 | 是否处于拖拽状态 |
| `sourceBlockEl` | `HTMLElement \| null` | DropOverlayView | 仅本实例 | 被拖拽块的 DOM 元素 |
| `sourceBlockPos` | `number` | DropOverlayView | 仅本实例 | 被拖拽块在文档中的 ProseMirror 位置 |
| `ghostEl` | `HTMLElement \| null` | DropOverlayView | 仅本实例 | ghost 元素（fixed 定位，跟随指针） |
| `dropLineEl` | `HTMLElement \| null` | DropOverlayView | 仅本实例 | 蓝色横线指示元素 |
| `currentTargetPos` | `number \| null` | DropOverlayView | 仅本实例 | 当前命中的目标块位置 |
| `currentPlacement` | `"before" \| "after" \| null` | DropOverlayView | 仅本实例 | 当前插入方向 |
| `rafId` | `number \| null` | DropOverlayView | 仅本实例 | requestAnimationFrame ID，用于节流取消 |
| `pointerId` | `number \| null` | DropOverlayView | 仅本实例 | 捕获的 pointer ID |

**移除的共享状态**：
- `lastDragoverSide`（模块级变量）：在 pointer events 路径中不再需要；仅 `handleMultiColumnDrop`（HTML5 drag 路径）仍需要此变量，保留不变

**状态通信方式**：
- 全部为 `DropOverlayView` 实例内部状态，无跨组件通信
- 与 `Editor.tsx` 的接口不变（Plugin 通过 `dropOverlayPlugin(editor)` 工厂函数注入 editor 引用）

---

## 五、数据流设计

```
pointerdown（拖拽手柄）
  │
  ├─ 找到 sourceBlock DOM + ProseMirror 位置
  ├─ 创建 ghost 元素（clone sourceBlock，fixed 定位）
  ├─ sourceBlock 设置 opacity: 0.3
  ├─ document.body.style.userSelect = "none"
  └─ setPointerCapture(pointerId)

pointermove（每帧 rAF 节流）
  │
  ├─ 更新 ghost 坐标（跟随指针）
  ├─ 计算命中目标块（getBlockPosFromPoint）
  ├─ 判断上/下半区（clientY vs rect.top + rect.height / 2）
  ├─ 计算让位范围（sourceBlock 与 insertionPoint 之间的块）
  ├─ 应用 transform: translateY（± sourceBlock.height）+ transition: 150ms ease
  └─ 更新蓝色横线位置（dropLineEl 坐标）

pointerup
  │
  ├─ 清理 ghost（从 DOM 移除）
  ├─ 清理 dropLineEl（从 DOM 移除）
  ├─ 清除所有块 transform + transition
  ├─ 恢复 sourceBlock opacity
  ├─ 恢复 document.body.style.userSelect
  └─ 提交 ProseMirror 事务
       └─ editor.removeBlocks([sourceBlock])
       └─ editor.insertBlocks([sourceBlock], targetBlock, placement)

pointercancel
  │
  └─ 执行与 pointerup 相同清理，跳过事务提交

destroy()
  │
  └─ 移除所有事件监听器 + 执行全量清理（ghost、dropLine、transform、opacity、userSelect）
```

**API 调用策略**：
- 无后端 API 调用，全部为前端 DOM 操作 + ProseMirror 事务
- 事务提交通过 BlockNote API（`removeBlocks` + `insertBlocks`），不走 ProseMirror 原生 drop 路径（规避 ISS-048 根因）

---

## 六、接口契约

**`dropOverlayPlugin` 工厂函数签名不变**：

```ts
// web/src/components/editor/dropOverlayPlugin.ts
export function dropOverlayPlugin(editor: BlockNoteEditor<any, any, any>): Plugin
```

**新增 CSS 类**：

```css
/* .bn-drag-ghost — ghost 元素，position: fixed，跟随指针 */
.bn-drag-ghost {
  position: fixed;
  pointer-events: none;
  opacity: 0.6;
  z-index: 100;
  /* 宽度/坐标由 JS 动态设置 */
}

/* .bn-drop-line — 蓝色插入指示线 */
.bn-drop-line {
  position: fixed;
  pointer-events: none;
  z-index: 100;
  height: 2px;
  background: rgba(59, 130, 246, 0.9);
  /* left/top/width 由 JS 动态设置 */
}
```

**保留的内部函数**（ISS-048 约束）：
- `handleMultiColumnDrop`：签名不变，逻辑不变；left/right drop → columnList 创建路径完整保留
- `getBlockPosFromPoint`：保留，供 pointer events 路径复用
- `lastDragoverSide`：保留，供 `handleMultiColumnDrop` 读取

**`DropOverlayView` 重写**：
- 移除 `dragover`/`dragend`/`drop`/`dragleave` 监听
- 新增 `pointerdown`/`pointermove`/`pointerup`/`pointercancel` 监听（注册在 `editorView.dom` 上）
- 新增 `destroy()` 全量清理逻辑

---

## 七、可复用组件 / 公共逻辑识别

| 候选项 | 当前位置 | 复用场景 | 提取建议 |
|--------|---------|---------|---------|
| `getBlockPosFromPoint` | `dropOverlayPlugin.ts` | 已在 pointer events 路径和 HTML5 drop 路径共用 | 留原位，已是模块内共享函数 |
| ghost 创建/销毁逻辑 | `dropOverlayPlugin.ts`（新增） | 目前仅此一处 | 留原位，单次使用不抽象 |
| rAF 节流 wrapper | `dropOverlayPlugin.ts`（新增） | 目前仅此一处 | 留原位，无跨模块复用场景 |

**提取决策**：不提取。所有新增逻辑仅在 `dropOverlayPlugin.ts` 内使用，提取为独立文件无复用价值，增加维护成本。

---

## 八、方案对比

### 8.1 pointer events 注册位置

| 维度 | 方案 A：注册在 `editorView.dom` | 方案 B：注册在 `document` |
|------|-------------------------------|--------------------------|
| 描述 | `pointerdown` 等事件监听在编辑器 DOM 节点上 | 监听在 document 上 |
| 优点 | 事件自动限定在编辑器区域；`destroy()` 时只需在 `editorView.dom` 上移除 | 可捕获编辑器外的 pointermove（拖出编辑器边界时） |
| 缺点 | 拖拽到编辑器外部时可能丢失 pointermove（但 setPointerCapture 解决此问题） | 需要手动过滤非编辑器区域事件；destroy 时需记录 document 上的监听器引用 |
| 适用条件 | 使用 setPointerCapture 确保捕获 | 不使用 setPointerCapture 的降级场景 |
| 推荐 | ✅ | ❌ |

**推荐方案**：方案 A（注册在 `editorView.dom`）
**推荐理由**：`setPointerCapture` 确保 `pointermove`/`pointerup` 事件在指针离开元素后仍能被捕获，方案 A 更简洁且 destroy 清理更安全。

### 8.2 让位计算时机

| 维度 | 方案 A：每次 pointermove 直接计算 | 方案 B：rAF 节流，每帧最多计算一次 |
|------|----------------------------------|----------------------------------|
| 描述 | pointermove 回调直接执行让位计算和 DOM 更新 | pointermove 仅记录最新坐标，rAF 回调执行计算 |
| 优点 | 实现简单 | 50+ 块时无卡顿；与浏览器渲染帧对齐，视觉更流畅 |
| 缺点 | 高频 pointermove 可能导致卡顿（50+ 块场景） | 实现稍复杂（需管理 rafId） |
| 适用条件 | 文档块数少 | 任意块数，尤其 50+ 块 | 
| 推荐 | ❌ | ✅ |

**推荐方案**：方案 B（rAF 节流）
**推荐理由**：需求文档明确要求 50+ 块无卡顿，rAF 节流是标准方案，实现复杂度可控（仅需 `cancelAnimationFrame` + 重新 `requestAnimationFrame`）。

### 8.3 ISS-048 handleMultiColumnDrop 保留策略

**唯一解**：`handleMultiColumnDrop` 必须完整保留，不做任何修改。

原因：
1. REQ-086 只重写 pointer events 拖拽引擎（普通块排序），分栏创建（left/right drop）是 HTML5 drag-and-drop 的专属路径，通过 BlockNote 的 drag handle 触发 `dragstart`，最终走 ProseMirror `handleDrop` prop。
2. pointer events 拖拽路径（pointerdown 在手柄上）与 HTML5 drag 路径（dragstart 在手柄上）是两条独立路径，可以共存。
3. `handleMultiColumnDrop` 中的 `side === "regular"` 分支（ISS-048 修复的核心）已正确处理普通拖拽，pointer events 路径不经过此分支，无冲突。

---

## 九、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| pointer events 与 HTML5 drag 路径同时触发（手柄同时触发 pointerdown 和 dragstart） | 中 | 高 | `pointerdown` 回调中检查目标元素是否为拖拽手柄（BlockNote 手柄 CSS 类），仅在手柄上激活；`dragstart` 路径不受影响 |
| setPointerCapture 在某些浏览器/Tauri WebView 不可用 | 低 | 低 | 降级处理：try/catch，失败时不捕获，pointermove 仍可工作但可能在边缘丢失事件；不崩溃 |
| destroy() 时 ghost/dropLine 已被手动移除（重复移除） | 低 | 低 | 移除前检查 `el.isConnected` 或 `el.parentNode`，幂等操作 |
| 50+ 块场景下 translateY 计算触发大量重排 | 中 | 中 | 批量读取 getBoundingClientRect（在 rAF 回调开头统一读取），然后统一写入 transform，避免强制同步布局 |
| pointerup 触发两次（部分浏览器行为） | 低 | 中 | `isDragging` flag 保护：第一次 pointerup 将 `isDragging` 置 false，第二次直接 return |
| ProseMirror 事务提交失败（并发修改） | 低 | 中 | try/catch 包裹 `removeBlocks` + `insertBlocks`，失败时执行视觉回滚（清理 ghost/transform/opacity），不崩溃 |
| 编辑器卸载时 ghost/dropLine 残留 | 低 | 中 | `destroy()` 必须覆盖所有临时 DOM 清理，已在接口契约中强制要求 |

---

## 十、实现任务拆分

> 供研发负责人直接使用，每行对应一个委派任务。

| # | 任务描述 | 负责角色 | 涉及文件 | 依赖 | 可并行 |
|---|---------|---------|---------|------|--------|
| T1 | FR-1：pointer events 拖拽引擎基础——pointerdown（找 sourceBlock DOM + pos，创建 ghost，设 opacity，setPointerCapture，user-select）；pointermove（更新 ghost 坐标，rAF 节流框架）；pointerup/pointercancel（清理 ghost、opacity、user-select，isDragging 保护） | 工程师 | `dropOverlayPlugin.ts` | — | ❌（串行基础） |
| T2 | FR-2：其他块实时让位——pointermove 中计算命中目标块（复用 getBlockPosFromPoint）、上/下半区判断、translateY 让位范围计算、应用 transform + transition 150ms；蓝色横线指示线（创建 dropLineEl，实时更新坐标）；Editor.css 新增 `.bn-drag-ghost` 和 `.bn-drop-line` 样式 | 工程师 | `dropOverlayPlugin.ts`、`Editor.css` | T1 | ❌ |
| T3 | FR-3：ProseMirror 事务提交与全量清理——pointerup 提交（editor.removeBlocks + editor.insertBlocks，try/catch 回滚）；pointercancel 跳过提交；destroy() 全量清理（ghost、dropLine、transform、opacity、userSelect、事件监听器） | 工程师 | `dropOverlayPlugin.ts` | T2 | ❌ |
| T4 | 验收回归——场景矩阵全覆盖（REQ-086.md §场景矩阵）；ISS-048 回归（分栏创建 left/right drop 路径）；tsc --noEmit 零错误 | 测试执行者 | — | T3 | ❌ |

---

## 模块列表

本次涉及以下模块（后续所有角色按此命名产出摘要文件）：

| 模块名称 | 模块描述 | 摘要文件举例 |
|---------|---------|------------|
| editor | 编辑器插件与样式（`web/src/components/editor/`） | arch-frontend.md（本模块归入前端架构摘要）/ eng-editor.md |

> 说明：`editor` 模块已在现有摘要体系中使用（`docs/summaries/eng-editor.md` 已存在），本次变更沿用此模块划分。

---

## 回归影响分析

本次变更影响以下回归点（测试执行者回归时必须覆盖）：

| 回归点 | 受影响模块 | 回归优先级 |
|--------|----------|-----------|
| 普通块拖拽排序（向上/向下，上/下半区命中） | `editor/dropOverlayPlugin.ts` | P0 |
| 拖拽后文本无前导空白（ISS-048 回归） | `editor/dropOverlayPlugin.ts` | P0 |
| 分栏创建：left/right drop → columnList（ISS-048 核心路径） | `editor/dropOverlayPlugin.ts` | P0 |
| 分栏内拖拽：向已有 columnList 添加新列 | `editor/dropOverlayPlugin.ts` | P1 |
| pointercancel 后块回原位，无残留 DOM | `editor/dropOverlayPlugin.ts` | P1 |
| 50+ 块文档快速拖拽无卡顿 | `editor/dropOverlayPlugin.ts` | P1 |
| 编辑器卸载时无内存泄漏（ghost/transform 清理） | `editor/dropOverlayPlugin.ts` | P1 |
| tsc --noEmit 零错误 | `web/src/components/editor/` | P0 |

---

## ISS-048 columnList 保留方案说明

**约束来源**：ISS-048 修复（dispatch #231）在 `handleMultiColumnDrop` 中实现了 left/right drop → 分栏创建逻辑，是当前分栏功能的唯一入口。

**保留策略**：
1. `handleMultiColumnDrop` 函数体**零修改**，包括 `side === "regular"` 分支、`side === "left"/"right"` 分支、`lastDragoverSide` 读取逻辑。
2. `lastDragoverSide` 模块级变量**保留**，仍由 `DropOverlayView` 的 `dragover` 事件（若保留）或独立的 dragover 监听器写入。
3. **关键设计决策**：pointer events 路径（pointerdown 在手柄上触发）与 HTML5 drag 路径（dragstart 在手柄上触发）**可以共存**。当用户拖拽时，浏览器同时触发 pointerdown 和 dragstart；pointer events 路径处理视觉效果（ghost + 让位），HTML5 drag 路径的 `handleDrop` 处理分栏逻辑。两条路径通过 `isDragging` 状态隔离，互不干扰。
4. `DropOverlayView` 中的 `dragover`/`dragleave` 监听器**保留**（用于维护 `lastDragoverSide` 和分栏 overlay 视觉），`drop`/`dragend` 监听器可保留（用于清理 overlay）。

**工程师实现要点**：不得删除 `handleMultiColumnDrop` 函数；不得删除 `lastDragoverSide` 变量；不得删除 `DropOverlayView` 中的 `dragover` 事件监听。
