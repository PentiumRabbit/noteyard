# 交付记录

状态: 📬 已交付
交付时间: 2026-05-01 10:30
交付物:
  - docs/tasks/ISS-002-tester-checklist.md
摘要: ISS-002 三项修复全部通过静态验证，tsc 零错误，其他块未被误改。
验收结果: ✅ 通过
验收时间: 2026-05-01

---

## 验证结果

| # | 验收标准 | 结果 | 备注 |
|---|---------|------|------|
| 1 | ColumnsBlock render 解构中不含 `updateBlock`，所有列内保存调用均使用 `editor.updateBlock` | ✅ | 第 239 行解构为 `{ block, editor }`，`saveColBlocks`/`saveWidths` 均调用 `editor.updateBlock`（第 254、258 行） |
| 2 | `columnCellSchema` 包含项目自定义块（callout、toggle、subpage、fileAttach、bookmark、embed、pdf 等） | ✅ | 第 591-610 行，11 个自定义块全部注册：horizontalRule、quote、database、callout、toggle、columns、subpage、fileAttach、bookmark、embed、pdf |
| 3 | ColumnCell 的 BlockNoteView 设置了 `slashMenu={false}` 且有过滤 `columns` 的自定义菜单 | ✅ | 第 646 行 `slashMenu={false}`，第 655-658 行 `getItems` 过滤 `title.toLowerCase() !== "columns"` |
| 4 | `tsc --noEmit` 零错误 | ✅ | 运行无任何输出（零错误、零警告） |
| 5 | 其他自定义块（bookmark、embed、pdf、fileAttach 等）的 render props 未被误改 | ✅ | FileAttachBlock（第 365 行）、BookmarkBlock（第 412 行）、EmbedBlock（第 468 行）、PdfBlock（第 531 行）均保留原有 `updateBlock` prop，未被改动 |
