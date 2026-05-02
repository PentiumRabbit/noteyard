# Contributing to Noteyard

## 前置条件

- Go 1.21+
- Node.js 18+
- npm

## 快速启动

```bash
make dev
```

## 项目结构

```
noteyard/
├── web/        # React 前端
├── server/     # Go 后端
├── cmd/        # Go 工具命令入口（如数据库迁移脚本等）
└── docs/       # 文档
```

## 提交规范

提交信息格式：

```
type(scope): 描述
```

常用 type：`feat`、`fix`、`refactor`、`docs`、`chore`、`test`

示例：
- `feat(editor): 支持表格块`
- `fix(server): 修复并发写入竞态`
- `docs(api): 补充接口说明`

## PR 流程

1. Fork 本仓库
2. 基于 `main` 新建功能分支（例如 `feat/your-feature`）
3. 提交代码并推送到你的 Fork
4. 向本仓库 `main` 分支发起 Pull Request
5. 等待 Code Review，按反馈修改
6. 通过审查后由维护者合并

## 代码规范

**Go 后端**

提交前确保：

```bash
go vet ./...
gofmt -l .
```

无输出或警告才可提交。

**前端**

提交前确保：

```bash
cd web && npx tsc --noEmit
cd web && npm run build
```

类型检查与构建均无报错。

## 接口变更规范

禁止直接修改 API 接口定义。

若需变更接口，必须在 PR 描述中说明：

- 变更原因
- 影响范围（调用方、前端页面等）
- 是否向后兼容，若不兼容需说明迁移方案
