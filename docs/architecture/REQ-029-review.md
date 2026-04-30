# 架构评审：REQ-029 Database 块前端编辑器集成

**评审人**: 总架构师
**评审日期**: 2026-04-30
**状态**: ✅ N2 通过

---

## 方案对比

| 维度 | 方案 A：BlockNote 自定义块 | 方案 B：普通块 + 外挂组件 |
|------|--------------------------|------------------------|
| 集成方式 | `createReactBlockSpec` 正规扩展 | marker hack |
| 拖拽/撤销 | ✅ 原生支持 | ❌ 不支持 |
| 类型安全 | ✅ props 类型声明 | ❌ 绕开类型系统 |
| 复杂度 | 中 | 低（短期）→ 高（长期） |
| 可维护性 | 高 | 低 |

**决策：方案 A**

---

## 任务拆分

| # | 任务 | 角色 | 交付物 |
|---|------|------|--------|
| Task-01 | 类型定义 + API client 扩展 | software-engineer-A | `types/index.ts`、`api/client.ts` |
| Task-02 | 自定义块注册 + Editor schema | software-engineer-B | `Editor.tsx` 更新 |
| Task-03 | DatabaseView 表格组件 | software-engineer-C | `components/database/` |
| Task-04 | 演示数据初始化脚本 | software-engineer-D | `scripts/seed-demo.sh` |
| Task-05 | TE 验收 | test-engineer | `docs/issues/test-report-REQ-029.md` |
