# eng-frontend 摘要

| 字段 | 内容 |
|------|------|
| 角色 | 前端工程师（eng-frontend） |
| 最后更新 | 2026-05-03 |
| 对应需求 | REQ-064 / T-P0-2 / ISS-011 / ISS-013 / REQ-074 |

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
| `web/src/components/quickstart/QuickstartCard.tsx` | 空状态快速入门卡片（轻量 JSX 渲染，不依赖 BlockNote） |
| `web/src/data/quickstart.json` | 快速入门内容种子数据（16 块，5 章节） |
| `web/src/settings/settingsStore.ts` | 字体/主题 Context |
| `web/src/types/index.ts` | 业务类型定义 |

### 重要约束

- API 基础路径固定为 `http://localhost:8080/api`（dev 模式），生产走 Tauri sidecar
- `req<T>` catch 块已统一调用 `toast.error` 并 re-throw；调用方 `void` 前缀可保留
- `<Toaster position="bottom-center" />` 挂载于 SettingsContext.Provider 内、`<div className="app">` 之前

---

## 上次变更摘要（REQ-074）

- `web/src/data/quickstart.json`：新增快速入门种子数据，16 块覆盖 5 章节（标题/创建页面/块编辑器/数据库/常用快捷键），纯字符串 content 格式
- `web/src/components/quickstart/QuickstartCard.tsx`：轻量 JSX 卡片组件，将 seed blocks 渲染为 h1/h2/ul/li/p；底部「导入为页面」按钮调用 `api.pages.create` + `api.blocks.create` 逐块写入，成功后回调 `onImported`，失败调用 `toast.error`
- `web/src/components/quickstart/QuickstartCard.css`：卡片样式，max-width: 600px，margin: 0 auto
- `web/src/App.tsx`：empty-state 内容替换为 `<QuickstartCard onImported={handleSelect} />`，新增 import
- `web/src/App.css`：`.empty-state` 改为 `align-items: flex-start; padding: 32px 0`，适配卡片展示
- commit: `feat(quickstart)[eng-frontend#130]: 实现空状态快速入门说明卡片`

## 历史变更摘要（ISS-013）

- `web/src/utils/toBlockNote.test.ts`：修复 11 处 TS2532/TS18048 类型错误
  - 根因：`BNBlock.children` 类型为 `BNBlock[] | undefined`（可选字段），直接用 `children[n]` 访问触发 TS2532
  - 修复方式：对所有 `.children[n]` 访问改为 `.children![n]!`（先断言 children 非 undefined，再断言元素非 undefined）
  - 涉及行：48, 49, 144, 145, 146, 147, 148, 158, 169, 170, 171
  - commit: `fix(utils)[eng#74]: ISS-013 修复 toBlockNote.test.ts TS 类型错误`

## 历史变更摘要（ISS-011）

- `web/src/components/editor/Editor.tsx`：修复全部 TS 编译错误
  - TS2540：callout/toggle block 中 `block.props.icon` / `block.props.open` 直接赋值改为 `editor.updateBlock(block, { props: {...} })`
  - TS2339：fileAttach/bookmark/embed/pdf/button 5 个 block 的 `render` 解构从 `updateBlock` 改为 `editor`，调用改为 `editor.updateBlock(block, ...)`
  - TS2719/TS2322：`<DatabaseSlashItem editor={editor}>` 与 `<MentionMenu editor={editor}>` 调用处加 `as any` 类型断言
  - TS6133：删除 `MentionMenu` 未使用的 `onSelectPage` 参数
  - TS2322：`editor.insertInlineContent` 内 mention 对象加 `as any` 类型断言
  - TS2345：`blockToMd` 中 `parseInt(b.props?.level ?? "1")` 改为 `parseInt(String(b.props?.level ?? "1"))`
- commit: `fix(editor)[eng#73]: ISS-011 修复 Editor.tsx 全部 TS 编译错误`

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
