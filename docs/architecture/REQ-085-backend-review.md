# REQ-085 后端架构评审

> 产出角色：后端架构师（arch-backend）
> dispatch ID：#240
> 日期：2026-05-06

---

## 一、背景

noteyard 需要同时支持网页端（浏览器直接访问）和桌面端（Tauri sidecar）两种运行模式。

- **桌面端**：Tauri 启动 Go sidecar，端口随机（`--port` 不传），前端通过 IPC 获取端口
- **网页端**：`make dev` 启动 Go server，前端通过固定端口访问

当前 `make server-dev` 不传 `--port`，端口随机，网页端无法直接访问。目标：`make dev` 时后端固定跑 8080。

---

## 二、现状分析

### 2.1 `server/cmd/main.go` 端口逻辑

关键代码（第 26–44 行）：

```go
portFlag := flag.Int("port", 0, "port to listen on (1-65535); omit for random port")
flag.Parse()

portSet := false
flag.Visit(func(f *flag.Flag) {
    if f.Name == "port" {
        portSet = true
    }
})

port := *portFlag
if portSet && (port < 1 || port > 65535) {
    fmt.Fprintf(os.Stderr, "invalid port %d: must be between 1 and 65535\n", port)
    os.Exit(1)
}
```

绑定逻辑（第 91–94 行）：

```go
listenAddr := "127.0.0.1:"
if portSet {
    listenAddr = fmt.Sprintf("127.0.0.1:%d", port)
}
```

**结论**：`--port 8080` flag 已完整实现，传入即固定端口，不传即随机。**无需修改 main.go**。

### 2.2 `Makefile` 现状

```makefile
server-dev:
    cd server && go run ./cmd/main.go
```

`server-dev` 不传 `--port`，端口随机。**这是唯一需要修改的地方。**

### 2.3 CORS 配置（main.go 第 120–124 行）

```go
AllowedOrigins: []string{
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "tauri://localhost",
    "https://tauri.localhost",
},
```

`localhost:5173` 已在允许列表中。网页端 Vite dev server 默认跑 5173，**CORS 无需变更**。

---

## 三、方案

### 3.1 Makefile 修改方案

**改动位置**：`Makefile` 第 17–18 行，`server-dev` target。

**改动内容**：

```makefile
# 修改前
server-dev:
    cd server && go run ./cmd/main.go

# 修改后
server-dev:
    cd server && go run ./cmd/main.go --port 8080
```

**改动范围**：1 行，仅 `server-dev` target。`sidecar-dev`（Tauri 模式）不传 `--port`，保持不变。

### 3.2 CORS 配置

无需变更。现有 `AllowedOrigins` 已包含 `http://localhost:5173`，覆盖网页端场景。

### 3.3 双模式端口策略对比

| 模式 | 启动方式 | 端口策略 | 前端获取端口方式 |
|------|---------|---------|----------------|
| 网页端 | `make server-dev` | 固定 8080 | 环境变量 `VITE_API_BASE=http://localhost:8080` |
| 桌面端 | Tauri sidecar | 随机（OS 分配） | Tauri IPC 注入 |

---

## 四、工程师任务拆分表

| # | 模块 | 任务描述 | 改动文件 | 改动行数 |
|---|------|---------|---------|---------|
| T1 | 后端启动脚本 | `server-dev` target 添加 `--port 8080` | `Makefile` | 1 行 |

> 注：前端部分（`VITE_API_BASE` 环境变量读取、Vite proxy 配置）由前端架构师 dispatch #239 负责，不在本评审范围内。

---

## 五、约束说明

1. **Tauri sidecar 不改动**：`sidecar-dev` target 构建二进制不传 `--port`，Tauri 启动时仍随机端口，行为不变
2. **main.go 不改动**：`--port` flag 已完整实现，无需任何后端代码变更
3. **CORS 不改动**：现有配置已覆盖所有需要的 origin

---

## 六、后续行（prereqs=240）

工程师任务在前端架构评审（dispatch #239）和本评审（dispatch #240）均完成后启动。

| dispatch 行 | assignee | 描述 | prereqs |
|------------|---------|------|---------|
| 待插入 T1 | 工程师-REQ085-T1 | Makefile server-dev 添加 --port 8080 | 239,240 |
