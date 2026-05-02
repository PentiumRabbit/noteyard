# eng-frontend 摘要

| 字段 | 内容 |
|------|------|
| 角色 | 前端工程师（eng-frontend） |
| 最后更新 | 2026-05-02 |
| 对应需求 | REQ-064 / T-P0-2 |

---

## 当前架构要点

### 前端技术栈

- React 19 + TypeScript + Vite
- BlockNote（富文本编辑器）
- Mantine（UI 组件库）
- @dnd-kit（拖拽）
- react-hot-toast（全局 toast，T-P0-2 引入）

### 关键文件路径

| 文件 | 职责 |
|------|------|
| `web/src/api/client.ts` | 统一 HTTP 层，`req<T>` 函数封装 fetch；已集成 toast.error |
| `web/src/App.tsx` | 根组件，挂载 `<Toaster />`、SettingsContext、Sidebar、Editor |
| `web/src/components/editor/Editor.tsx` | BlockNote 编辑器，含硬编码 localhost URL（待 T-P1-2 修复） |
| `web/src/components/database/DatabaseView.tsx` | 数据库视图（≈1917 行大组件，待 AR-1 拆分） |
| `web/src/components/sidebar/Sidebar.tsx` | 页面树侧边栏 |
| `web/src/settings/settingsStore.ts` | 字体/主题 Context |
| `web/src/types/index.ts` | 业务类型定义 |

### 重要约束

- API 基础路径固定为 `http://localhost:8080/api`（dev 模式），生产走 Tauri sidecar
- `req<T>` catch 块已统一调用 `toast.error` 并 re-throw；调用方 `void` 前缀可保留
- `<Toaster position="bottom-center" />` 挂载于 SettingsContext.Provider 内、`<div className="app">` 之前

---

## 上次变更摘要（T-P0-2）

- 安装 `react-hot-toast` 依赖
- `web/src/api/client.ts`：将 `req` 函数原始 fetch 逻辑包入 try/catch，catch 中 `toast.error((err as Error).message)` 后 re-throw
- `web/src/App.tsx`：import `Toaster`，在 return 根节点添加 `<Toaster position="bottom-center" />`
- commit: `fix(api)[eng]: 添加全局错误 toast，api/client.ts req 函数统一处理错误`

---

## 待完成任务（P0/P1/P2 剩余）

| 任务 | 依赖 | 状态 |
|------|------|------|
| T-P0-1：I-001 useEffect 竞态 | 无 | pending |
| T-P0-2：I-002 全局错误 toast | 无 | **done** |
| T-P0-3：I-003 toBlockNote 类型化 | 无 | pending |
| T-P1-2：I-008 Editor 硬编码 URL | T-P0-2 | pending |
| T-P1-3：I-009 overlay DOM 泄漏 | 无 | pending |
| T-P1-4：I-011 Tauri sidecar 崩溃感知 | 无 | pending |
| T-P1-6：I-013 PageItem 合并 | 无 | pending |
| T-P2-x：各 P2 优化项 | 见 ARCH-PLAN-FRONTEND | pending |
