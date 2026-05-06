# ISS-048 回归测试报告

| 字段 | 内容 |
|------|------|
| 测试角色 | 测试执行者-ISS048-T2T3 |
| Dispatch | #234 |
| 测试时间 | 2026-05-06 |
| 关联 ISS | ISS-048 |
| 测试方式 | 代码审查 + 静态验证（TypeScript 编译） |
| 覆盖用例总数 | 6 |
| 通过 | 6 |
| 失败 | 0 |

---

## T2：验证修复效果

### T2-1：side=regular 分支已改用 BlockNote API

**文件**：`web/src/components/editor/dropOverlayPlugin.ts`，`handleMultiColumnDrop` 函数

**检查结果**：✅ 通过

原第 113 行 `if (side === "regular") return false;` 已替换为完整的 BlockNote API 处理路径（第 113–161 行）：

- `if (side === "regular")` 分支内，使用 `nodeToBlock` 提取 `draggedBlock`（复用现有逻辑）
- 使用 `getNearestBlockPos` + `getBlockInfo` + `nodeToBlock` 确定 `targetBlock`
- 自身拖拽保护：`if (targetBlock.id === draggedBlock.id) return true;`（第 153 行）
- 上下半区判断：`event.clientY < rect.top + rect.height / 2` → `"before"` / `"after"`（第 156 行）
- 调用 `editor.removeBlocks([draggedBlock])` + `editor.insertBlocks([draggedBlock], targetBlock, placement)`（第 158–159 行）
- 返回 `true`，告知 ProseMirror 已处理，跳过默认 `replaceRange` 路径（第 160 行）

修复原理符合 ISS-048-review.md §三方案：BlockNote API 操作 Block 对象，不经过 `parseFromClipboard` / `replaceRange` 路径，因此不触发空白字符问题。

### T2-2：TypeScript 编译无报错

**命令**：`cd web && npx tsc --noEmit`

**结果**：✅ 通过（无任何输出，退出码 0）

### T2-3：removeBlocks + insertBlocks 逻辑正确性审查

**检查结果**：✅ 通过

| 检查点 | 状态 | 说明 |
|--------|------|------|
| `slice.content.childCount` 空保护 | ✅ | 第 117 行，childCount=0 时返回 false |
| `nodeToBlock` 异常捕获 | ✅ | try/catch 包裹，失败返回 false（第 121–130 行） |
| `getNearestBlockPos` 异常捕获 | ✅ | try/catch 包裹，失败返回 false（第 134–137 行） |
| `getBlockInfo` + `nodeToBlock` 异常捕获 | ✅ | try/catch 包裹，失败返回 false（第 142–151 行） |
| 自身拖拽到自身保护 | ✅ | `targetBlock.id === draggedBlock.id` 时返回 true（第 153 行），不执行 remove/insert |
| 上下半区判断逻辑 | ✅ | `event.clientY < rect.top + rect.height / 2`，与 ISS-048-review.md §三描述一致 |
| `removeBlocks` 先于 `insertBlocks` | ✅ | 先移除再插入，避免位置偏移问题 |
| 返回 `true` 跳过 ProseMirror 默认路径 | ✅ | 第 160 行明确返回 true |

---

## T3：验证无回归

### T3-1：side=left / side=right 分栏路径代码未改动

**检查结果**：✅ 通过

`side` 判断结构如下（第 110–161 行）：

```
if (side === "regular") { ... return true; }
// ↓ 以下为 side=left/right 路径，未改动
if (node.type.name === "columnList") return false;
// ... column 分支逻辑（第 163–276 行）
```

`side=regular` 分支以 `return true` 结束，不会流入 `side=left/right` 路径。`side=left/right` 路径的所有代码（`columnList` 保护、`blockNoteType === "column"` 分支、新建 `columnList` 分支）均未修改，结构完整。

### T3-2：handleMultiColumnDrop 整体结构完整性审查

**检查结果**：✅ 通过

| 结构检查点 | 状态 | 说明 |
|-----------|------|------|
| `blocknote/html` 类型检测守卫 | ✅ | 第 85 行，非 BlockNote 拖拽直接返回 false |
| `getBlockPosFromPoint` 返回值检查 | ✅ | 第 88–91 行，null 时返回 false |
| column 层级提升逻辑 | ✅ | 第 93–103 行，未改动 |
| `nodeDOM` + `getBoundingClientRect` 检查 | ✅ | 第 106–108 行，未改动 |
| `side` 三路判断（left/right/regular）| ✅ | 第 110–112 行，未改动 |
| `columnList` 嵌套保护 | ✅ | 第 163–164 行，未改动 |
| `blockNoteType === "column"` 分支（追加列到现有 columnList）| ✅ | 第 193–243 行，未改动 |
| 新建 columnList 分支 | ✅ | 第 244–276 行，未改动 |
| 函数最终 `return true` | ✅ | 第 276 行，未改动 |

---

## 遗留问题

无 P0/P1 问题。

---

## N3 放行结论

**结论：✅ 放行**

- T2 全部通过：`side=regular` 分支已正确接管普通拖拽，使用 BlockNote API（removeBlocks + insertBlocks）完成 block 移动并返回 true，TypeScript 编译无报错，逻辑正确性审查通过
- T3 全部通过：`side=left/right` 分栏路径代码未改动，`handleMultiColumnDrop` 整体结构完整
- 无未关闭 P0/P1 问题
- ISS-048 修复可放行 N3
