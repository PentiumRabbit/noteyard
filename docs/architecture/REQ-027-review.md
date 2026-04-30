# 架构评审：REQ-027 noteyard 一期核心编辑功能

**评审人**: 总架构师
**评审日期**: 2026-04-30
**关联需求**: REQ-027
**状态**: ✅ 通过（补录，实现已完成）

> 注：本文档为补录。实现阶段已完成，架构与下述设计一致，补录用于规范完整性。

---

## 一、方案对比

### 方案 A：前后端分离 + 本地 SQLite（推荐）

| 项 | 说明 |
|----|------|
| 服务端 | Go HTTP，监听 localhost:8080 |
| 存储 | SQLite，WAL 模式，Repository 接口抽象 |
| 前端 | React + Vite + BlockNote |
| 通信 | RESTful JSON API |
| **优点** | 前后端独立开发；接口抽象支持后期换 DB；BlockNote 开箱即用块编辑器 |
| **缺点** | 本地需同时运行两个进程；跨域需 CORS 配置 |

### 方案 B：嵌入式全栈（单进程）

| 项 | 说明 |
|----|------|
| 方案 | Go 服务端内嵌 React 静态产物，单端口服务 |
| **优点** | 单进程，部署简单 |
| **缺点** | 开发体验差（每次改前端需重编译）；调试困难 |

**决策**：采用方案 A。开发阶段优先，后期可通过 `go:embed` 打包为单二进制。

---

## 二、模块划分与依赖关系

```
前端 (React:5173)
  └─ API Client
       └─ HTTP ──► 后端 (Go:8080)
                      ├─ Page Handler
                      ├─ Block Handler
                      └─ Repository Interface
                              └─ SQLite Impl
                                    └─ noteyard.db
```

| 模块 | 职责 | 文件位置 |
|------|------|---------|
| 存储层 | model + Repository 接口 + SQLite 实现 | `server/internal/` |
| API 服务 | HTTP handler + 路由注册 | `server/internal/handler/` + `cmd/main.go` |
| 前端骨架 | Vite + TS + API client + 类型定义 | `web/src/` |
| 页面管理 | 侧边栏树形导航 + CRUD | `web/src/components/sidebar/` |
| 块编辑器 | BlockNote 集成 + 保存策略 | `web/src/components/editor/` |

---

## 三、核心设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 存储接口抽象 | `Repository` interface | 隔离 SQLite，支持后期替换 PostgreSQL |
| 块保存策略 | 1s 防抖 + 30s 心跳 + unmount flush + App 层切换前 flush + sendBeacon | 多层兜底，避免内容丢失（ISS-001 根因） |
| 批量保存 | `PATCH /blocks/batch` upsert | 新块第一次保存也能成功，避免纯 UPDATE 静默失败 |
| WAL 模式 | `_journal_mode=WAL` | 并发读不阻塞写，提升编辑体验 |
| 前端 order_index | `REAL` 浮点数 | 支持分数索引，拖拽排序无需重排所有记录 |

---

## 四、接口契约（禁改）

| 接口 | 约束 |
|------|------|
| `PATCH /api/blocks/batch` | 前端保存策略依赖，不得修改路径或语义 |
| `Block.id` | BlockNote 生成，服务端不得覆盖 |
| `Block.page_id` | 外键约束，不得改为可空 |
| `Page.id` | UUID，不得改为自增整数 |

---

## 五、风险

| 风险 | 等级 | 处理 |
|------|------|------|
| BlockNote 无原生 database 块 | 中 | 后续需自定义块，已规划为下一期（REQ-028+） |
| WAL 模式 sqlite3 CLI 读快照问题 | 低 | 已记录在 PROJECT.md，验证必须通过 API |
| 单连接写并发 | 低 | `SetMaxOpenConns(1)` 已限制，不得修改 |

---

## 六、实现任务拆分

| # | 角色 | 交付物 |
|---|------|-------|
| 1 | 软件工程师-A | 存储层（model + Repository 接口 + SQLite 实现 + migration） |
| 2 | 软件工程师-B | API 服务（Page/Block handler + chi 路由 + CORS） |
| 3 | 软件工程师-A | 前端骨架（Vite + React + TS + API client + 类型定义） |
| 4 | 软件工程师-B | 页面管理前端（侧边栏 + CRUD + 双击重命名） |
| 5 | 软件工程师-C | 块编辑器前端（BlockNote 集成 + 保存策略） |
| 6 | 测试工程师 | 验收测试，覆盖 REQ-027 场景矩阵全部条目 |
