# eng-log-frontend — 前端日志模块摘要

> 角色：eng-frontend  
> 模块名（架构师定义）：log-frontend  
> 对应需求：REQ-075  
> 实现者：eng-frontend#147

---

## 模块边界

**负责：**
- 对外暴露统一日志 API（debug / info / warn / error），供全量前端代码调用
- 将调用格式化为结构化 JSON，通过 HTTP POST 转发到 Go sidecar `/api/log` 端点
- 生产模式下过滤 DEBUG 级别（不发出网络请求）
- 网络失败时静默降级到 console，不向调用方暴露异常

**不负责：**
- 日志持久化（由 Go sidecar 的 lumberjack 负责）
- 日志文件路径或轮转策略
- Tauri 层日志（由 log-tauri 模块负责）
- 任何 UI 展示

---

## 核心数据流

调用方 → logger.ts（格式化 JSON 条目）→ fetch POST /api/log → Go handler 转写文件  
网络失败路径：fetch 抛出 → catch → console.warn/error → 调用方无感知

---

## 关键约束

- fire-and-forget：不 await fetch，不阻塞调用方
- 生产模式（`import.meta.env.DEV === false`）不发送 DEBUG 请求
- fetch 失败必须静默，不允许向业务层冒泡异常
- 请求体固定字段：`{ level, layer: "frontend", msg, fields? }`

---

## 技术选型

原生 `fetch` API，无额外依赖，符合 fire-and-forget 语义；fire-and-forget 通过不 await 并在 `.catch()` 内处理异常实现。

---

## 关键文件

- `web/src/lib/logger.ts`：实现入口，唯一对外模块
- `web/src/lib/logger.test.ts`：单元测试（8 用例，覆盖正常/降级/生产DEBUG三场景）

---

## 重要接口

- `debug / info / warn / error`：统一对外 API，签名见架构评审 REQ-075-review.md §六
