# ISS-018 动态端口改造 — 架构评审

| 字段 | 内容 |
|------|------|
| Issue | ISS-018 |
| 评审人 | arch（总架构师） |
| dispatch | #150 |
| 日期 | 2026-05-04 |
| 状态 | 已完成 |

---

## 一、问题背景

Go sidecar 端口硬编码 8080，残留进程导致新实例启动时端口冲突崩溃。需改为三层协作的动态端口机制：

```
Tauri 层（Rust）
  ↓ 分配空闲端口 N
  ↓ --port N 传给 sidecar
Go sidecar
  ↓ 监听 127.0.0.1:N
  ↓ N 存入 State
前端（React）
  ↓ invoke("get_port") → N
  ↓ 动态构建 API base URL
```

---

## 二、模块列表

| 模块 | 涉及文件 |
|------|---------|
| tauri-port | `src-tauri/src/lib.rs` |
| go-server | `server/cmd/main.go` |
| frontend-api | `web/src/api/client.ts`, `web/src/lib/logger.ts`, `web/src/components/settings/SettingsPage.tsx` |

---

## 三、Rust Tauri 层设计（tauri-port）

### 3.1 端口分配策略

使用 `std::net::TcpListener::bind("127.0.0.1:0")` 让 OS 分配空闲端口：

```rust
use std::net::TcpListener;

fn pick_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0")
        .expect("failed to bind ephemeral port");
    let port = listener.local_addr().unwrap().port();
    drop(listener); // 释放端口，sidecar 立即占用
    port
}
```

**风险**：drop 到 sidecar bind 之间存在极短 TOCTOU 窗口（约 1ms 内）。在 macOS/Linux 正常情况下可接受；极端情况下可在 sidecar 启动失败时重试（最多 3 次）。

### 3.2 State 结构扩展

新增 `PortState` 存储已分配端口，供 Tauri command 查询：

```rust
pub struct PortState(pub u16);
```

在 `run()` 中：
1. 调用 `pick_free_port()` 获得 `port: u16`
2. 将 `port` 作为 `--port <N>` 参数追加到 sidecar 命令
3. `.manage(PortState(port))` 注册到 app state

### 3.3 暴露给前端的 Tauri Command

```rust
#[tauri::command]
fn get_port(state: tauri::State<PortState>) -> u16 {
    state.0
}
```

在 `Builder::default()` 链中追加 `.invoke_handler(tauri::generate_handler![get_port])`。

### 3.4 sidecar 启动修改点（lib.rs）

原始调用：
```rust
sidecar_cmd = sidecar_cmd.args(["--log-dir", &log_dir_str]);
```

改为（在 log-dir 参数之后追加）：
```rust
sidecar_cmd = sidecar_cmd.args(["--port", &port.to_string()]);
```

完整修改范围：`src-tauri/src/lib.rs`

---

## 四、Go sidecar 层设计（go-server）

### 4.1 flag 新增

`server/cmd/main.go` 在现有 `logDirFlag` 之后追加：

```go
portFlag := flag.Int("port", 8080, "port to listen on")
```

保留 `8080` 作为 fallback（开发环境直接运行 sidecar 时仍可用）。

### 4.2 监听地址动态化

将现有硬编码替换：

```go
// 原
addr := "127.0.0.1:8080"

// 改为
addr := fmt.Sprintf("127.0.0.1:%d", *portFlag)
```

### 4.3 UploadHandler base URL 修改

`main.go` 中 `NewUploadHandler` 目前传入硬编码：

```go
uh := handler.NewUploadHandler(uploadDir, "http://localhost:8080")
```

改为动态构建：

```go
uh := handler.NewUploadHandler(uploadDir, fmt.Sprintf("http://localhost:%d", *portFlag))
```

### 4.4 CORS 白名单说明

现有 CORS 白名单：
```go
AllowedOrigins: []string{"http://localhost:5173", "http://localhost:5174", "http://localhost:3000"},
```

Tauri 应用内部的前端以 `tauri://localhost`（macOS/Windows）或 `http://localhost`（Linux）形式发出请求，不经过 8080 的 CORS 路径，**无需修改**。开发模式下 Vite 的 5173/5174 也保持不变。

完整修改范围：`server/cmd/main.go`（需 `import "fmt"`，若已有则无需新增）

---

## 五、前端层设计（frontend-api）

### 5.1 端口获取时机

前端需在任何 API 调用之前获取端口，最合适的位置是应用入口（`main.tsx` 或 `App.tsx` 最早执行处）。

使用 `@tauri-apps/api/core` 的 `invoke`：

```typescript
import { invoke } from "@tauri-apps/api/core";

async function initApiBase(): Promise<string> {
  try {
    const port = await invoke<number>("get_port");
    return `http://localhost:${port}`;
  } catch {
    // 非 Tauri 环境（开发模式直接跑前端）降级到 8080
    return "http://localhost:8080";
  }
}
```

### 5.2 API_BASE 动态化（client.ts）

当前 `client.ts` 在模块顶层定义静态常量：

```typescript
export const API_BASE = "http://localhost:8080";
```

需改为运行时可赋值的变量，并提供初始化函数：

```typescript
export let API_BASE = "http://localhost:8080"; // 默认值，会在 init 后覆盖

export function setApiBase(base: string): void {
  API_BASE = base;
}
```

`BASE` 常量改为 getter 函数或在每次 `req()` 时读取 `API_BASE`：

```typescript
// req 内部
const BASE = API_BASE + "/api";
```

（将 `BASE` 从模块级常量改为 `req` 函数内局部变量即可）

### 5.3 logger.ts 修改

```typescript
// 原
const API_LOG_URL = "http://localhost:8080/api/log";

// 改为（从 client.ts 导入）
import { API_BASE } from "./client";

// send 函数内
const url = API_BASE + "/api/log";
```

注意：`logger.ts` 中的 `send` 是同步触发 `fetch` 的，`API_BASE` 在调用时必须已经被正确设置（见 5.4）。

### 5.4 SettingsPage.tsx 修改

`SettingsPage.tsx` 中有 3 处直接硬编码 `http://localhost:8080`（行 21, 30, 185），均改为导入并使用 `API_BASE`：

```typescript
import { API_BASE } from "../../api/client";

// 替换所有 "http://localhost:8080" → API_BASE
```

### 5.5 初始化顺序（关键约束）

前端渲染任何组件前，必须先完成 `setApiBase`：

```typescript
// main.tsx 或 App.tsx 最顶层
import { invoke } from "@tauri-apps/api/core";
import { setApiBase } from "./api/client";

async function bootstrap() {
  try {
    const port = await invoke<number>("get_port");
    setApiBase(`http://localhost:${port}`);
  } catch {
    // 非 Tauri 环境保持默认 8080
  }
  // 之后渲染 React 树
  ReactDOM.createRoot(...).render(<App />);
}

bootstrap();
```

完整修改范围：
- `web/src/api/client.ts`
- `web/src/lib/logger.ts`
- `web/src/components/settings/SettingsPage.tsx`
- `web/src/main.tsx`（或等效入口文件，需确认）

---

## 六、风险与约束

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| TOCTOU 窗口（端口释放到 sidecar bind 之间被抢占） | 低 | 可接受；如需加固，sidecar 启动失败时 Rust 层最多重试 3 次 |
| 前端 invoke 在 sidecar 启动前返回 | 低 | invoke 只读 State，不依赖 sidecar 是否就绪；sidecar 连接失败由现有错误处理覆盖 |
| 开发模式直接运行 sidecar（不经 Tauri）| 低 | Go 层保留 `--port 8080` 默认值；前端 invoke 失败降级到 8080 |
| logger.ts 在 setApiBase 前被调用 | 中 | bootstrap 函数需在任何组件挂载前完成；需确保 main.tsx 中不提前渲染组件 |

---

## 七、验收标准

1. `docs/architecture/ISS-018-review.md` 存在（本文件）
2. `src-tauri/src/lib.rs`：动态端口分配 + `--port` 参数 + `get_port` command
3. `server/cmd/main.go`：`--port` flag，`addr` 和 UploadHandler base URL 动态化
4. `web/src/api/client.ts`、`logger.ts`、`SettingsPage.tsx`：无硬编码 8080
5. `web/src/main.tsx`：bootstrap 初始化 API base
6. 多次重复启动 noteyard 不再端口冲突崩溃
