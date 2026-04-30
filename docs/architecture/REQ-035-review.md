# REQ-035 架构评审

**需求**: noteyard 对齐 Notion — 迭代一
**评审日期**: 2026-04-30
**状态**: ✅ 已完成（2026-04-30）

---

## 模块影响分析

| 功能 | 影响模块 |
|------|---------|
| 页面封面 | App.tsx、page_repo.go（cover 字段已存在） |
| 面包屑导航 | App.tsx、新增 Breadcrumb.tsx、page_repo.go 新增祖先链查询 |
| 分隔线 / 引用块 | Editor.tsx 斜杠菜单扩展（BlockNote 原生支持，无后端变更） |
| 数据库排序 | database_repo.go、database_handler.go、DatabaseView.tsx |
| 数据库筛选 | database_repo.go、database_handler.go、DatabaseView.tsx |
| 隐藏/显示列 | database_columns 表新增 is_hidden、DatabaseView.tsx |
| 多选列 | DBColumn type 新增 multi-select、DatabaseView.tsx |

---

## 数据模型变更

### 数据库迁移（新增迁移文件）
```sql
ALTER TABLE database_columns ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
```

### Go 模型（model.go）
```go
// DBColumn 新增
IsHidden bool `json:"is_hidden"`
// type 枚举新增 "multi-select"
```

### 无需变更
- 排序/筛选通过查询参数传递，不持久化到数据库（前端 state 维护）
- 分隔线/引用块：BlockNote 原生 defaultBlockSpecs 已包含，仅需斜杠菜单注册
- 页面封面：`pages.cover` 字段已存在，存储 Base64（简化架构，避免文件服务）

---

## 风险评估

| 风险 | 等级 | 应对 |
|------|------|------|
| 筛选公式列结果不准确 | 🟠 中 | 公式列不可筛选，UI 上禁用筛选入口 |
| Cover Base64 体积过大 | 🟠 中 | 前端上传前压缩至 800px 宽，限制 500KB |
| 面包屑递归查询性能 | 🟡 低 | 页面层级通常 ≤5，SQLite 递归 CTE 足够 |

**无高风险项，可进入实现。**

---

## 实现任务拆分

| 任务 | 功能 | 文件 | 角色 |
|------|------|------|------|
| T01 | 数据库迁移 + is_hidden 字段 | 新增迁移 SQL、model.go | 后端工程师 |
| T02 | multi-select 列类型后端支持 | model.go、database_repo.go | 后端工程师 |
| T03 | 数据库排序 API | database_repo.go、database_handler.go、client.ts | 后端工程师 |
| T04 | 数据库筛选 API | database_repo.go、database_handler.go、client.ts | 后端工程师 |
| T05 | 面包屑祖先链 API | page_repo.go、page_handler.go、client.ts | 后端工程师 |
| T06 | 页面封面上传 API | page_handler.go（PATCH cover）、client.ts | 后端工程师 |
| T07 | 分隔线 / 引用块斜杠菜单 | Editor.tsx | 前端工程师 |
| T08 | 面包屑 UI 组件 | 新增 Breadcrumb.tsx、App.tsx | 前端工程师 |
| T09 | 页面封面 UI | App.tsx、App.css | 前端工程师 |
| T10 | DB 排序 / 筛选 / 隐藏列 UI | DatabaseView.tsx、DatabaseView.css | 前端工程师 |
| T11 | 多选列 UI（标签+颜色管理） | DatabaseView.tsx、DatabaseView.css | 前端工程师 |

**执行顺序**：T01-T02 → T03-T06（并行）→ T07-T11（并行，部分依赖后端接口）
