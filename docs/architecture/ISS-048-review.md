# ISS-048 前端架构评审 — 拖拽排序后文本前出现多余空白字符

| 字段 | 内容 |
|------|------|
| 评审角色 | 前端架构师（arch-frontend） |
| Dispatch | #231 |
| 上级 | 研发负责人-ISS048-续 |
| 完成时间 | 2026-05-06 |
| 关联 ISS | ISS-048 |

---

## 一、根因分析

### 现象定位

拖拽排序（非分栏边缘）完成后，目标块的文本内容前出现多余空白字符（tab 或空格），按 Delete 键可消除，DB 存储内容干净，说明问题在 drop 之后、save 之前的编辑器内存状态中。

### 事件链梳理

BlockNote 内部拖拽的完整事件链如下：

1. **dragstart**：BlockNote SideMenu 的 `onDragStart` 监听器（注册在 `document` root 上）读取 `dataTransfer.blocknote/html`，将其解析为 ProseMirror `Slice`，并手动赋值给 `view.dragging = { slice, move: true }`。
2. **drop**：ProseMirror 的 `editHandlers.drop` 调用 `handleDrop(view, event, view.dragging)`。
3. 在 `handleDrop` 内部：
   - 若 `view.dragging` 已有 `slice`，则直接使用该 slice（跳过 `parseFromClipboard`）。
   - 调用 `view.someProp("handleDrop", ...)` 遍历所有 plugin 的 `handleDrop`。
   - `dropOverlayPlugin` 的 `handleDrop`（即 `handleMultiColumnDrop`）在 `side === "regular"` 时 **返回 `false`**（第 113 行），不拦截。
   - ProseMirror 继续走默认路径：`tr.deleteSelection()`（删除原位置）→ `tr.replaceRange(pos, pos, slice)` 插入 slice。

### 根因：`onDragStart` 解析 `blocknote/html` 时使用了 `preserveWhitespace: undefined`（默认 normal），但 `data-pm-slice` 属性缺失时 ProseMirror 的 `parseFromClipboard` 会走 `Slice.maxOpen` + `closeSlice` 路径，而 BlockNote 的 `onDragStart` 直接调用 `DOMParser.parse`（而非 `parseSlice`），导致 `openStart/openEnd` 均为 0，Slice 结构与 ProseMirror 原生 dragstart 产生的 Slice 结构不同。

具体根因在 **`@blocknote/core/src/extensions/SideMenu/dragging.ts`（dist 对应 `blocknote.js` 第 12710–12723 行）**：

```js
// BlockNote onDragStart 重建 view.dragging：
const i = document.createElement("div");
i.innerHTML = t;  // t = dataTransfer.getData("blocknote/html")
const r = Ht.fromSchema(this.pmView.state.schema).parse(i, {
  topNode: this.pmView.state.schema.nodes.blockGroup.create()
});
this.pmView.dragging = {
  slice: new ee(r.content, 0, 0),  // openStart=0, openEnd=0
  move: true
};
```

而 ProseMirror 原生 `dragstart` 产生的 `view.dragging.slice` 来自 `serializeForClipboard`，其 HTML 中第一个子元素携带 `data-pm-slice="openStart openEnd ... [context]"` 属性。`parseFromClipboard` 读取该属性后调用 `addContext(closeSlice(slice, openStart, openEnd), context)`，正确还原了 Slice 的深度和上下文。

BlockNote 的 `onDragStart` 绕过了 `parseFromClipboard`，直接用 `DOMParser.parse`（而非 `parseSlice`），且 `topNode` 是 `blockGroup`。这导致 **解析出的 Slice 的 `openStart/openEnd` 为 0**，即 Slice 被视为"封闭"的（closed slice）。

当 ProseMirror 的 `handleDrop` 随后执行 `tr.replaceRange(pos, pos, slice)` 时，由于 `isNode` 判断为 false（`slice.content.childCount` 可能 > 1 或 `openStart/openEnd` 不为 0），ProseMirror 使用 `replaceRange` 而非 `replaceRangeWith`。`replaceRange` 在将 blockContainer 内容插入目标位置时，会在 blockContent 节点的开头留下一个来自 `fillBefore` 或 DOM 序列化中的空白文本节点。

### 更精确的根因定位

问题的直接来源在于 `serializeForClipboard`（`prosemirror-view` 第 2788 行）序列化时，会在 `dom.innerHTML` 中保留块之间的换行/空白，而 BlockNote 的 `onDragStart` 将这段 HTML 重新解析时（`DOMParser.parse`，`preserveWhitespace` 未设置），ProseMirror DOM 解析器在 `addTextNode` 中（`prosemirror-model` 第 2800–2815 行）对"仅含空白"的文本节点的处理逻辑如下：

```
if (/[^ \t\r\n]/.test(value)) → 保留
else → 根据 preserveWS 决定是否保留前导空白
```

当 `preserveWhitespace` 为 false（默认 normal 模式）时，前导空白会被 strip。但是 `blockGroup` 作为 `topNode` 时，其子节点 `blockContainer` 内的 `blockContent` 是 inline context，inline context 中的空白节点处理规则与 block context 不同：**inline context 下，若前面没有节点或前面节点以空白结尾，前导空白会被 strip；但若前面有非空白节点，空白会被保留为一个空格**。

在 BlockNote 的 HTML 序列化格式中，`blockContent` 的 DOM 序列化包含一个外层 `<p>` 或 `<div>`，其 `innerHTML` 在某些块类型（如 paragraph）中以换行符开头（因为 `serializeForClipboard` 的 `dom.innerHTML` 包含了块间的 `\n` 文本节点）。这个换行符在 `DOMParser.parse` 阶段被 `addTextNode` 识别为 inline context 中的前导空白，在 `openStart=0` 的封闭 Slice 中无法被正确 strip，最终作为一个空白字符（`\t` 或 ` `）插入到 blockContent 的文本内容前。

### 结论

**根因是 `dropOverlayPlugin` 的 `handleDrop` 对 `side === "regular"` 的普通拖拽返回 `false`，交回 ProseMirror 默认处理，而 ProseMirror 的默认 drop 路径使用了 BlockNote `onDragStart` 重建的 `view.dragging.slice`（`openStart=0, openEnd=0`，封闭 Slice），该 Slice 在 `replaceRange` 时因上下文信息不完整，导致 `fillBefore` 在 blockContent 节点前插入了空白文本。**

具体触发位置：
- `node_modules/@blocknote/core/dist/blocknote.js` 第 12710–12723 行（`onDragStart` 重建 `view.dragging`）
- `node_modules/prosemirror-view/dist/index.js` 第 3757–3810 行（`handleDrop` 使用 `view.dragging.slice`）
- `node_modules/prosemirror-model/dist/index.js` 第 2736–2748 行（`finish()` 中 `fillBefore` 空白处理）

---

## 二、受影响文件列表

| 文件 | 说明 |
|------|------|
| `web/src/components/editor/dropOverlayPlugin.ts` | `handleDrop` 对普通拖拽返回 `false`，触发 ProseMirror 默认路径 |
| `web/node_modules/@blocknote/core/dist/blocknote.js` | `onDragStart` 重建 Slice（只读，不修改） |
| `web/node_modules/prosemirror-view/dist/index.js` | `handleDrop` 使用 `view.dragging.slice`（只读，不修改） |

业务代码唯一需要修改的文件：`web/src/components/editor/dropOverlayPlugin.ts`

---

## 三、修复方案

### 方案选择

BlockNote 的 `onDragStart` 重建 `view.dragging.slice` 是第三方库行为，不可修改。修复必须在 `dropOverlayPlugin.ts` 中实现。

### 方案：在 `handleDrop` 中接管普通拖拽，使用 BlockNote API 完成 block 重新排序

**原理**：对于 `side === "regular"` 的普通拖拽（非分栏边缘），`dropOverlayPlugin.handleDrop` 目前返回 `false`，让 ProseMirror 走默认路径（使用有问题的 Slice）。修复方案是：**让 `handleDrop` 接管普通拖拽，使用 BlockNote 的 `editor.moveBlock` 或 `editor.insertBlocks` + `editor.removeBlocks` API 完成 block 移动，并返回 `true`（告知 ProseMirror 已处理，跳过默认路径）**。

BlockNote API 操作的是 Block 对象（而非 ProseMirror Slice），不经过有问题的 Slice 解析路径，因此不会产生空白字符。

### 具体修改

**文件**：`web/src/components/editor/dropOverlayPlugin.ts`

**修改位置**：`handleMultiColumnDrop` 函数，第 113 行 `if (side === "regular") return false;`

**修改方案**：

将 `if (side === "regular") return false;` 替换为：当 `side === "regular"` 时，提取拖拽的 block（从 `slice.content.child(0)` 解析），确定目标 block，使用 `editor.moveBlock` 或 `editor.insertBlocks` + `editor.removeBlocks` 完成 block 移动，返回 `true`。

具体步骤：

1. 在 `side === "regular"` 分支中，从 `slice` 提取 `draggedBlock`（与现有 column drop 逻辑相同，已有 `nodeToBlock` 调用）。
2. 使用 `getBlockPosFromPoint` 确定目标 block 位置（已有）。
3. 确定插入方向：若 drop 点在目标 block 上半部分则插入在目标 block 之前，下半部分则插入在目标 block 之后（使用 `rect.top + rect.height / 2` 判断 `event.clientY`）。
4. 调用 `editor.removeBlocks([draggedBlock])` 移除原 block。
5. 调用 `editor.insertBlocks([draggedBlock], targetBlock, "before" | "after")` 插入到目标位置。
6. 返回 `true`。

**注意**：`editor.moveBlock` API 在 BlockNote 中不一定存在，使用 `removeBlocks` + `insertBlocks` 组合更稳定。

### 为何此方案解决问题

- BlockNote 的 `insertBlocks` 接受 Block 对象，内部通过 `blockToNode` 将 Block 转换为 ProseMirror Node，再通过 `tr.insert` 写入文档，**不经过 `parseFromClipboard` 或 `replaceRange` 路径**，因此不会触发空白字符问题。
- 返回 `true` 后 ProseMirror 的 `handleDrop` 调用 `event.preventDefault()` 并直接返回，完全跳过有问题的 `tr.replaceRange` 路径。

---

## 四、工程师任务拆分表

| # | 任务描述 | 文件路径 | 备注 |
|---|----------|----------|------|
| T1 | 在 `handleMultiColumnDrop` 中，将 `if (side === "regular") return false` 替换为：提取 draggedBlock（复用现有 `nodeToBlock` 逻辑）、确定目标 block（复用 `getBlockPosFromPoint` + `getNearestBlockPos` + `getBlockInfo`）、判断上下半区（`event.clientY` vs `rect.top + rect.height / 2`）、调用 `editor.removeBlocks` + `editor.insertBlocks`、返回 `true` | `web/src/components/editor/dropOverlayPlugin.ts` | 核心修复，约 30–40 行 |
| T2 | 验证修复：拖拽普通段落块（paragraph/heading/quote/callout）后确认文本无前导空白 | 手动测试 + 回归 ISS-048 | 覆盖单块和多块场景 |
| T3 | 验证修复不影响分栏拖拽（column drop 路径不变，`side === "left"/"right"` 分支不动） | 手动测试 | 确保 `handleMultiColumnDrop` 中 column 路径无回归 |

---

## 五、补充说明

- 此修复不涉及后端、DB、或其他前端模块。
- `dropOverlayPlugin.ts` 中的 `DropOverlayView`（视觉 overlay 渲染）无需修改，问题仅在 `handleMultiColumnDrop` 的 `side === "regular"` 分支。
- 修复后普通拖拽完全由 BlockNote API 处理，与分栏拖拽路径一致，行为更统一。
