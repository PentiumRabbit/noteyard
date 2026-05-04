# eng-frontend 摘要

| 字段 | 内容 |
|------|------|
| 角色 | 前端工程师（eng-frontend） |
| 最后更新 | 2026-05-05 |
| 对应需求 | REQ-064（含全部 P0/P1/P2）/ ISS-011 / ISS-013 / REQ-074 / REQ-073 / ISS-035 |

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
| `web/src/components/editor/Editor.tsx` | BlockNote 编辑器，使用 API_BASE 常量，无硬编码 URL；注册 dropOverlayPlugin |
| `web/src/components/editor/dropOverlayPlugin.ts` | ProseMirror Plugin：dragover 时定位目标块并渲染 position:fixed 浮层；dragend/drop/dragleave 清除 |
| `web/src/components/database/DatabaseView.tsx` | 数据库视图（大组件，含竞态修复、乐观更新、缓存失效） |
| `web/src/components/database/shared.ts` | 数据库视图共享：TAG_COLORS、tagColor、parseOptions、serializeOptions、SelectOption |
| `web/src/utils/fileAttachments.ts` | parseFileAttachments 工具函数 |
| `web/src/stores/sidebarStore.ts` | Zustand store：renamingPageId 状态管理（替代 CustomEvent） |
| `web/src/types/blocknote.ts` | BNBlock/BNInline/BNInlineContent/BNTextContent/BNLinkContent 类型 |
| `web/src/types/blockTypes.ts` | BLOCK_TYPES as const，BlockType 联合类型 |
| `web/src/hooks/useMonthNav.ts` | 月导航 hook，CalendarView/TimelineView 共用 |
| `web/src/hooks/useKeyboardShortcuts.ts` | 键盘快捷键 hook，从 App.tsx 提取 |
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

## 上次变更摘要（ISS-035 v2）

- `web/src/components/editor/dropOverlayPlugin.ts`：新建 ProseMirror Plugin（方案D）。dragover 时用 `getNearestBlockPos` 定位目标块，调用 `getBoundingClientRect()` 获取视口坐标，按 clientX 判断 left/right/regular，用 `position: fixed` 的 overlay div 覆盖目标块完整区域（或左/右半边）；dragend/drop/dragleave 清除 overlay。
- `web/src/components/editor/Editor.tsx`：保留 `multiColumnDropCursor` 负责 handleDrop 逻辑（columnList 创建），但将 `color: false, width: 0` 抑制其视觉输出；通过 `useMemo` + `useEffect` 在 `_tiptapEditor` 上注册/注销 `dropOverlayPlugin`；移除 ISS-035 v1 的 document dragend 兜底 useEffect。
- `web/src/components/editor/Editor.css`：`.bn-drop-overlay` 新增 `position: fixed !important; z-index: 50`。
- commit: `fix(editor)[eng-frontend-ISS035-v2#188]: 方案D 自定义 dropOverlayPlugin 替换竖线浮层`

## 历史变更摘要（REQ-073）

- `web/src/api/client.ts`：`importMarkdown(file)` 函数，POST multipart/form-data 到 `/api/import/markdown`，使用 `API_BASE` 常量，失败时 `toast.error` + re-throw
- `web/src/components/sidebar/Sidebar.tsx`：引入 `toast`，侧边栏底部新增"导入 Markdown"按钮（`disabled` 状态 + "导入中…"文字切换），`handleImportChange` 成功后调用 `handleSelect` 跳转，失败改用 `toast.error`
- commit: `feat(import)[eng-frontend#136]: 实现 Markdown 导入入口及 importMarkdown API`

## 历史变更摘要（REQ-074）

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

## REQ-064 修复完成情况（DISPATCH#139）

| 问题 | 优先级 | 状态 |
|------|--------|------|
| I-001：DatabaseView useEffect 竞态 | P0 | **done** — cancelled flag + rowsRef，仅 db 变化驱动 |
| I-002：API void 吞 rejection | P0 | **done** — useEffect 内改为 `.catch(()=>{})` |
| I-003：toBlockNote 静默丢失数据 | P0 | **done** — catch 块已有 console.warn，BNBlock 类型完整 |
| I-006：TAG_COLORS/parseOptions 重复 | P1 | **done** — 提取到 database/shared.ts |
| I-007：parseFileAttachments 重复 | P1 | **done** — 提取到 utils/fileAttachments.ts |
| I-008：Editor 硬编码 localhost URL | P1 | **done** — API_BASE 从 api/client.ts 导出 |
| I-009：column overlay DOM 泄漏 | P1 | **done** — isConnected 检查，_tiptapEditor try/catch |
| I-011：Tauri sidecar 无崩溃感知 | P1 | **done** — spawn 后台任务监听 CommandEvent::Terminated |
| I-012：Block 类型链路 any 泛滥 | P1 | **done** — BNTextContent/BNLinkContent/BNInlineContent 新增 |
| I-013：PageItem/PageItemWithRename 重复 | P1 | **done** — 合并为单组件 + Zustand useSidebarStore |
| I-016：settingsStore 耦合 | P2 | 跳过（settingsStore 为 Context 非 Zustand） |
| I-017：useMonthNav 重复 | P2 | **done** — hooks/useMonthNav.ts |
| I-018：封面图 Base64 存 SQLite | P2 | 跳过（后端 /api/uploads 仅用于文件/PDF，cover 无专用上传接口） |
| I-019：findPageFlat 多余 | P2 | **done** — findPageFlat 已删除，BLOCK_TYPES as const 建立 |
| I-020：loadAvailableDatabases O(n) | P2 | **done** — openAddCol 时清空缓存，去掉早返回守卫 |
| I-022：commitEdit 乐观更新缺失 | P2 | **done** — 乐观更新 + prevRows 回滚快照 |
