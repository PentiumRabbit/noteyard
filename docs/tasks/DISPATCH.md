# 中央调度表 (DISPATCH)

> 所有角色的委派统一在此登记。总负责人 CronCreate 每 3 分钟读取各行交付清单路径和状态清单路径，驱动流程流转。

---

## 使用规则

**委派方**：发出委派时在「委派清单」追加一行，填写交付清单路径和状态清单路径，状态 = ⏳  
**被委派方**：完成任务后写入交付清单文件（固定格式），并更新委派清单对应行状态 = 📬，在对话发送 `📬 交付完成 · DISPATCH#N`  
**总负责人 CronCreate**：每 3 分钟读取各行交付清单 + 状态清单 → 触发验收（交付清单通过 + 状态清单整体完成状态 ✅）→ 在交付清单写入验收结果，委派清单改 ✅  
**清除规则**：交付清单文件随 REQ/ISS 归档（N3 确认后 7 天）；DISPATCH 委派清单行归档时删除

---

## 委派清单

| ID | REQ/ISS | 委派方 | 被委派方 | 任务描述 | 登记表路径 | 交付清单路径 | 状态清单路径 | 前置 | 状态 |
|----|---------|--------|---------|---------|-----------|------------|------------|------|------|
| 1 | ISS-002 | 总负责人 | 总架构师 | columns block 崩溃根因分析 | docs/tasks/ISS-002-manager-log.md | docs/tasks/ISS-002-architect-checklist.md | — | ✅ |
| 2 | ISS-002 | 研发负责人 | 模块工程师 | 方案 A 实现：修复 ColumnsBlock render props + 扩展 mini-editor schema | docs/tasks/ISS-002-dev-lead-log.md | docs/tasks/ISS-002-engineer-checklist.md | — | ✅ |
| 3 | ISS-002 | 研发负责人 | 测试人员 | ISS-002 回归验证 | docs/tasks/ISS-002-dev-lead-log.md | docs/tasks/ISS-002-tester-checklist.md | #2 | ✅ |
| 4 | ISS-003 | 总负责人 | 总架构师 | columnCellSchema 循环引用根因分析及修复方案 | docs/tasks/ISS-003-manager-log.md | docs/tasks/ISS-003-architect-checklist.md | — | ✅ |
| 5 | ISS-003 | 研发负责人 | 模块工程师 | 方案 A：从 columnCellSchema 删除 columns: ColumnsBlock | docs/tasks/ISS-003-dev-lead-log.md | docs/tasks/ISS-003-engineer-checklist.md | — | ✅ |
| 6 | ISS-003 | 研发负责人 | 测试人员 | ISS-003 回归验证 | docs/tasks/ISS-003-dev-lead-log.md | docs/tasks/ISS-003-tester-checklist.md | #5 | ✅ |
| 7 | REQ-052 | 总负责人 | PM | 需求整理：对齐 Notion columns，整理场景矩阵和验收标准 | docs/tasks/REQ-052-manager-log.md | docs/tasks/REQ-052-pm-checklist.md | — | ✅ |
| 8 | REQ-052 | 总负责人 | 研发负责人 | 架构评审：columnList/column 实现方案 | docs/tasks/REQ-052-manager-log.md | docs/tasks/REQ-052-dev-lead-checklist.md | #7 | ✅ |
| 9 | REQ-052 | 总负责人 | 研发负责人 | 实现阶段统筹：spike + 前端重构 + 迁移脚本 + 测试 | docs/tasks/REQ-052-manager-log.md | docs/tasks/REQ-052-dev-lead-impl-checklist.md | #8 | ✅ |
| 10 | REQ-052 | 研发负责人 | 总架构师 | TipTap 节点 API spike：验证 columnList/column 节点注册可用性 | docs/tasks/REQ-052-dev-lead-log.md | docs/tasks/REQ-052-architect-spike-checklist.md | — | ✅ |
| 11 | REQ-052 | 研发负责人 | 模块工程师（前端-Editor） | Editor.tsx 重构：删除 mini-editor，新增 ColumnListBlock/ColumnBlock | docs/tasks/REQ-052-dev-lead-log.md | docs/tasks/REQ-052-engineer-editor-checklist.md | #10 | ✅ |
| 12 | REQ-052 | 研发负责人 | 模块工程师（前端-序列化） | toBlockNote.ts 适配：columnList children 树 + fallback | docs/tasks/REQ-052-dev-lead-log.md | docs/tasks/REQ-052-engineer-serializer-checklist.md | #10 | ✅ |
| 13 | REQ-052 | 研发负责人 | 后端工程师（迁移脚本） | 数据迁移：006_migrate_columns.sql + migrate_columns Go 工具 | docs/tasks/REQ-052-dev-lead-log.md | docs/tasks/REQ-052-engineer-migration-checklist.md | #10 | ✅ |
| 14 | REQ-052 | 研发负责人 | 测试人员（前端-Editor） | Editor.tsx 回归验证：AC-01/AC-02/AC-04 + ISS-002/ISS-003 回归 | docs/tasks/REQ-052-dev-lead-log.md | docs/tasks/REQ-052-tester-editor-checklist.md | #11 | ✅ |
| 15 | REQ-052 | 研发负责人 | 测试人员（前端-序列化） | toBlockNote.ts 单元测试更新 + 新增 | docs/tasks/REQ-052-dev-lead-log.md | docs/tasks/REQ-052-tester-serializer-checklist.md | #12 | ✅ |
| 16 | REQ-052 | 研发负责人 | 测试人员（后端-迁移） | 迁移脚本测试：幂等 + dry-run + 回滚 | docs/tasks/REQ-052-dev-lead-log.md | docs/tasks/REQ-052-tester-migration-checklist.md | #13 | ✅ |
