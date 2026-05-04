# arch-log-frontend — 前端日志模块摘要

> 产出角色：总架构师（arch）
> 最后更新：2026-05-04 · dispatch #144 · REQ-075

---

## 1. 模块边界

**负责**：前端统一日志入口（logger.ts），对外暴露 debug/info/warn/error 四个函数，内部完成日志格式化并通过 HTTP POST 发送到 Go sidecar `/api/log` 端点，并在 sidecar 不可达时降级处理。

**不负责**：日志文件写入（Go sidecar 负责）、Tauri 原生日志（log-tauri 职责）、UI 层日志展示（不在范围）。

---

## 2. 核心数据流

```
业务代码调用 logger.info("msg", {fields})
  → logger.ts 格式化：{ts, level, layer:"frontend", msg, ...fields}
  → fetch POST /api/log（fire-and-forget，不 await，不阻塞调用方）
  → 成功：Go sidecar 写入 server.log
  → 失败（fetch error）：静默 fallback 到 console.warn / console.error
    （不向调用方抛出异常）
```

**生产环境 DEBUG 调用**：`import.meta.env.DEV` 为 false 时，debug() 直接返回，不发送 HTTP 请求。

---

## 3. 关键约束

1. logger.ts 为纯工具模块，无 React state、无 Context，可在任意组件/hook/utils 中导入
2. **不阻塞业务**：所有日志调用均为 fire-and-forget，内部捕获 fetch 异常，保证调用方零感知
3. **纯 Web 降级**：sidecar 不可达时 fallback 到 console，不引入 IndexedDB 等持久化（本期不在范围）
4. **DEBUG 生产关闭**：`import.meta.env.DEV` 为 false 时 debug() 函数直接返回，构建时 tree-shake 友好
5. 日志格式：JSON，字段为 `{ts, level, layer, msg, ...fields}`
6. layer 字段固定为 `"frontend"`，由 logger.ts 内部写入，调用方不传

---

## 4. 技术选型理由

- 不使用 `@tauri-apps/plugin-log`：与 Tauri invoke 深度耦合，纯 Web 场景（无 sidecar）完全失效；本方案保持 Web 兼容性
- 不使用 IndexedDB 持久化降级：引入隐性需求（日志查看 UI），超出 REQ-075 范围
- 选择 HTTP 转发到 Go：日志集中管理，格式统一，排障时只需查 server.log 一处

---

## 5. 关键文件路径

| 文件 | 说明 |
|------|------|
| `web/src/lib/logger.ts` | 模块入口，全部实现集中于此 |

---

## 6. 重要接口

```
debug(msg, fields?): void
info(msg, fields?): void
warn(msg, fields?): void
error(msg, fields?): void
```

全部为命名导出，fields 为可选的键值对扩展字段。
