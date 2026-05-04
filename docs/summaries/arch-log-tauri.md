# arch-log-tauri — Rust Tauri 日志模块摘要

> 产出角色：总架构师（arch）
> 最后更新：2026-05-04 · dispatch #144 · REQ-075

---

## 1. 模块边界

**负责**：Rust Tauri 壳层自身日志（通过 tauri-plugin-log 写入 logs/tauri.log），以及在 sidecar 启动时向 Go sidecar 传递日志目录路径（通过 `--log-dir` CLI 参数）。

**不负责**：Go sidecar 日志写入（log-go 职责）、前端日志发送（log-frontend 职责）、Go 日志路径决策（main.go 负责）。

---

## 2. 核心数据流

```
lib.rs setup()：
  app.path().app_local_data_dir() → 拼接 /logs 子目录
  → sidecar("noteyard-server").arg("--log-dir").arg(logDir).spawn()
  （路径传递给 Go sidecar，由 Go 负责创建目录和写入）

Rust 业务代码调用 log::info! / log::error!
  → tauri-plugin-log handler
  → LogTarget::LogDir("tauri") → logs/tauri.log（系统日志目录）
  → LogTarget::Stdout（同步输出到终端）
```

---

## 3. 关键约束

1. `app_local_data_dir()` 返回 `Err` 时，`lib.rs` 不传 `--log-dir` 参数（sidecar 自动回退 `./logs/`），不阻断启动
2. tauri-plugin-log 配置：生产 INFO 级别，开发 DEBUG；LogTarget 必须包含 LogDir + Stdout 两个目标
3. tauri.conf.json capabilities 必须新增 `log:default` 权限，否则插件写文件被沙盒拦截
4. Cargo.toml 版本固定主版本 `"2"` 与 tauri v2 保持兼容
5. 开发模式下 sidecar 启动失败（binary 不存在）已在现有 `is_dev()` 分支处理，本次修改不破坏该逻辑
6. 日志文件：`logs/tauri.log`（相对于 `app_log_dir()`，由 tauri-plugin-log 自动管理路径）

---

## 4. 技术选型理由

- **tauri-plugin-log**：Tauri 官方插件，Tauri v2 下唯一可靠的原生日志写入方案，LogTarget 抽象支持多目标
- 路径传递方式选择 CLI 参数（`--log-dir`）而非环境变量：Tauri spawn API 对 CLI 参数支持更直接，且与 Go 侧 flag 解析天然对应

---

## 5. 关键文件路径

| 文件 | 说明 |
|------|------|
| `src-tauri/src/lib.rs` | 路径获取、sidecar 参数拼接、tauri-plugin-log 注册 |
| `src-tauri/Cargo.toml` | 新增 tauri-plugin-log = "2" 依赖 |
| `src-tauri/capabilities/default.json` | 新增 log:default 权限 |

---

## 6. 重要接口

- sidecar 参数约定：`noteyard-server --log-dir <absolute-path>`
- Rust log 宏：`log::info!`、`log::warn!`、`log::error!`（标准 Rust log crate 接口，由 tauri-plugin-log 实现 backend）
