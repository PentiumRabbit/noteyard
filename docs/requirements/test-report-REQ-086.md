# 测试报告 — REQ-086 拖拽排序视觉反馈增强

| 字段 | 内容 |
|------|------|
| 测试时间 | 2026-05-07 |
| 测试执行者 | test-runner-REQ086 (DISPATCH#250) |
| 测试类型 | 静态验证（代码审查 + tsc） |
| 覆盖用例总数 | 12（场景矩阵）+ 8（验收标准）= 20 |
| 通过数 | 20 |
| 失败数 | 0 |

---

## 1. tsc --noEmit

命令：`cd web && npx tsc --noEmit`

结果：**零错误，零警告**（无任何输出）

---

## 2. 代码静态审查结果

### 2.1 pointerdown

- 手柄识别：`target.closest('[data-test="dragHandle"]')` — 正确
- sourceBlock 识别：`target.closest("[data-node-type='blockOuter']")` — 正确
- ProseMirror 位置解析：`getBlockPosFromPoint(center of blockOuter rect)` — 正确，避免边缘 miss
- ghost 创建：clone blockOuter，`bn-drag-ghost` 类，fixed 定位，opacity 0.6 — 正确
- sourceBlock 半透明：`opacity = "0.3"` — 正确
- user-select 禁用：`document.body.style.userSelect = "none"` — 正确
- setPointerCapture：try/catch 降级处理 — 正确

### 2.2 pointermove

- isDragging 守卫 — 正确
- 坐标记录 + rAF 节流（`if (this.rafId !== null) return`）— 正确，每帧最多一次
- ghost 跟随：`ghostEl.style.left/top = clientX/Y` — 正确
- 命中目标块：`getBlockPosFromPoint` 复用 — 正确
- 源块自身判断：`targetPos === this.sourceBlockPos` 时清理并 return — 正确
- 上/下半区：`clientY < targetRect.top + targetRect.height / 2` — 正确
- 让位计算：批量读 rect（避免强制重排），批量写 transform — 正确
- translateY + transition 150ms ease — 正确
- dropLine 创建/更新：before=top，after=bottom — 正确

### 2.3 pointerup

- isDragging 守卫（幂等保护）— 正确；第二次触发直接 return
- cleanupDrag() 先于事务提交执行 — 正确
- 源块解析：通过 ProseMirror pos → block ID → findBlockById — 正确
- 目标块解析：getNearestBlockPos + getBlockInfo + nodeToBlock — 正确
- 自身拖拽保护：`sourceBlock.id === targetBlock.id` 时 return — 正确
- 事务提交：`removeBlocks + insertBlocks` in try/catch — 正确

### 2.4 pointercancel

- isDragging 守卫 — 正确
- 只调用 cleanupDrag()，不提交事务 — 正确

### 2.5 cleanupDrag()

| 清理项 | 实现 | 状态 |
|--------|------|------|
| rAF 取消 | `cancelAnimationFrame(this.rafId)` | ✅ |
| ghost 移除 | `isConnected` 检查 + `removeChild` + null | ✅ |
| yield transforms 清理 | `_clearYieldTransforms()`（所有 blockOuter transform/transition = ""） | ✅ |
| dropLine 移除 | `_hideDropLine()`（isConnected 检查 + removeChild + null） | ✅ |
| sourceBlock opacity 恢复 | `style.opacity = ""` | ✅ |
| userSelect 恢复 | `document.body.style.userSelect = ""` | ✅ |
| 状态重置 | isDragging/sourceBlockPos/pointerId/currentTargetPos/currentPlacement | ✅ |

### 2.6 destroy()

| 清理项 | 实现 | 状态 |
|--------|------|------|
| HTML5 drag 监听器移除 | `handlers.forEach(removeEventListener)` — dragover/dragend/drop/dragleave | ✅ |
| overlay 移除 | `removeOverlay()` | ✅ |
| pointerdown 监听器移除 | bound 引用 | ✅ |
| pointermove 监听器移除 | bound 引用 | ✅ |
| pointerup 监听器移除 | bound 引用 | ✅ |
| pointercancel 监听器移除 | bound 引用 | ✅ |
| 进行中拖拽清理 | `if (this.isDragging) cleanupDrag()` | ✅ |

---

## 3. 场景矩阵验证

| 场景 | 代码覆盖 | 结果 |
|------|---------|------|
| 向下拖拽，悬停目标块下半部分 | placement="after"，yieldDelta=-height，dropLine at bottom | ✅ |
| 向上拖拽，悬停目标块上半部分 | placement="before"，yieldDelta=+height，dropLine at top | ✅ |
| 指针悬停在源块自身 | `targetPos === this.sourceBlockPos` 分支 | ✅ |
| pointerdown 时 DOM 不存在 | `if (!blockPos) return` | ✅ |
| 文档只有 1 个块 | 无让位范围，自身拖拽保护 return | ✅ |
| 50+ 块快速移动 | `if (this.rafId !== null) return` 节流 | ✅ |
| 拖拽中编辑器卸载 | `destroy()` → `cleanupDrag()` | ✅ |
| pointerup 后立即新拖拽 | cleanupDrag() 重置全部状态 | ✅ |
| pointercancel | cleanupDrag() only，无事务 | ✅ |
| 事务提交失败 | try/catch，视觉已清理 | ✅ |
| pointermove 同帧多次 | rafId 守卫，每帧一次 | ✅ |
| pointerup 触发两次 | isDragging=false 后第二次直接 return | ✅ |

---

## 4. ISS-048 回归验证

| 验证项 | 结果 |
|--------|------|
| handleMultiColumnDrop 函数体零修改 | ✅ 确认 |
| lastDragoverSide 模块级变量保留 | ✅ 确认 |
| dragover 监听器保留（维护 lastDragoverSide） | ✅ 确认 |
| dragleave/drop/dragend 监听器保留 | ✅ 确认 |
| handleDrop prop 调用 handleMultiColumnDrop | ✅ 确认 |
| left/right drop → columnList 创建路径完整 | ✅ 确认 |

---

## 5. 潜在风险排查

| 风险 | 排查结论 |
|------|---------|
| pointer events 与 HTML5 drag 路径冲突 | 无冲突。两条路径独立：pointer path 通过 isDragging 管理视觉，HTML5 handleDrop 处理分栏逻辑，互不干扰 |
| destroy() 遗漏清理 | 无遗漏。所有 8 个监听器（4 HTML5 + 4 pointer）均通过 bound 引用正确移除；进行中拖拽由 cleanupDrag() 处理 |
| pointerup 幂等性 | 完整保护。isDragging 在 cleanupDrag() 中置 false，第二次 pointerup 在守卫处 return |

---

## 6. 遗留问题

无 P0/P1 问题。无遗留问题。

---

## 7. N3 放行结论

**放行 N3**。

所有 P0 用例通过（tsc 零错误、ISS-048 回归、场景矩阵全覆盖）；无未关闭 P0/P1 问题；cleanupDrag/destroy 无遗漏；幂等性保护完整。
