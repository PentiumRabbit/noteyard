# ISS-003 研发负责人委派登记表

| # | 委派给 | 任务描述 | 验收标准 | 前置 | 交付清单路径 | 预期交付时间（下级填）| 延期次数 | 状态 |
|---|--------|---------|---------|------|------------|---------------------|---------|------|
| 1 | 模块工程师 | ISS-003 方案 A：从 columnCellSchema 删除 columns: ColumnsBlock | 1. 删除 Editor.tsx:599 一行；2. tsc --noEmit 零错误；3. 插入 columns 块不崩溃（静态验证） | — | docs/tasks/ISS-003-engineer-checklist.md | 2026-05-01 | 0 | ✅ |
| 2 | 测试人员 | ISS-003 回归验证 | 1. columns 块不崩溃；2. 列内斜杠菜单不含 columns；3. 其他自定义块功能无回归；4. tsc 零错误 | #1 | docs/tasks/ISS-003-tester-checklist.md | 2026-05-01 | 0 | ✅ |
