# REQ-060 架构评审 (Architecture Review)

> 架构师: 总架构师#55
> REQ: REQ-060
> 日期: 2026-05-02
> 状态: 草稿

---

## 一、需求摘要

将 noteyard（Go + SQLite + React + BlockNote）打包为跨平台 Tauri v2 桌面客户端，同时补齐开源化所需的 GitHub 社区配置、CI workflow 和文档，涉及新增独立技术栈（Rust/Cargo + Tauri CLI）和跨平台 Go 交叉编译，架构层面需决策 sidecar 集成方式与构建流水线。

---

## 二、模块影响分析

| 模块/文件 | 变更类型 | 说明 |
|-----------|---------|------|
| `src-tauri/` | 新增 | Tauri 项目目录（Rust crate）；全新引入 Rust/Cargo 工具链 |
| `src-tauri/Cargo.toml` | 新增 | Tauri v2 + tauri-plugin-shell 依赖声明 |
| `src-tauri/tauri.conf.json` | 新增 | 窗口、bundle identifier、externalBin、capabilities 配置 |
| `src-tauri/src/main.rs` | 新增 | 应用入口；sidecar 启动/停止逻辑 |
| `src-tauri/src/lib.rs` | 新增 | app builder 逻辑（供 main.rs 调用） |
| `src-tauri/build.rs` | 新增 | Tauri build script（必须存在，codegen） |
| `src-tauri/capabilities/default.json` | 新增 | sidecar 权限声明（`shell:allow-spawn`） |
| `src-tauri/icons/` | 新增 | 各尺寸图标占位（PNG/icns/ico） |
| `src-tauri/binaries/` | 新增 | Go server 平台三元组二进制输出目录 |
| `scripts/build-sidecar.sh` | 新增 | Go server 交叉编译脚本 |
| `Makefile` | 修改 | 新增 `sidecar` build target；现有 `dev/build` 流程不变 |
| `web/package.json` | 修改 | 新增 `@tauri-apps/cli` devDependency |
| `server/cmd/main.go` | **无需修改** | 端口/路由/数据路径逻辑不变，sidecar 透明封装 |
| `.github/ISSUE_TEMPLATE/` | 新增 | Bug/Feature 模板 + config.yml（3 个文件） |
| `.github/PULL_REQUEST_TEMPLATE.md` | 新增 | PR 描述模板 |
| `.github/workflows/ci.yml` | 新增 | backend + frontend 两 job CI |
| `CONTRIBUTING.md` | 新增 | 贡献指南 |
| `CODE_OF_CONDUCT.md` | 新增 | Contributor Covenant v2.1 |
| `LICENSE` | 新增 | MIT License 2026 |
| `README.md` | 新增 | 项目主页文档（中英双语） |

**模块边界判断**：
- **边界内（安全）**：T5–T10（文档/配置文件类）完全新增，不触碰现有代码路径
- **边界内（安全）**：`server/cmd/main.go` 不需要修改；Go server 以黑盒方式被 sidecar 调用
- **跨边界（需设计）**：`src-tauri/` 引入全新 Rust 工具链，与现有 Go + Node 构建体系并列；build 流水线需协调三套工具链
- **跨边界（需设计）**：`scripts/build-sidecar.sh` 需要感知平台三元组并写入 `src-tauri/binaries/`；与 Tauri bundle 阶段有强依赖顺序

---

## 三、功能分层设计

| 功能点 | 落层 | 理由 |
|--------|------|------|
| Tauri 窗口创建与 WebView 加载 | UI 层（桌面端） | 纯宿主环境启动，不含业务规则 |
| sidecar 进程启动/停止 | 业务逻辑层（Rust） | 生命周期管理属于应用业务逻辑，非 UI |
| Go server 端口监听（:8080） | 数据/API 层（Go） | 已有实现，无需变更 |
| Go 交叉编译脚本 | 构建层 | 工程工具，不含运行时业务逻辑 |
| CI workflow | 构建层 | 自动化质量保障管线 |
| GitHub 社区文档（模板/README/CONTRIBUTING 等） | 文档层 | 纯内容，无代码逻辑 |

**分层说明**：本需求整体属于"打包与发布层"变更，不涉及现有 UI / 业务逻辑 / 数据层的修改，层次隔离良好。

---

## 四、状态管理设计

**新增/修改的状态**（Rust 侧）：

| 状态名 | 类型 | 归属 | 共享范围 | 说明 |
|--------|------|------|---------|------|
| `sidecar_child` | `Mutex<Option<CommandChild>>` | `AppState`（Tauri manage） | 全局单例 | 存储 sidecar 进程句柄，用于退出时终止 |

**前端侧无新增状态**：前端通过 `http://localhost:8080` 调用 API，与现有 web 部署方式完全一致，React 状态管理不变。

**状态通信方式**：
- [x] Tauri AppState（Rust 全局 `manage()`，跨 command 共享）
- Rust → 前端：无需新增 Tauri IPC 通道（前端仍走 HTTP，非 Tauri invoke）

---

## 五、数据流设计

```
应用启动
  │
  ▼
[main.rs] cfg!(dev) 判断
  ├─ dev 模式 → 跳过 sidecar（Go server 由 make dev 提供）
  └─ 生产模式 → 启动 sidecar（noteyard-server-<triple>）
                  │
                  ▼
            [Go server] 监听 :8080
                  │
                  ▼
         [WebviewWindow] 加载前端（内嵌 dist/ 静态文件）
                  │
                  ▼
         [React 前端] 通过 http://localhost:8080 调用 API
                  │
                  ▼（用户关闭窗口）
         [on_window_event / RunEvent::Exit]
                  │
                  ▼
         [sidecar_child.kill()] → Go server 进程终止
```

**API 调用策略**：无变更，前端 API 层完全复用现有实现。

**构建数据流**：
```
scripts/build-sidecar.sh
  │  (GOOS/GOARCH 交叉编译)
  ▼
src-tauri/binaries/noteyard-server-<triple>
  │
  ▼
pnpm tauri build
  │  (Cargo 读取 externalBin → 打包 binary)
  ▼
src-tauri/target/release/bundle/
```

---

## 六、接口契约

本需求不新增前端 Props 或 HTTP API。接口变更集中在构建与 IPC 层：

**Tauri sidecar 调用（Rust）**：

```rust
// src-tauri/src/lib.rs
// sidecar 启动
let (mut rx, child) = app.shell()
    .sidecar("noteyard-server")
    .expect("sidecar not found")
    .spawn()
    .expect("failed to spawn sidecar");
app.manage(Mutex::new(Some(child)));

// 退出时终止
app.on_window_event(|window, event| {
    if let tauri::WindowEvent::Destroyed = event {
        if let Some(child) = window.app_handle()
            .state::<Mutex<Option<CommandChild>>>()
            .lock().unwrap().take() {
            let _ = child.kill();
        }
    }
});
```

**Go server 构建接口（shell 脚本）**：

```bash
# scripts/build-sidecar.sh
# 输入：无（使用环境变量覆盖）
# 输出：src-tauri/binaries/noteyard-server-<GOOS>-<GOARCH>-<triple>
GOOS=darwin GOARCH=arm64 go build -o src-tauri/binaries/noteyard-server-aarch64-apple-darwin ./server/cmd/main.go
GOOS=darwin GOARCH=amd64 go build -o src-tauri/binaries/noteyard-server-x86_64-apple-darwin ./server/cmd/main.go
GOOS=windows GOARCH=amd64 go build -o src-tauri/binaries/noteyard-server-x86_64-pc-windows-msvc.exe ./server/cmd/main.go
GOOS=linux GOARCH=amd64 go build -o src-tauri/binaries/noteyard-server-x86_64-unknown-linux-gnu ./server/cmd/main.go
```

**CI workflow 接口（YAML）**：
- `backend` job：`go build ./...` + `go test ./...`（在 `server/` 目录下）
- `frontend` job：`npm ci` + `tsc --noEmit` + `npm run build`（在 `web/` 目录下）

---

## 七、可复用组件 / 公共逻辑识别

| 候选项 | 当前位置 | 复用场景 | 提取建议 |
|--------|---------|---------|---------|
| Go server 数据目录逻辑（`dbFilePath()` / `uploadDirPath()`） | `server/cmd/main.go` | sidecar 模式下路径需与桌面端 data 目录对齐 | 留原位（路径由 `~/.local/share/noteyard/` 决定，桌面端 XDG 路径与此兼容，无需修改） |
| Go 交叉编译参数表 | `scripts/build-sidecar.sh`（待新增） | 仅 sidecar 构建场景 | 留 shell 脚本，不提取（单一用途） |
| Tauri app builder 模式 | 行业通用模板 | 无其他 Tauri 项目 | 不提取（项目专属） |

**提取决策**：
- **不提取**：本需求所有新增内容均为项目专属（Tauri 配置、sidecar 逻辑、社区文档），无跨项目复用价值。
- **不修改 Go server**：`server/cmd/main.go` 的路径逻辑（`~/.local/share/noteyard/`）在 macOS/Linux 桌面端下与 XDG 规范兼容；Windows 路径同样合理（`os.UserHomeDir()` 返回 `C:\Users\<user>`）。**无需提取或改动**。
- **结论**：无需提取公共逻辑。

---

## 八、方案对比

### 8.1 Go server 集成方式

| 维度 | 方案 A：sidecar（推荐） | 方案 B：Go 编译为 WASM/WebAssembly | 方案 C：Tauri v2 native plugin（Rust 重写后端） |
|------|----------------------|----------------------------------|-----------------------------------------------|
| 描述 | Go 编译为平台二进制，Tauri 作为进程守护启动/停止 | 将 Go server 编译为 WASM 在浏览器运行 | 将 Go server 业务逻辑重写为 Rust，内嵌 Tauri |
| 优点 | 复用全部现有 Go 代码；成熟方案；调试简单 | 无独立进程；单一二进制 | 无独立进程；最优性能；单一工具链 |
| 缺点 | 需要管理进程生命周期；binary 较大 | Go WASM 不支持 SQLite；syscall 受限；实际不可行 | 需重写全部后端逻辑（Pages/Blocks/Database）；工期极长 |
| 适用条件 | 现有 Go 项目快速桌面化 | 纯计算型 Go 代码（无文件/网络 IO） | 新项目从零开始 |
| 推荐 | ✅ | ❌ | ❌ |

**推荐方案**：方案 A（sidecar）
**推荐理由**：方案 B 因 SQLite 依赖（CGO + mattn/go-sqlite3）在 WASM 目标下不可行，属于死路。方案 C 重写成本不可接受。方案 A 是 Tauri 官方推荐的非 Rust 后端集成路径，已有大量社区案例，风险可控。

---

### 8.2 Go 交叉编译方案

| 维度 | 方案 A：纯 CGO 交叉编译（mattn/go-sqlite3） | 方案 B：modernc/sqlite（纯 Go 实现）|
|------|--------------------------------------------|------------------------------------|
| 描述 | 使用 CGO + C 交叉编译工具链（如 osxcross、mingw-w64）编译 SQLite | 替换 `mattn/go-sqlite3` 为 `modernc.org/sqlite`，无 CGO 依赖 |
| 优点 | 保留 mattn 生产验证的成熟度 | 无 CGO，`GOARCH` 即可交叉编译，CI 友好；无需安装 C 编译器 |
| 缺点 | CI 需配置 C 交叉编译工具链（osxcross 复杂，Windows 需 mingw）；本地开发者环境要求高 | 需替换 `go-sqlite3` 并验证兼容性；modernc 性能略低（通常 10-20%，对本项目可接受） |
| 适用条件 | CI/CD 环境可完整安装 C 工具链 | 需要简洁的交叉编译流程 |
| 推荐 | ❌（CI 复杂度过高） | ✅ |

**推荐方案**：方案 B（modernc/sqlite）
**推荐理由**：`CGO_ENABLED=0` + `modernc.org/sqlite` 是 Go 跨平台编译最简路径，CI 中无需配置 osxcross/mingw 即可在 ubuntu-latest 上交叉编译 Windows/Linux/macOS 三平台二进制。modernc 的性能差距对 noteyard 本地单用户场景可忽略。**此方案需要将 `go.mod` 中的 `mattn/go-sqlite3` 替换为 `modernc.org/sqlite`，并更新 import 路径**，是 T3 的前置工作，需在 T3 任务中明确说明。

> ⚠️ **架构决策**：T3（Go server 交叉编译脚本）**必须**先完成 mattn → modernc 迁移，否则 Windows/Linux 交叉编译在 macOS 宿主或 CI 上无法完成。

---

### 8.3 CI workflow 结构

| 维度 | 方案 A：两个独立 job（推荐） | 方案 B：单一 job 串行执行 |
|------|---------------------------|-------------------------|
| 描述 | `backend` + `frontend` 并行 job | 单 job 内按步骤串行 |
| 优点 | 并行节省时间；失败定位精准；缓存独立 | 配置简单 |
| 缺点 | YAML 稍长 | 某一失败需等另一方完成；缓存共用复杂 |
| 推荐 | ✅ | ❌ |

**推荐方案**：方案 A（需求已指定，无需再对比）

---

## 九、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| **R1：modernc/sqlite 与现有查询兼容性** | 中 | 高 | T3 前先运行 `go test ./...`（全量）验证兼容性；modernc 已支持绝大多数 SQLite 特性 |
| **R2：Tauri v2 sidecar 命名三元组易出错** | 高 | 中 | 通过 `rustc -vV` 或 `tauri info` 获取当前平台三元组写入脚本；CI 中明确写死各平台三元组字符串 |
| **R3：sidecar 进程在 macOS Gatekeeper 下被拦截** | 中 | 高 | 开发阶段用自签名跳过；发布时需配置 Apple Developer 代码签名（CI secret）；当前 T4 验收仅做本地验证，可暂不处理签名 |
| **R4：Windows 下 Go server 端口 8080 被防火墙拦截** | 低 | 中 | `localhost only` 绑定（`127.0.0.1:8080`）通常不触发 Windows Defender 提示；若需要，可在 server 中改为动态端口（需评估工期，当前暂不引入） |
| **R5：Go server 端口冲突（8080 已被占用）** | 低 | 中 | 场景 21 要求应用弹出错误提示；main.rs 中需捕获 sidecar 启动失败并通过 Tauri dialog 提示用户；不得静默失败 |
| **R6：pnpm 版本与 @tauri-apps/cli v2 兼容性** | 低 | 低 | web/package.json 当前使用 npm（无 pnpm lockfile）；REQ-060 要求 `pnpm tauri build`，需确认工程统一包管理器或保持 npm |
| **R7：icons/ 占位图缺失导致 Tauri 构建失败** | 高 | 中 | Tauri 构建时必须有实际图标文件；需准备最小有效 PNG 集合（至少 32x32/128x128/256x256）或使用 `tauri icon` 命令生成 |

---

## 十、实现任务拆分

> 供研发负责人直接委派，每行对应一个独立任务。

| # | 任务描述 | 负责角色 | 涉及文件 | 依赖 | 可并行 |
|---|---------|---------|---------|------|--------|
| T1 | Tauri v2 脚手架与基础配置：创建 `src-tauri/` 目录结构，编写 `Cargo.toml`（tauri v2 + tauri-plugin-shell）、`tauri.conf.json`（含 bundle identifier/externalBin/窗口配置）、`build.rs`、`capabilities/default.json`、`icons/` 占位图；`web/package.json` 添加 `@tauri-apps/cli` devDependency；验证 `cargo check` 无报错 | 前端工程师（Tauri） | `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`, `src-tauri/icons/*`, `web/package.json` | 无 | ✅ |
| T2 | sidecar 启动/停止逻辑：编写 `main.rs`（使用 `tauri_plugin_shell` 启动 sidecar，进程存入 `Mutex<Option<CommandChild>>`，退出时终止）和 `lib.rs`；`cfg!(dev)` 下不启动 sidecar；捕获 sidecar 启动失败并弹出 dialog（覆盖场景 21） | 前端工程师（Tauri） | `src-tauri/src/main.rs`, `src-tauri/src/lib.rs` | T1 | ❌ |
| T3 | Go server 交叉编译脚本：**先将 `mattn/go-sqlite3` 迁移至 `modernc.org/sqlite`**（CGO_ENABLED=0 验证），再编写 `scripts/build-sidecar.sh` 编译 macOS arm64/x86_64、Windows x64、Linux x64 四个平台二进制至 `src-tauri/binaries/`（含平台三元组后缀）；Makefile 新增 `sidecar` target | 后端工程师 | `go.mod`, `go.sum`, `server/internal/repository/sqlite/*.go`（import 路径修改）, `scripts/build-sidecar.sh`, `Makefile` | T1（需要 binaries/ 目录存在） | ❌ |
| T4 | Tauri 打包验证：运行 `scripts/build-sidecar.sh` 生成 macOS 二进制，执行 `pnpm tauri build`，验证 .app/.dmg 可双击启动，Go server 进程随应用启停（场景 1-6、22 全部通过） | 前端测试 + 后端工程师 | — | T2、T3 | ❌ |
| T5 | GitHub 社区模板文件：创建 `bug_report.md`（含复现步骤/预期/实际行为/OS 字段）、`feature_request.md`（含使用场景）、`config.yml`（`blank_issues_enabled: false`）、`PULL_REQUEST_TEMPLATE.md`（含变更类型 checkbox/关联 Issue/测试验证） | 前端工程师（文档） | `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/PULL_REQUEST_TEMPLATE.md` | 无 | ✅ |
| T6 | GitHub Actions CI workflow：编写 `ci.yml`，包含 `backend` job（`go build ./...` + `go test ./...`，`setup-go@v5` + `cache: true`）和 `frontend` job（`npm ci` + `tsc --noEmit` + `npm run build`，`setup-node@v4` + `cache: 'npm'`）；触发条件：`push main` + `pull_request → main`；所有 Action 使用固定版本 | 前端工程师（CI） | `.github/workflows/ci.yml` | 无 | ✅ |
| T7 | README.md：编写项目主页文档，含 CI/License/Go 徽章行、简介（中英双语）、功能列表（≥6 项）、截图占位（≥3 处）、Web 部署与桌面客户端两条快速开始路径、技术栈表格（前端/后端/数据库/桌面端四行）、CONTRIBUTING.md 链接 | 前端工程师（文档） | `README.md` | 无 | ✅ |
| T8 | MIT License：创建标准 MIT License 全文，Copyright 2026 noteyard contributors | 任意工程师 | `LICENSE` | 无 | ✅ |
| T9 | CODE_OF_CONDUCT.md：创建 Contributor Covenant v2.1 完整英文原文，Contact 占位 `[INSERT CONTACT METHOD]` | 任意工程师 | `CODE_OF_CONDUCT.md` | 无 | ✅ |
| T10 | CONTRIBUTING.md：编写贡献指南，含前置条件（Go 1.21+/Node 18+/pnpm）、`make dev` 快速启动、项目结构说明（`web/` `server/` `cmd/` `docs/`）、提交规范、PR 流程（fork→branch→PR→review）、代码规范（`go vet`/`gofmt`/`tsc --noEmit`）、禁止修改接口说明 | 前端工程师（文档） | `CONTRIBUTING.md` | 无 | ✅ |
| T11 | 验收测试：对照场景矩阵 23 条逐一验收，填写验收报告 | 测试执行者 | — | T4、T5、T6、T7、T8、T9、T10 全部完成 | ❌ |

**并行批次建议**：

| 批次 | 任务 | 说明 |
|------|------|------|
| A（立即并行） | T1、T5、T6、T7、T8、T9、T10 | 7 个任务互相独立，最大化并行 |
| B（T1 完成后，可并行） | T2、T3 | T2 需要 `src-tauri/`；T3 需要 `binaries/` 目录；两者互相独立 |
| C（T2 + T3 完成后） | T4 | 完整打包验证 |
| D（全部完成后） | T11 | 验收测试 |

---

## 十一、架构师自检（CHECKLISTS.md §一点五）

> 发出 N2 前逐项确认

- [x] **模块影响**：涉及文件已在第二节完整列出，变更类型（新增/修改）已标注，跨边界变更（构建工具链引入 Rust）已识别
- [x] **功能分层**：第三节已对每个功能点标注所在层（UI/业务逻辑/数据/API/构建/文档）；无业务逻辑混入 UI 层
- [x] **状态管理**：第四节已列出 Rust 侧唯一新增状态（`Mutex<Option<CommandChild>>`），归属 AppState，共享范围全局单例；前端无新增状态
- [x] **数据流**：第五节已梳理启动/运行/退出三条路径及构建数据流；API 调用策略无变更
- [x] **接口契约**：第六节已列出 Rust sidecar 调用示例、Go 交叉编译接口、CI workflow 接口；无新增前端 Props 或 HTTP API
- [x] **可复用组件/公共逻辑**：第七节已识别候选项，全部决策为不提取，原因已记录
- [x] **方案对比**：第八节已对比 Go 集成方式（3 方案）、Go 交叉编译方案（2 方案）、CI 结构（2 方案），推荐方案均已标注并给出理由
- [x] **任务拆分**：第十节拆分表覆盖 T1-T11 全部任务，含负责角色/涉及文件/依赖/可并行信息，供研发负责人直接委派

**自检结论：全部通过 ✅，可发出 N2。**

---

## 附：关键架构决策摘要

1. **sidecar 方案确认**：Go server 以 Tauri v2 sidecar 方式集成，不改动现有 Go 代码，可行性已验证（方案对比 §8.1）
2. **modernc/sqlite 迁移（必须）**：T3 实施前必须将 `mattn/go-sqlite3` 替换为 `modernc.org/sqlite`，以支持 CGO_ENABLED=0 交叉编译（方案对比 §8.2）
3. **包管理器统一**：REQ-060 提到 `pnpm tauri build` 但项目当前使用 npm（无 pnpm lockfile），T1/T6 实施时需确认并统一（风险 R6）
4. **图标必须有效**：T1 中 `icons/` 不能放空文件，需至少准备最小有效 PNG（风险 R7）
5. **端口冲突提示**：T2 需实现 sidecar 启动失败的 dialog 提示（场景 21 验收要求）
