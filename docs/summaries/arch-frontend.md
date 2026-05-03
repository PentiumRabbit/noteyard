# arch-frontend — 前端架构摘要

| 字段 | 内容 |
|------|------|
| 最后更新 | 2026-05-02 |
| 来源文档 | CODE-REVIEW-001, ARCH-PLAN-FRONTEND |
| 负责角色 | 前端架构师（arch-frontend） |

---

## 当前架构要点

### 技术栈
- React + TypeScript，构建工具 Vite
- 编辑器：BlockNote（基于 TipTap），`Editor.tsx` ≈1106 行
- 数据库视图：`DatabaseView.tsx` ≈1917 行（单体大组件）
- Tauri 桌面壳 + Go sidecar（noteyard-server）
- 状态管理：React useState/useContext，无全局状态库（AR-5 计划引入 Zustand）

### 组件结构

```
App.tsx                          — 全局状态中枢（selectedPageId, pageMeta, view）
├── Sidebar.tsx                  — 页面树 + 重命名（PageItem / RenameAwarePageItem）
├── Editor.tsx                   — BlockNote 编辑器 + 自定义块（FileAttach/Bookmark/Pdf）
└── DatabaseView.tsx             — 数据库组件（含 6 个子视图 + 所有弹窗）
    ├── KanbanView.tsx
    ├── GalleryView.tsx
    ├── CalendarView.tsx
    ├── TimelineView.tsx
    ├── ListView.tsx (推断)
    └── [弹窗/操作栏内联在 DatabaseView.tsx]
```

### 状态管理
- `App.tsx`：持有 `selectedPageId`、`pageMeta`、`backlinks`、`view`、`sidebarKey`，通过 props / 回调下发
- `settingsStore.ts`：React Context 管理主题 (`themeId`) 和字体 (`fontId`)，含 `initSettings` 副作用
- `DatabaseView.tsx`：内部全量维护 db、rows、filter/sort state、editingCell、colWidths 等约 20+ 个 state

### API 层
- `web/src/api/client.ts`：统一 `req<T>(method, path, body)` 函数，非 2xx 时 throw；已集成全局 toast（REQ-064 修复）
- `api.uploads.upload(file)` / `api.meta.fetch(url)`：附件上传和 meta 抓取（REQ-064 修复后新增）
- 后端地址：`http://localhost:8080`（BASE_URL 在 client.ts 中定义）

### Tauri 集成层
- `src-tauri/src/lib.rs`：启动 noteyard-server sidecar，注册 window 事件清理子进程
- 前端通过标准 HTTP 调用后端，Tauri API 用于文件系统/原生对话框
- sidecar 崩溃监听：已规划（I-011），通过 `sidecar-crashed` event + `@tauri-apps/api/event` 通知前端

---

## 关键文件路径

| 文件 | 说明 |
|------|------|
| `web/src/App.tsx` | 全局入口，路由状态，页面选择 |
| `web/src/api/client.ts` | HTTP 客户端，统一错误处理 |
| `web/src/types/index.ts` | 共享类型（Page、Block、DBColumn、DBRow 等） |
| `web/src/types/blocknote.ts` | BNBlock / BNInline 类型（REQ-064 新建） |
| `web/src/components/editor/Editor.tsx` | BlockNote 编辑器，含自定义块 |
| `web/src/components/database/DatabaseView.tsx` | 数据库主组件（≈1917 行，待拆分） |
| `web/src/components/database/shared.ts` | TAG_COLORS / parseOptions / tagColor（REQ-064 提取） |
| `web/src/components/sidebar/Sidebar.tsx` | 侧边栏，PageItem 组件 |
| `web/src/utils/toBlockNote.ts` | Block → BNBlock 转换工具 |
| `web/src/utils/fileAttachments.ts` | parseFileAttachments 共享工具（REQ-064 提取） |
| `web/src/hooks/useMonthNav.ts` | 月份导航 hook（REQ-064 提取） |
| `web/src/settings/settingsStore.ts` | 主题/字体 Context |
| `src-tauri/src/lib.rs` | Tauri 主入口，sidecar 管理 |

---

## 重要约束

1. **DatabaseView 尚未拆分**：AR-1 大型重构（≈1917 行拆分为 6 个子组件）计划在 P0/P1 bug fix 全部完成后进行，避免 merge conflict
2. **前端 filter/sort 与后端重复**（I-005）：`DatabaseView.tsx` L876–909 维护了独立的 filter/sort 实现，与 `server/internal/handler/sort_filter.go` 语义存在差异（大小写敏感、数字精度），待 AR-3 统一
3. **Block.content 为 JSON string**：`web/src/types/index.ts` 中 `Block.content: string` 是后端序列化的 JSON 字符串，解析后才是 BNBlock 结构，不可直接使用
4. **CustomEvent 通信**：Sidebar 的"重命名"通过 `window.dispatchEvent(new CustomEvent("rename-page", ...))` 触发，绑过 React 数据流，计划 AR-5 Zustand 阶段替换
5. **Tauri 端口固定**：sidecar 在 `localhost:8080` 监听，BASE_URL 在 `api/client.ts` 硬编码
6. **no Zustand**：当前无全局状态管理库，深层 props drilling 存在；引入 Zustand 已规划（AR-5）

---

## 上次变更摘要（REQ-064，2026-05-02）

已完成的 P0 修复（dispatch #40–#41 工程师交付）：

- **I-001**：`DatabaseView` `relationRowsCache` state → `useRef`，移除 `eslint-disable` 竞态修复
- **I-002**：`api/client.ts` `req` 函数 catch 块集成 `react-hot-toast`；`App.tsx` 根节点添加 `<Toaster />`
- **I-004**（后端）：`ListRows` N+1 改为 `batchFetchAllCells` 批量查询

已规划待实现（P1/P2 及 AR 系列）：

- I-006/I-007：shared.ts / fileAttachments.ts 提取
- I-008：Editor 硬编码 URL → api.uploads / api.meta
- I-009：column overlay `isConnected` 检查
- I-011：Tauri sidecar 崩溃监听
- I-012/I-003：BNBlock 类型化，toBlockNote warn 日志
- I-013：PageItem 合并
- AR-1：DatabaseView 组件拆分（最后执行，改动量最大）
- AR-5：引入 Zustand

---

---

## ISS-011 修复摘要（2026-05-02，dispatch #58/#72/#73）

**问题**：`Editor.tsx` TypeScript 编译错误阻塞 CI（共 11 处）。

**根因与修复**：
- **TS2540 readonly**：`block.props` 在 `ReactCustomBlockRenderProps` 中是 readonly，不可直接赋值。改用 `editor.updateBlock(block, { props: {...} })`。
- **TS2339 updateBlock 不存在**：BlockNote 0.26 已从 `ReactCustomBlockRenderProps` 移除 `updateBlock` 便捷函数，需从 `editor` 访问。render 解构从 `{ block, updateBlock }` 改为 `{ block, editor }`。
- **TS2719/TS2322 BlockNoteEditor 类型不兼容**：`useCreateBlockNote` 返回含完整泛型的 editor，传给 `DatabaseSlashItem`/`MentionMenu` 时类型不兼容。在调用处加 `as any` 类型断言。
- **TS6133 未使用变量**：`MentionMenu` 函数参数中声明的 `onSelectPage` 未使用，删除该参数。
- **TS2322 mention 类型**：`insertInlineContent` 的 mention 对象加 `as any` 类型断言。
- **TS2345 parseInt**：`blockToMd` 中 `b.props?.level` 类型为 `unknown`，包装 `String()` 再传给 `parseInt`。

*由前端架构师（arch-frontend）生成，dispatch #56 / REQ-066。ISS-011 补充于 dispatch #72。*

---

## ISS-016 修复摘要（2026-05-03，dispatch #121–#123）

**问题**：数据库单选/多选交互不符合 Notion 预期行为（三处缺陷）。

**根因与修复**：

- **多选面板提前关闭**：`col-menu-overlay` 的 `onClick` 捕获了从选项按钮冒泡上来的事件，导致每次点选项后面板立即关闭。修复：在每个 `select-dd-item` 按钮的 `onClick` 中添加 `e.stopPropagation()`。
- **缺少勾选状态（单选）**：单选下拉面板未与当前行已选值做对比。修复：在 map 中读取 `currentVal`，计算 `isSelected`，为已选项添加 `"✓ "` 前缀和 `.selected` class；点击已选项改为调 `clearSelectCell`（取消 + 关闭），与多选面板模式对齐。
- **缺少添加选项入口**：两个下拉面板均无"+ 添加选项"按钮。修复：在两个面板底部新增按钮，`onClick` 通过 `colId` 查找 `col` 对象后调用已有的 `openSelectOptions(e, col)` 函数。

**影响文件**：
- `web/src/components/database/DatabaseView.tsx`（选项渲染逻辑）
- `web/src/components/database/DatabaseView.css`（`.select-dd-add-option` 样式）

*由前端架构师（arch-frontend）生成，dispatch #121 / ISS-016。*
