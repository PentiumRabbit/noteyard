# ISS-002 研发负责人委派登记表

| # | 委派给 | 任务描述 | 验收标准 | 前置 | 交付清单路径 | 预期交付时间（下级填）| 延期次数 | 状态 |
|---|--------|---------|---------|------|------------|---------------------|---------|------|
| 1 | 模块工程师 | ISS-002 方案 A 实现：修复 ColumnsBlock render props + 扩展 mini-editor schema | 1. 崩溃不再复现；2. 列内斜杠菜单可插入所有自定义块；3. columns 类型不出现在列内斜杠菜单；4. 现有测试全部通过 | — | docs/tasks/ISS-002-engineer-checklist.md | 2026-05-01 | 0 | ✅ |
| 2 | 测试人员 | ISS-002 回归验证 | 1. columns block 不崩溃；2. 列内可插入 heading/list/code/callout 等自定义块；3. columns 不出现在列内斜杠菜单；4. 已有块类型（bookmark/embed/pdf 等）功能无回归 | #1 | docs/tasks/ISS-002-tester-checklist.md | — | 0 | ⏳ |
