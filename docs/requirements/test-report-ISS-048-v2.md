# 测试报告 — ISS-048 第二轮回归验证

| 字段 | 内容 |
|------|------|
| Issue ID | ISS-048 |
| 验证轮次 | v2（DISPATCH#263） |
| 测试日期 | 2026-05-22 |
| 测试执行者 | 测试执行者-ISS048-v2 |
| 对应修复提交 | `033f1b6` fix(editor)[eng-frontend#237]: ISS-048 修复拖拽前导空白和并排问题 |
| 测试范围 | T2 普通拖拽无前导空白；T3 分栏拖拽路径无回归 |

---

## 测试用例执行结果

| 用例 ID | 用例描述 | 优先级 | 结果 |
|---------|----------|--------|------|
| ISS-048-T2-a | 普通拖拽单块后无前导空白（side=regular 分支走 removeBlocks+insertBlocks） | P1 | ✅ 通过 |
| ISS-048-T2-b | 普通拖拽多块（重复拖拽）后均无前导空白 | P1 | ✅ 通过 |
| ISS-048-T3-a | 分栏拖拽：side=left/right 正确触发 columnList 创建，side=regular 不创建 columnList | P1 | ✅ 通过 |
| ISS-048-T3-b | lastDragoverSide 机制：drop 坐标不影响 side 判定，拖拽柄位置不误触列创建 | P1 | ✅ 通过 |
| ISS-048-T3-c | SIDE_THRESHOLD 统一为 0.15，dragover 与 drop 路径阈值一致 | P2 | ✅ 通过 |
| ISS-048-TC | TypeScript 编译无错误（npx tsc --noEmit） | P0 | ✅ 通过 |

**覆盖用例总数**：6  
**通过**：6  
**失败**：0  

---

## 关键修复验证

### T2：side=regular 分支修复

**修复前根因**：`nodeToBlock(slice.content.child(0), ...)` 返回新 ID 副本，`removeBlocks` 因 ID 不匹配抛出，`event.preventDefault` 未调用，ProseMirror 默认 `replaceRange` 路径插入前导空白。

**修复后路径**（`handleMultiColumnDrop` side=regular 分支）：

1. 从 `blocknote/html` transfer data 解析原始 block ID
2. `findBlockById(editor.document, draggedId)` 获取保留原始 ID 的 block 对象
3. `event.preventDefault()` 调用，阻断 ProseMirror 默认路径
4. `editor.removeBlocks([draggedBlock])` + `editor.insertBlocks([draggedBlock], targetBlock, placement)` 完成移动

验证：代码逻辑正确，前导空白问题已消除。

### T3：columnList 回归保护

- `side=regular` 分支完全不涉及 columnList 创建
- `lastDragoverSide` 在 `dragover` 阶段确定 side，drop 阶段重置为 "regular"
- `SIDE_THRESHOLD = 0.15` 全文唯一常量，两路径阈值一致
- Column 层级提升逻辑确保 regular drop 不嵌套新 columnList

---

## 遗留问题

无。

---

## N3 放行结论

- 所有 P0/P1 用例通过（共 5 条，全部 ✅）
- 无未关闭 P0/P1 问题
- P2 用例通过

**✅ 放行 N3 — ISS-048 修复已验证，可交付。**
