# REQ-085 前端架构评审

| 字段 | 内容 |
|------|------|
| 需求编号 | REQ-085 |
| 评审角色 | 前端架构师（arch-frontend） |
| dispatch ID | #239 |
| 创建日期 | 2026-05-06 |
| 状态 | 已交付 |

---

## 一、目标

`make web-dev`（或 `npm run dev`）启动后，在浏览器访问 `http://localhost:5173` 即可正常使用所有功能。Tauri 桌面端行为不回归。

---

## 二、现状分析

### 2.1 API_BASE 初始化链路

```
main.tsx bootstrap()
  └─ resolvePort()          ← 尝试 Tauri IPC get_port（重试 10 次）
       ├─ 成功 → setApiBase("http://localhost:{port}")   [Tauri 路径]
       └─ 失败 → 保持默认值 "http://localhost:8080"      [当前浏览器路径，有问题]
```

浏览器环境下 Tauri IPC 必然失败，`API_BASE` 保持 `"http://localhost:8080"`。此时前端直接跨域请求 8080，需要后端支持 CORS。即使 CORS 通过，开发体验也依赖后端独立启动，与 Vite dev server 解耦。

### 2.2 client.ts 中的路径模式

| 函数 / 调用点 | 当前路径模式 | Vite proxy 兼容性 |
|---|---|---|
| `req<T>(method, path, body)` | `API_BASE + "/api" + path` | 需要 `API_BASE = ""`（相对路径） |
| `importMarkdown` | `API_BASE + '/api/import/markdown'` | 同上 |
| `api.uploads.upload` | `API_BASE + "/api" + "/uploads"` | 同上 |
| `api.blocks.batchUpdateBeacon` | `API_BASE + "/api/blocks/batch"` | `API_BASE = ""` 时变为 `"/api/blocks/batch"`，`sendBeacon` 相对路径有效 |
| `exportAll` | `/api/export?format=...`（已相对） | 已兼容，无需修改 |
| `exportPage` | `/api/pages/{id}/export?...`（已相对） | 已兼容，无需修改 |

结论：只需让 `API_BASE = ""`，`req`/`importMarkdown`/`uploads`/`batchUpdateBeacon` 四处均变为相对路径，Vite proxy 即可接管。`exportAll`/`exportPage` 已是相对路径，不受影响。

---

## 三、方案设计

### 3.1 核心思路

引入环境变量 `VITE_API_BASE`，在 `.env.development`（仅 web 目录）中设为空字符串。浏览器 dev 模式下 `API_BASE` 初始值为 `""`，所有请求走相对路径，由 Vite proxy 转发到 8080。Tauri 路径不变（IPC 成功后覆盖为 `http://localhost:{port}`）。

### 3.2 Vite proxy 配置

文件：`web/vite.config.ts`

在 `server` 字段新增 `proxy`：

```ts
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
  },
},
```

说明：
- 仅代理 `/api` 前缀，与后端路由完全对齐（后端所有路由均挂载在 `/api`）
- `changeOrigin: true` 确保 `Host` 头为 `localhost:8080`，避免后端 host 校验问题
- 此配置仅在 `vite dev` 模式生效，生产构建无影响

### 3.3 API_BASE 读取方式

文件：`web/src/api/client.ts`，第 5 行

将：
```ts
export let API_BASE = "http://localhost:8080";
```

改为：
```ts
export let API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";
```

说明：
- 浏览器 dev 模式：`VITE_API_BASE = ""`，`API_BASE` 初始为 `""`，所有请求变为相对路径
- Tauri 模式：`VITE_API_BASE` 未定义（Tauri 构建不注入此变量），`API_BASE` 初始为 `"http://localhost:8080"`，随后被 `setApiBase` 覆盖为动态端口，行为不变
- 生产 web 构建：`VITE_API_BASE` 未定义，`API_BASE` 回退到 `"http://localhost:8080"`（当前行为，后续可按需通过 CI 环境变量覆盖）

### 3.4 main.tsx 修改

文件：`web/src/main.tsx`，`bootstrap()` 函数

当前逻辑：IPC 失败 → 保持 `"http://localhost:8080"`（不调用 `setApiBase`）

修改后逻辑：IPC 失败 → 不调用 `setApiBase`（保持 `client.ts` 中已由 `VITE_API_BASE` 初始化的值）

**具体改动**：第 29–31 行的 `else` 分支注释更新，无需改变代码逻辑：

```ts
} else {
  // Non-Tauri environment: API_BASE is already initialized from VITE_API_BASE
  // (empty string in dev → Vite proxy; fallback "http://localhost:8080" in prod)
  console.info("[bootstrap] running outside Tauri, API_BASE from env:", API_BASE);
}
```

同时在第 29 行 `else` 分支中，从 `client` 导入 `API_BASE` 以便打印当前值：

```ts
import { setApiBase, API_BASE } from "./api/client";
```

（替换原有的 `import { setApiBase } from "./api/client"`，即第 6 行）

### 3.5 环境变量文件

新建 `web/.env.development`：

```
VITE_API_BASE=
```

说明：
- 空字符串赋值，`import.meta.env.VITE_API_BASE` 值为 `""`，`?? "http://localhost:8080"` 不触发（`""` 非 `null`/`undefined`）
- 此文件仅在 `vite dev` 模式自动加载，不影响生产构建
- 需加入 `.gitignore` 豁免（如果 `.env.*` 被全局忽略则需显式 `!web/.env.development`）；若项目无 `.env` 忽略规则则直接提交

---

## 四、改动范围汇总

| 文件 | 改动类型 | 改动说明 |
|------|---------|---------|
| `web/vite.config.ts` | 新增 | `server.proxy` 字段，`/api` → `http://localhost:8080` |
| `web/src/api/client.ts` | 修改 1 行 | `API_BASE` 初始值改为读 `VITE_API_BASE`，fallback `"http://localhost:8080"` |
| `web/src/main.tsx` | 修改 1 行 + 注释 | import 增加 `API_BASE`；`else` 分支注释更新，打印当前值 |
| `web/.env.development` | 新建 | `VITE_API_BASE=`（空字符串） |

不需要修改的文件：`client.ts` 其余逻辑、`exportAll`/`exportPage`、Tauri 相关文件、后端代码。

---

## 五、Tauri 回归验证点

| 验证项 | 预期行为 |
|--------|---------|
| `make dev`（Tauri 模式） | `resolvePort()` 成功，`setApiBase("http://localhost:{port}")` 覆盖初始值，行为与现在完全一致 |
| `VITE_API_BASE` 在 Tauri 构建中 | Tauri 构建走 `npm run build`，不加载 `.env.development`，`VITE_API_BASE` 未定义，`API_BASE` 初始为 `"http://localhost:8080"`，IPC 覆盖后正常 |
| `batchUpdateBeacon` | `API_BASE = ""` 时 URL 为 `"/api/blocks/batch"`，`sendBeacon` 相对路径解析为 `http://localhost:5173/api/blocks/batch`，Vite proxy 转发，正常 |

---

## 六、工程师任务拆分表

| 子任务 | 文件 | 改动量 | 备注 |
|--------|------|--------|------|
| T1：Vite proxy 配置 | `web/vite.config.ts` | +5 行 | 新增 `proxy` 字段 |
| T2：API_BASE 环境变量初始化 | `web/src/api/client.ts` | 修改第 5 行 | `VITE_API_BASE ?? "http://localhost:8080"` |
| T3：main.tsx import + 注释 | `web/src/main.tsx` | 修改第 6 行 + 第 30–31 行 | 增加 `API_BASE` import，更新 else 注释 |
| T4：新建 `.env.development` | `web/.env.development` | 新建 1 行 | `VITE_API_BASE=` |

T1–T4 无依赖关系，可由同一工程师一次提交完成，或并行由两名工程师完成（T1+T4 一组，T2+T3 一组）。

---

## 七、模块列表（供后续角色摘要命名）

本次变更涉及单一模块：`frontend`（`web/src/` + `web/vite.config.ts`）。

后续工程师摘要文件命名：`docs/summaries/eng-frontend.md`（已存在，需更新）。
