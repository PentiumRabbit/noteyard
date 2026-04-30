# noteyard — 项目约束

本地版 Notion 替代品。Go 服务端 + SQLite + React + BlockNote。

---

## AI 启动入口

启动时需在上下文中提供以下文件（支持自动加载则自动生效，否则手动提供）：

```
必须加载（按顺序）：
1. ai-pro/docs/engineering/rules/all.md          ← 跨角色强制规则
2. ai-pro/docs/engineering/rules/{role}.md       ← 本角色专属规则（替换 {role}）
3. 本文件（noteyard/PROJECT.md）                 ← 项目约束

可选但推荐：
4. ai-pro/docs/engineering/DELEGATION.md         ← 委派流程细则
```

角色标签对照：`[lead]` `[pm]` `[arch]` `[rd]` `[eng]` `[te]` `[td]`  
规则文件位于：`ai-pro/docs/engineering/rules/{role}.md`

---

## 快速启动

```bash
make dev        # 同时启动后端(:8080)和前端(:5173)
make install    # 仅安装前端依赖
```

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + TypeScript + Vite + BlockNote |
| 后端 | Go + chi router |
| 数据库 | SQLite（WAL 模式，外键约束开启） |

## 禁止修改的接口

- `PATCH /api/blocks/batch` — 批量 upsert，前端保存策略依赖此接口
- `Block.id` 字段 — BlockNote 生成，服务端不得覆盖
- `Block.page_id` 外键约束 — 不得改为可空

## 代码约束

- TypeScript `verbatimModuleSyntax=true`：type-only import 必须用 `import type`
- SQLite 写并发：`db.SetMaxOpenConns(1)`，不得增大
- BlockNote `replaceBlocks` 参数需 `as any`（类型过于复杂，属已知妥协）

## 测试要求

- 新增 API 端点必须有 curl 手动验证记录（写入 `docs/issues/` 或 PR 描述）
- WAL 模式下不得用 `sqlite3` CLI 直接验证写入结果，必须通过 API 查询

## 数据库位置

`~/.local/share/noteyard/noteyard.db`（由 `server/cmd/main.go` 决定，不得硬编码其他路径）
