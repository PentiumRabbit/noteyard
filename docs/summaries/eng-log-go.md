# eng-log-go — Go sidecar 日志基础设施模块摘要

> 角色：eng-backend | 模块：log-go | REQ：REQ-075 | 更新：2026-05-04

---

## 模块边界

**负责**：
- Go sidecar 全局 slog handler 的初始化与生命周期管理
- lumberjack 文件轮转配置（MaxSize/MaxBackups/Compress）
- 日志目录的创建与路径来源解析（CLI flag > 环境变量 > 默认）
- `/api/log` 端点接收前端日志条目并写入全局 logger

**不负责**：
- 前端日志的格式化与 HTTP 发送（属于 `log-frontend` 模块）
- Rust/Tauri 层日志（属于 `log-tauri` 模块）
- 日志路径的业务决策（Tauri 层通过 `--log-dir` 参数传入，属于 Tauri 层职责）
- 日志查看 UI（不在 REQ-075 范围内）

---

## 核心数据流

**前端日志写入**：
```
前端 HTTP POST /api/log (JSON body)
  → log_handler.go 解析 level/layer/msg/fields，验证 level 合法性
  → 非法 level → 400 Bad Request
  → 合法 → slog.Log(ctx, level, msg, attrs...) 写入全局 logger
  → lumberjack 写入 logs/server.log（超限自动轮转）
```

**Go sidecar 自身日志**：
```
各 handler/业务函数调用标准库 slog.Info/slog.Error
  → 全局 slog.Logger（由 Init 设置为 JSON handler）
  → lumberjack → logs/server.log
```

**启动路径解析**：
```
main.go: --log-dir 非空 → 使用 CLI 值（Tauri 场景）
           ↓ 否
         NOTEYARD_LOG_DIR 非空 → 使用环境变量（独立服务端）
           ↓ 否
         回退 ./logs/（默认）
  → Init(resolvedLogDir)：MkdirAll + lumberjack 初始化 + slog.SetDefault
```

---

## 关键约束

- `Init` 不感知路径来源，只消费最终路径字符串；路径解析逻辑全部在 `main.go`
- `Init` 失败时 `main.go` 负责 Fatal；`Init` 本身只返回 error
- lumberjack 配置固定：MaxSize:10 MB、MaxBackups:5、Compress:true（与架构评审一致，不得随意调整）
- 全局 slog handler 在进程生命周期内只初始化一次，线程安全（slog + lumberjack 均使用内部 mutex）
- `/api/log` 非法 level（非 DEBUG/INFO/WARN/ERROR）返回 400，不写日志

---

## 技术选型

- **slog**：Go 1.21+ 标准库，无额外依赖，API 稳定，JSON 格式输出
- **lumberjack v2**（`gopkg.in/natefinch/lumberjack.v2`）：Go 生态日志轮转事实标准，直接实现 `io.Writer` 接口，可作为 slog handler 的 writer

---

## 关键文件路径

| 文件 | 职责 |
|------|------|
| `server/internal/log/log.go` | Init 函数实现，lumberjack + slog 初始化 |
| `server/internal/log/log_test.go` | Init 单元测试（正常/目录不存在/无权限） |
| `server/internal/handler/log_handler.go` | POST /api/log 端点实现 |
| `server/internal/handler/log_handler_test.go` | log handler 单元测试 |
| `server/cmd/main.go` | 路径解析逻辑、Init 调用、路由注册 |

---

## 重要接口

| 接口 | 用途 |
|------|------|
| `log.Init(logDir string) error` | 初始化全局 slog handler，main.go 在 server 启动前调用 |
| `POST /api/log` | 接收前端日志条目，level 验证后写入全局 logger |
