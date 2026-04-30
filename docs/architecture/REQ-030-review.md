# 架构评审：REQ-030 Database 块样式与交互对齐 Notion

**评审人**: 总架构师
**评审日期**: 2026-04-30
**状态**: ✅ N2 通过

---

## 影响范围

纯前端改动 + 后端补一个接口，无新模块，无架构边界变更。

| 文件 | 变更类型 |
|------|---------|
| `web/src/components/database/DatabaseView.tsx` | 重写 |
| `web/src/components/database/DatabaseView.css` | 重写 |
| `server/internal/handler/database_handler.go` | 新增 UpdateTitle handler |
| `server/cmd/main.go` | 注册新路由 |
| `web/src/api/client.ts` | 新增 updateTitle 方法 |

## 任务拆分

| # | 任务 | 角色 | 交付物 |
|---|------|------|--------|
| Task-01 | 后端 PATCH /databases/:id | software-engineer-A | handler + 路由 |
| Task-02 | CSS 重写 Notion 风格 | software-engineer-B | DatabaseView.css |
| Task-03 | 列头菜单 + 改名 + 类型修改 + 标题编辑 | software-engineer-C | DatabaseView.tsx |
| Task-04 | 行 hover 删除 + select tag | software-engineer-D | DatabaseView.tsx |
| Task-05 | TE 验收 | test-engineer | test-report-REQ-030.md |
