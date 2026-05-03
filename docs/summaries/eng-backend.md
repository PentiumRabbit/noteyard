# eng-backend 后端工程摘要

> 产出角色：后端工程师（eng-backend）
> 最后更新：2026-05-03 · dispatch #137（REQ-055 关联列 GetRow API）

---

## 1. 模块边界

**负责**：
- handler 层业务实现（HTTP 请求处理、序列化/反序列化、错误响应）
- 路由注册（server/cmd/main.go）
- 新增 handler 文件（export_handler.go、import_handler.go 等）
- schema 迁移函数实现（追加到 seed.go 的 init() 中）

**不负责**：
- repository 接口定义（由架构师定义）
- 迁移框架本身（db/migrate.go）
- model 数据结构定义（model/model.go）
- 前端代码

---

## 2. 核心数据流

### 全文搜索（REQ-071）
请求 q + limit + offset → FTS5 MATCH 查询标题（pages_fts）→ FTS5 MATCH 查询内容（blocks_fts）→ 标题匹配优先合并，去重 → 补充 page_path → 返回含 block_id 的结果列表

### 单页导出（REQ-072 T1）
请求 → 读取页面信息（PageRepository.GetByID）→ 读取块列表（BlockRepository.ListByPage）→ 转换为目标格式 → 设置 Content-Disposition 头 → 流式输出

### 全库导出（REQ-072 T2）
请求 → 读取所有非删除页面（PageRepository.ListAll，内部 WHERE deleted_at IS NULL）→ 逐页读取块列表 → 写入 archive/zip 流 → 直接写入 response body

### Markdown 块转换链路（导出，REQ-072）
块列表（flat array）→ 按 ParentBlockID 过滤根块 → 递归处理子块 → 内联样式 JSON 反序列化 → 拼接 Markdown 字符串

### Markdown 导入链路（REQ-073）
multipart/form-data 文件上传（5MB 限制）→ 验证 .md 扩展名 → 文件名去后缀为页面标题 → goldmark AST 解析 → 遍历顶层块节点生成 Block 列表 → PageRepository.Create → BlockRepository.Create 逐块写入 → 返回 page_id

### 单行查询链路（REQ-055 GetRow）
请求（database_id + row_id）→ 查询 database_rows（WHERE id=? AND database_id=? 防跨库）→ 行不存在返回 404 → 查询该行所有 cells → 计算 formula 列 → 计算 rollup 列（含批量查询关联行目标列） → 返回 row + cells map

---

## 3. 关键约束

1. **不改现有 handler 文件**：新功能只新建 handler 文件，不修改已有的 handler（FTS5 搜索为例外，直接替换 search.go 中的 LIKE 查询）
2. **路由注册在 main.go**：所有新路由在 server/cmd/main.go 中注册，参考现有模式
3. **全库导出过滤删除页面**：ListAll 已通过 deleted_at IS NULL 过滤，无需 handler 层额外处理
4. **ZIP 流式写入**：直接写 http.ResponseWriter，无临时文件，对大库友好
5. **文件名特殊字符**：`/\:*?"<>|` 替换为 `-`，空标题回退为 "untitled"，最大长度 80 字符
6. **未知块类型**：输出 `<!-- [block_type] -->` HTML 注释占位，不报错
7. **columnList/column 块**：展开子块顺序输出，列间插入空行
8. **FTS5 特殊字符转义**：用户查询词逐词拆分后用双引号包裹再拼接，避免 MATCH 语法错误；查询出错时降级返回空结果
9. **FTS5 blocks 只索引文本块**：排除 database/subpage/fileAttach/bookmark/embed/pdf/button/columnList/column 类型，触发器通过 WHEN 条件实现
10. **迁移版本追加**：新 schema 迁移以 `Version: N+1` 追加到 seed.go 的 init() 中
11. **GetRow 跨库保护**：单行查询必须同时匹配 row_id 与 database_id，防止通过有效 row_id 跨库读取数据

---

## 4. 技术选型

- 全文搜索：SQLite FTS5（modernc.org/sqlite 内置），外表模式（content=），BM25 排序
- Markdown 转换（导出）：纯 Go 字符串拼接，无外部库，零新依赖
- Markdown 解析（导入）：github.com/yuin/goldmark v1.8.2（CommonMark + GFM 扩展，AST 遍历）
- ZIP 生成：Go 标准库 `archive/zip`，直接写 ResponseWriter
- JSON 导出：标准库 `encoding/json` MarshalIndent

---

## 5. 关键文件路径

- `server/internal/handler/search.go` — 全文搜索 handler（REQ-063/REQ-071）
- `server/internal/db/seed.go` — schema 迁移函数（含 fts5Migration 版本5）
- `server/internal/handler/export_handler.go` — 单页/全库导出 handler（REQ-072）
- `server/internal/handler/import_handler.go` — Markdown 导入 handler（REQ-073）
- `server/cmd/main.go` — 路由注册入口
- `server/internal/repository/sqlite/database_repo.go` — GetRow、ListRows、rollup 计算
- `server/internal/handler/database_handler.go` — 数据库 handler（含 GetRow、ListRows、BatchUpdateCells）

---

## 6. 已实现接口

| 接口 | 用途 |
|------|------|
| GET /api/search?q=...&limit=20&offset=0 | 全文搜索（FTS5，含 block_id，标题优先排序） |
| GET /api/pages/{id}/export | 单页导出（format=markdown\|json） |
| GET /api/export | 全库导出 ZIP（format=markdown\|json） |
| POST /api/import/markdown | Markdown 文件导入（REQ-073） |
| GET /api/databases/{id}/rows/{row_id} | 查询单行（含 cells、formula、rollup 计算，跨库返回 404）|
