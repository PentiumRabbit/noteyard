# arch-log-go — Go 日志基础设施摘要

> 产出角色：总架构师（arch）
> 最后更新：2026-05-04 · dispatch #144 · REQ-075

---

## 1. 模块边界

**负责**：Go sidecar 内部日志写入基础设施，包含全局 slog handler 初始化、lumberjack 文件轮转配置、日志路径来源抽象，以及接收前端日志转写的 HTTP 端点。

**不负责**：前端日志格式化与传输（`log-frontend` 职责）、Rust Tauri 层日志（`log-tauri` 职责）、业务层日志内容（各 handler 自行调用 slog 写入）。

---

## 2. 核心数据流

```
main.go 解析路径来源（优先级：CLI --log-dir > 环境变量 NOTEYARD_LOG_DIR > ./logs/）
  → log.Init(resolvedLogDir)：创建目录、初始化 lumberjack writer、设置全局 slog handler
  → 各 handler / 业务函数通过标准库 slog.Info / slog.Error 写日志
  → lumberjack 透明轮转（超过 10 MB 则轮转，保留 5 个备份，gzip 压缩）

POST /api/log（来自前端）
  → log_handler.go 解析 level/msg/fields
  → 转发至全局 slog，写入同一 server.log 文件
```

---

## 3. 关键约束

1. `log.Init()` 仅接收最终路径字符串，不感知路径来源，路径决策全部在 `main.go` 完成
2. 路径优先级：CLI 参数 `--log-dir`（Tauri 场景）> 环境变量（独立服务端场景）> 默认 `./logs/`
3. `log.Init()` 内部必须做目录创建（`MkdirAll`）和写入测试，失败时 Fatal，不静默继续
4. 日志格式：JSON Lines（slog JSON handler），不使用纯文本格式
5. 轮转：MaxSize 10 MB，MaxBackups 5，Compress true（lumberjack 配置不可省略）
6. 全局 slog.Logger 初始化后线程安全（slog + lumberjack 内部均有 mutex 保护）
7. 生产默认 INFO 级别，开发模式（环境变量控制）可降至 DEBUG；DEBUG 在生产不写文件

---

## 4. 技术选型理由

- **log/slog**：Go 1.21+ 标准库，无额外依赖，JSON handler 原生支持，API 稳定
- **lumberjack**：Go 生态轮转事实标准，MaxSize/MaxBackups/Compress 三参数覆盖全部轮转需求
- 不引入 zerolog/zap 等第三方日志框架，保持依赖最小化

---

## 5. 关键文件路径

| 文件 | 说明 |
|------|------|
| `server/internal/log/log.go` | 模块入口：Init(logDir)、全局 slog 初始化 |
| `server/internal/handler/log_handler.go` | POST /api/log 端点实现 |
| `server/cmd/main.go` | 路径来源解析、Init 调用点 |
| `go.mod` | 新增 lumberjack 依赖 |

---

## 6. 重要接口

- `log.Init(logDir string) error`：初始化全局日志，唯一公开接口；由 main.go 启动时调用一次
- `POST /api/log`：接收前端日志条目（JSON body: level/layer/msg/fields），无返回体（202 或 204）
