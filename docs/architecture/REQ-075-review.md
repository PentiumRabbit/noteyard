# REQ-075 架构评审 — 本地化日志能力

> 适用场景：单需求增量评审
>
> 架构师: arch-REQ-075-143
> REQ: REQ-075
> 日期: 2026-05-04
> 状态: 已确认（N2）

---

## 一、需求摘要

为 noteyard 三层架构（前端 React/TypeScript、Go sidecar、Rust Tauri）引入本地化日志基础设施，以 JSON Lines 格式写入系统标准 app data 目录下的 `logs/` 子目录，并通过 lumberjack 实现文件轮转，消除当前完全无日志可查的排障困境。

---

## 二、模块影响分析

| 模块/文件 | 变更类型 | 说明 |
|-----------|---------|------|
| `web/src/lib/logger.ts` | **新增** | 前端统一日志入口，对外暴露 `debug/info/warn/error`，内部发送 HTTP 到 Go sidecar |
| `server/internal/log/` | **新增** | Go 内部日志包，初始化全局 `slog.Logger` + lumberjack，暴露 `Init(logDir string)` |
| `server/cmd/main.go` | **修改** | 启动时读取日志目录来源（CLI 参数 / 环境变量 / 默认值），调用 `log.Init()`，替换现有 `log.Printf` 为 slog |
| `server/internal/handler/log_handler.go` | **新增** | `POST /api/log` 端点，接收前端日志条目，转写至 slog |
| `src-tauri/src/lib.rs` | **修改** | 启动 sidecar 时拼接 `app_local_data_dir()` 并通过 `--log-dir` CLI 参数传入；注册 `tauri-plugin-log` |
| `src-tauri/Cargo.toml` | **修改** | 新增 `tauri-plugin-log = "2"` 依赖 |
| `src-tauri/tauri.conf.json` | **修改** | capabilities：新增 `log:default` 权限 |

**模块边界判断**：
- 新增 `server/internal/log/` 包，边界清晰，仅向外暴露初始化函数和写入函数，不进入 repository 层
- `log_handler.go` 归属 handler 层（handler → log package），符合现有分层约定，不跨边界
- Tauri 层 `lib.rs` 仅做路径获取与参数拼接，不引入新状态，属于安全扩展
- `web/src/lib/logger.ts` 为新建目录（`lib/`），不与现有 `api/`、`utils/` 目录重叠

---

## 三、功能分层设计

| 功能点 | 落层 | 理由 |
|--------|------|------|
| 前端 `logger.ts` 对外 API（debug/info/warn/error） | 业务逻辑层（lib 工具层） | 封装日志格式化与传输，不含 UI 渲染；调用方可在任意组件/hook 中导入 |
| 前端 HTTP 调用 `/api/log` | API 层（内部封装在 logger.ts） | 通信细节不暴露给调用方 |
| 前端 DEBUG 级别开发/生产切换 | 业务逻辑层（logger.ts 内部） | `import.meta.env.DEV` 控制，不污染调用方 |
| Go `internal/log` 包初始化 | 数据层（基础设施层） | 负责 lumberjack 初始化、文件路径管理、轮转配置 |
| Go `POST /api/log` 端点 | API 层（handler 层） | 接收并转写前端日志，无业务规则 |
| Go 日志路径来源抽象（见§"双场景支持"节） | 数据层（基础设施层 / main 入口） | 路径来源多样，集中在 `main.go` 解析，`log.Init` 只消费最终路径字符串 |
| Rust `tauri-plugin-log` 注册 | UI 层（Tauri 壳层） | 日志写入 `logs/tauri.log`，Rust 层自治，不与 Go 层交叉 |
| Tauri 向 sidecar 传递日志路径 | UI 层（Tauri 壳层） | 路径构建是 Tauri 层职责，不下沉到 sidecar 本身 |

---

## 四、状态管理设计

本需求**不引入新的前端 React 状态**。`logger.ts` 为纯工具模块，无 state/Context。

Go sidecar 的 `log.Logger` 为 package-level 全局变量（初始化一次，贯穿整个进程生命周期），无并发写冲突（slog + lumberjack 均线程安全）。

| 状态 | 类型 | 归属 | 共享范围 | 说明 |
|------|------|------|---------|------|
| Go 全局 logger | `*slog.Logger` | `server/internal/log` package | 整个 server 进程 | 在 `main.go` `Init()` 调用后全局可用 |

---

## 五、数据流设计

### 前端日志写入路径（场景 A，Tauri 桌面）

```
前端代码调用 logger.info("msg", fields)
  │
  ▼
logger.ts：格式化为 {ts, level, layer:"frontend", msg, ...fields}
  │  HTTP POST /api/log（JSON body）
  ▼
Go handler/log_handler.go：解析 body，验证 level
  │
  ▼
server/internal/log：以对应 slog.Level 写入 server.log（lumberjack 轮转）
```

### 前端日志降级路径（场景 B，纯 Web 无 sidecar）

```
logger.ts 调用 POST /api/log
  │  fetch 失败（connection refused / timeout）
  ▼
logger.ts 捕获错误 → 静默 fallback 至 console.warn / console.error
  （不向调用方抛出异常，不影响业务流程）
```

### Go sidecar 自身日志

```
各 handler / 业务函数调用 slog.Info / slog.Error
  │
  ▼
全局 slog.Logger（handler: lumberjack → logs/server.log）
```

### Rust Tauri 层日志

```
Rust 代码调用 log::info! / log::error!
  │
  ▼
tauri-plugin-log（targets: LogDir("tauri") + Stdout）→ logs/tauri.log
```

**API 调用策略**：前端日志写入为 fire-and-forget（不阻塞 UI）；fetch 失败时 logger.ts 内部 catch，不冒泡给调用方。

---

## 六、接口契约

### 前端 `logger.ts`

```ts
// web/src/lib/logger.ts
export function debug(msg: string, fields?: Record<string, unknown>): void
export function info(msg: string, fields?: Record<string, unknown>): void
export function warn(msg: string, fields?: Record<string, unknown>): void
export function error(msg: string, fields?: Record<string, unknown>): void
```

### Go `POST /api/log` 请求体

```ts
// 前端发送的 JSON 结构
interface LogEntry {
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  layer: "frontend";
  msg: string;
  fields?: Record<string, unknown>;
}
```

### Go `internal/log` 包公开接口

```go
// server/internal/log/log.go
func Init(logDir string) error   // 初始化全局 slog.Logger，logDir 为日志目录绝对路径
// 初始化后，直接使用标准库 slog.Info / slog.Error 等全局函数写日志
```

### Rust Tauri sidecar 参数约定

```
noteyard-server --log-dir <absolute-path-to-logs-dir>
```
- `lib.rs` 通过 `app.path().app_local_data_dir()` 构建基础路径，拼接 `/logs` 后以 `--log-dir` 传入 sidecar
- sidecar `main.go` 通过 `flag.String("log-dir", "", "...")` 解析此参数

---

## 七、双场景支持：Go 日志模块路径来源抽象

本节专项说明 constraints 中要求的"如何同时支持两种路径来源场景"。

### 场景 A — Tauri 桌面客户端

- **路径来源**：Tauri `lib.rs` 在 `setup()` 启动 sidecar 时，调用 `app.path().app_local_data_dir()` 获取系统 app data 目录，拼接 `logs/` 子目录，通过 CLI 参数 `--log-dir <path>` 传入 sidecar
- **sidecar 侧**：`main.go` 使用 `flag.String("log-dir", "", "...")` 解析，传给 `log.Init(logDir)`

### 场景 B — Go 独立服务端

- **路径来源优先级（三级回退）**：
  1. 环境变量 `NOTEYARD_LOG_DIR`（有值则直接使用）
  2. 配置文件 `config.toml` 中 `[log] dir` 字段（未来扩展点，当前可留空）
  3. 回退默认值 `./logs/`（相对于 sidecar 工作目录）
- **sidecar 侧**：`main.go` 按优先级解析，最终传入 `log.Init(logDir)`

### 抽象设计原则

`log.Init(logDir string)` **只接收最终路径字符串**，不感知路径来源（CLI 参数/环境变量/默认值）。路径来源解析逻辑全部在 `main.go` 中完成，单一职责不混入 log 包内部。

```
main.go 路径决策逻辑（优先级）：
  CLI --log-dir 非空 → 使用 CLI 值（场景 A）
    ↓ 否
  NOTEYARD_LOG_DIR 非空 → 使用环境变量（场景 B）
    ↓ 否
  回退 → ./logs/（场景 B 默认）
  
  → log.Init(resolvedLogDir)
```

### CLI 参数 vs 环境变量无冲突

Tauri 场景下，`lib.rs` 始终传入 `--log-dir`（高优先级），环境变量不干扰；独立服务端场景下，`--log-dir` 为空，优先读环境变量，形成无歧义的优先级链。

---

## 八、方案对比

### 8.1 前端日志写入方式

| 维度 | 方案 A：HTTP 调用 Go sidecar `/api/log` | 方案 B：@tauri-apps/plugin-log（Rust 层） |
|------|---------------------------------------|----------------------------------------|
| 描述 | 前端通过 fetch POST 到 Go 端点，Go 统一写文件 | 前端通过 Tauri invoke 调用 Rust 插件写文件 |
| 优点 | 日志集中（Go 层一处管理），格式统一，路径一致；不依赖 Tauri invoke，纯 Web 场景可用 | 无需 Go 额外端点；直接写 Tauri log 目录 |
| 缺点 | 需要 Go 暴露 `/api/log` 端点；网络失败需降级 | 与 Tauri 深度耦合，无 sidecar 场景（纯 Web 服务器）完全失效；日志分散在 tauri.log |
| 适用条件 | 桌面 + Web 双场景均需支持 | 仅桌面场景 |
| **推荐** | ✅ | ❌ |

**推荐方案 A，理由**：
1. noteyard 未来存在纯 Web 独立部署场景，方案 B 无法降级
2. 日志集中在 server.log，排查时不需跨文件；格式统一为 JSON Lines，便于工具解析
3. 降级方案（console fallback）实现成本极低

### 8.2 前端日志降级（纯 Web 场景）

| 维度 | 方案 A：静默 fallback 到 console | 方案 B：本地 IndexedDB 存储 |
|------|--------------------------------|--------------------------|
| 描述 | fetch 失败后 catch，降级为 `console.warn/error` | 将日志写入浏览器 IndexedDB，保持本地可查 |
| 优点 | 实现极简，0 依赖，不影响业务 | 纯 Web 场景仍有持久化日志 |
| 缺点 | 无持久化，日志随页面刷新丢失 | 实现复杂；REQ-075 明确不在范围的日志查看 UI 会变得隐性必要 |
| 适用条件 | 前端日志仅辅助排障；本期不需要持久化 | 未来 Web-only 部署有持久化需求时 |
| **推荐** | ✅ | ❌ |

**推荐方案 A，理由**：REQ-075 §不在范围明确无日志查看 UI，IndexedDB 方案带来隐性需求膨胀；console fallback 满足调试目的，不阻塞业务。

### 8.3 Go 日志框架

**唯一解**：`log/slog`（Go 1.21+ 标准库）+ `lumberjack`。

- slog 是 Go 标准库结构化日志，无额外依赖，API 稳定
- lumberjack 是 Go 生态轮转事实标准，支持 MaxSize/MaxBackups/Compress 三参数覆盖 REQ-075 全部轮转要求
- go.mod 已使用 go 1.26.2，slog 可用
- 无需方案对比，直接采用

### 8.4 Rust 日志

**唯一解**：`tauri-plugin-log`（Tauri 官方插件）。

- 与 Tauri v2 原生集成，无替代方案
- 支持 `LogTarget::LogDir` 写入系统日志目录，满足路径要求

---

## 九、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Tauri `app_local_data_dir()` 在某平台返回错误路径 | 低 | 中 | 若返回 Err，`lib.rs` 不传 `--log-dir` 参数，sidecar 回退 `./logs/`；sidecar 回退行为已定义 |
| `--log-dir` 目录无写权限 | 低 | 高 | `log.Init()` 在 `MkdirAll` 后做写测试，失败时 `Fatal`（可观测），不静默继续 |
| lumberjack 并发写崩溃 | 极低 | 高 | lumberjack 内部使用 mutex 保护 rotate；slog 全局 handler 由 Init 一次设置后只读 |
| 前端 `/api/log` 高频请求影响业务 API 延迟 | 低 | 低 | logger.ts 生产关闭 DEBUG 级别；业务场景 INFO/WARN/ERROR 频率低；handler 不阻塞返回 |
| tauri-plugin-log v2 与 tauri v2 版本不兼容 | 低 | 中 | Cargo.toml 固定主版本 `"2"`，Tauri 官方保证同主版本兼容性 |
| 开发模式（is_dev）下 sidecar 未启动，前端日志全量 fallback 到 console | 必然 | 低 | 预期行为；开发者已有 console 可见；sidecar 单独运行时日志正常写文件 |

**tauri-sidecar.md 已知坑核查结果**：
- `sidecar 启动后立即退出（端口冲突或找不到路径）`：本需求新增 `--log-dir` 参数不影响端口，路径回退已设计 ✅
- `开发模式跳过 sidecar`：现有 `lib.rs` 已用 `is_dev()` 跳过（Err 分支 + `eprintln`），本次修改不破坏 ✅
- `两个 sidecar 进程残留`：窗口 Destroyed 事件已 kill，不受本需求影响 ✅
- `bundle.targets 写成数组`：与本需求无关，已有配置正确 ✅
- `generate_context!() panic（icons RGB）`：与本需求无关 ✅

---

## 十、实现任务拆分

> 供研发负责人直接使用，每行对应一个委派任务。三条执行线可并行启动，Go 工程师完成后前端集成 T3 需等待 T1。

| # | 任务描述 | 负责角色 | 涉及文件 | 依赖 | 可并行 |
|---|---------|---------|---------|------|--------|
| T1 | 新建 `server/internal/log` 包：Init(logDir)、全局 slog handler、lumberjack 配置（MaxSize:10/MaxBackups:5/Compress:true）；更新 main.go 路径解析逻辑（CLI > 环境变量 > 默认）；替换 main.go 现有 `log.Printf` 为 slog；新增 `POST /api/log` handler；为 go.mod 添加 lumberjack 依赖 | Go 工程师 | `server/internal/log/log.go`、`server/internal/handler/log_handler.go`、`server/cmd/main.go`、`go.mod` | 无 | ✅ |
| T2 | 修改 `src-tauri/src/lib.rs`：在 `setup()` 中 `sidecar("noteyard-server")` spawn 前拼接 `--log-dir`（使用 `app.path().app_local_data_dir()`）；注册 `tauri-plugin-log`（LogTarget::LogDir("tauri") + Stdout，生产 INFO，开发 DEBUG）；更新 Cargo.toml 和 tauri.conf.json capabilities | Rust 工程师 | `src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、`src-tauri/capabilities/default.json` | 无 | ✅ |
| T3 | 新建 `web/src/lib/logger.ts`：暴露 `debug/info/warn/error`，内部格式化 JSON Lines 条目，POST 到 `/api/log`；生产关闭 DEBUG；fetch 失败 fallback 到 console | 前端工程师 | `web/src/lib/logger.ts` | T1（需要 `/api/log` 端点接口确认） | ❌ |
| T4 | T1 单元测试：`internal/log` Init 正常/路径不存在/无权限；`log_handler.go` 接收合法/非法 level 的 HTTP 请求 | Go 工程师 | `server/internal/log/log_test.go`、`server/internal/handler/log_handler_test.go` | T1 | ❌ |
| T5 | T3 单元测试：logger.ts 正常调用 / fetch 失败 fallback / 生产模式 DEBUG 不发送 | 前端工程师 | `web/src/lib/logger.test.ts` | T3 | ❌ |
| T6 | 集成验收：macOS 端到端启动验证（`~/Library/Application Support/com.noteyard.app/logs/server.log` 和 `tauri.log` 均生成，轮转参数验证，DEBUG 生产不写文件） | 测试执行者 | — | T1+T2+T3 | ❌ |

**执行线说明**：
- **Go 线**（T1 → T4）：Go 工程师独立执行，完成后通知前端工程师确认接口
- **Rust 线**（T2）：Rust 工程师独立执行，与 Go 线、前端线并行
- **前端线**（T3 → T5）：前端工程师在 T1 接口确认后启动
- **集成线**（T6）：三线全部完成后由测试执行者执行

---

## 模块列表

本次涉及以下模块（后续所有角色按此命名产出摘要文件，不得自行创建新模块划分）：

| 模块名称 | 模块描述 | 摘要文件举例 |
|---------|---------|------------|
| `log-go` | Go sidecar 日志基础设施（slog + lumberjack 初始化、路径来源抽象、/api/log 端点） | `arch-log-go.md` / `eng-log-go.md` |
| `log-frontend` | 前端日志模块（logger.ts，HTTP 转发，降级策略） | `arch-log-frontend.md` / `eng-log-frontend.md` |
| `log-tauri` | Rust Tauri 层日志（tauri-plugin-log 注册、sidecar 路径传参） | `arch-log-tauri.md` / `eng-log-tauri.md` |

---

## 回归影响分析

本次变更影响以下回归点（测试执行者回归时必须覆盖）：

| 回归点 | 受影响模块 | 回归优先级 |
|--------|----------|-----------|
| Go sidecar 正常启动（新增 flag 解析不崩溃、日志文件创建成功） | `log-go`、`server/cmd/main.go` | P0 |
| Tauri 桌面启动：sidecar 收到 `--log-dir` 参数，`logs/server.log` 和 `logs/tauri.log` 均创建 | `log-tauri`、`log-go` | P0 |
| Go 独立服务端启动（无 Tauri，无 CLI 参数）：回退到 `./logs/server.log` | `log-go` | P1 |
| 前端 `logger.info` 调用后日志写入 `server.log` | `log-frontend`、`log-go` | P1 |
| 前端在 sidecar 不可达时（fetch 失败）不抛出异常，业务流程不中断 | `log-frontend` | P1 |
| `server.log` 超过 10 MB 后自动轮转，备份文件 gzip 压缩 | `log-go` | P2 |
| DEBUG 日志在生产构建不写入文件（前端 `import.meta.env.DEV === false`） | `log-frontend` | P2 |
| 现有 `/api/pages`、`/api/blocks` 等核心接口响应不受 `/api/log` 端点影响（无性能回归） | `log-go`、`server/cmd/main.go` | P1 |

---

## 附：已知摘要命名状态

现有摘要文件与本次模块列表对比：

| 现有文件 | 本次模块列表 | 状态 |
|---------|-----------|------|
| `docs/summaries/arch-backend.md` | `log-go`（新增子模块） | 现有摘要继续有效，新增 `arch-log-go.md` 为独立模块摘要 |
| `docs/summaries/arch-frontend.md` | `log-frontend`（新增子模块） | 现有摘要继续有效，新增 `arch-log-frontend.md` 为独立模块摘要 |
| —（不存在） | `log-tauri`（全新模块） | 工程师实现后新建 `arch-log-tauri.md` |

> 现有 `arch-backend.md` 和 `arch-frontend.md` 不需要重命名，继续作为对应模块的全量架构摘要；本次新增三个专项日志模块摘要文件，命名符合规范。
