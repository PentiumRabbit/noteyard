# eng-backend 后端工程摘要

> 产出角色：后端工程师（eng-backend）
> 最后更新：2026-05-03 · dispatch #132（REQ-072 数据导出）

---

## 1. 模块边界

**负责**：
- handler 层业务实现（HTTP 请求处理、序列化/反序列化、错误响应）
- 路由注册（server/cmd/main.go）
- 新增 handler 文件（export_handler.go、import_handler.go 等）

**不负责**：
- repository 接口定义（由架构师定义）
- 数据库 schema 迁移（db/migrate.go）
- model 数据结构定义（model/model.go）
- 前端代码

---

## 2. 核心数据流

### 单页导出（T1）
请求 → 读取页面信息（PageRepository.GetByID）→ 读取块列表（BlockRepository.ListByPage）→ 转换为目标格式 → 设置 Content-Disposition 头 → 流式输出

### 全库导出（T2）
请求 → 读取所有非删除页面（PageRepository.ListAll，内部 WHERE deleted_at IS NULL）→ 逐页读取块列表 → 写入 archive/zip 流 → 直接写入 response body

### Markdown 块转换链路
块列表（flat array）→ 按 ParentBlockID 过滤根块 → 递归处理子块 → 内联样式 JSON 反序列化 → 拼接 Markdown 字符串

---

## 3. 关键约束

1. **不改现有 handler 文件**：新功能只新建 handler 文件，不修改已有的 handler
2. **路由注册在 main.go**：所有新路由在 server/cmd/main.go 中注册，参考现有模式
3. **全库导出过滤删除页面**：ListAll 已通过 deleted_at IS NULL 过滤，无需 handler 层额外处理
4. **ZIP 流式写入**：直接写 http.ResponseWriter，无临时文件，对大库友好
5. **文件名特殊字符**：`/\:*?"<>|` 替换为 `-`，空标题回退为 "untitled"，最大长度 80 字符
6. **未知块类型**：输出 `<!-- [block_type] -->` HTML 注释占位，不报错
7. **columnList/column 块**：展开子块顺序输出，列间插入空行

---

## 4. 技术选型

- Markdown 转换：纯 Go 字符串拼接，无外部库，零新依赖
- ZIP 生成：Go 标准库 `archive/zip`，直接写 ResponseWriter
- JSON 导出：标准库 `encoding/json` MarshalIndent

---

## 5. 关键文件路径

- `server/internal/handler/export_handler.go` — 单页/全库导出 handler（REQ-072）
- `server/internal/handler/import_handler.go` — Markdown 导入 handler（REQ-073）
- `server/cmd/main.go` — 路由注册入口

---

## 6. 已实现接口

| 接口 | 用途 |
|------|------|
| GET /api/pages/{id}/export | 单页导出（format=markdown\|json） |
| GET /api/export | 全库导出 ZIP（format=markdown\|json） |
| POST /api/import/markdown | Markdown 文件导入（REQ-073） |
