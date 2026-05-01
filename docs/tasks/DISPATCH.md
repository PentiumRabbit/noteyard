# 中央调度表 (DISPATCH)

> 所有角色的委派统一在此登记。总负责人 CronCreate 每 3 分钟读取各行交付清单路径，驱动流程流转。

---

## 使用规则

**委派方**：发出委派时在「委派清单」追加一行，填写交付清单路径，状态 = ⏳  
**被委派方**：完成任务后写入交付清单文件（固定格式），并更新委派清单对应行状态 = 📬，在对话发送 `📬 交付完成 · DISPATCH#N`  
**总负责人 CronCreate**：每 3 分钟读取各行交付清单 → 触发验收 → 在交付清单写入验收结果，委派清单改 ✅  
**清除规则**：交付清单文件随 REQ/ISS 归档（N3 确认后 7 天）；DISPATCH 委派清单行归档时删除

---

## 委派清单

| ID | REQ/ISS | 委派方 | 被委派方 | 任务描述 | 登记表路径 | 交付清单路径 | 前置 | 状态 |
|----|---------|--------|---------|---------|-----------|------------|------|------|
| 1 | ISS-002 | 总负责人 | 总架构师 | columns block 崩溃根因分析 | docs/tasks/ISS-002-manager-log.md | docs/tasks/ISS-002-architect-checklist.md | — | ✅ |
| 2 | ISS-002 | 研发负责人 | 模块工程师 | 方案 A 实现：修复 ColumnsBlock render props + 扩展 mini-editor schema | docs/tasks/ISS-002-dev-lead-log.md | docs/tasks/ISS-002-engineer-checklist.md | — | ✅ |
| 3 | ISS-002 | 研发负责人 | 测试人员 | ISS-002 回归验证 | docs/tasks/ISS-002-dev-lead-log.md | docs/tasks/ISS-002-tester-checklist.md | #2 | ✅ |
