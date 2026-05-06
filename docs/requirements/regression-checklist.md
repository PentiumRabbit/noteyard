# noteyard 回归清单

> 只追加，不清空。历史回归记录永久保留。

---

## 2026-05-06 · ISS-048

| 回归点 | 受影响模块 | 结果 | 来源 |
|--------|----------|------|------|
| side=regular 分支改用 BlockNote API（removeBlocks+insertBlocks），返回 true，跳过 ProseMirror 默认 replaceRange 路径 | `web/src/components/editor/dropOverlayPlugin.ts` | ✅ 通过 | ISS-048 / docs/architecture/ISS-048-review.md |
| 自身拖拽到自身保护（targetBlock.id === draggedBlock.id 时返回 true 不执行操作） | `web/src/components/editor/dropOverlayPlugin.ts` | ✅ 通过 | ISS-048 / docs/architecture/ISS-048-review.md |
| TypeScript 编译无报错（npx tsc --noEmit） | `web/src/components/editor/dropOverlayPlugin.ts` | ✅ 通过 | ISS-048 / docs/architecture/ISS-048-review.md |
| side=left/right 分栏路径代码未改动，column drop 路径结构完整 | `web/src/components/editor/dropOverlayPlugin.ts` | ✅ 通过 | ISS-048 / docs/architecture/ISS-048-review.md |
| handleMultiColumnDrop 整体结构完整（blocknote/html 守卫、column 层级提升、columnList 嵌套保护均未改动） | `web/src/components/editor/dropOverlayPlugin.ts` | ✅ 通过 | ISS-048 / docs/architecture/ISS-048-review.md |
