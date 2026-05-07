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

## REQ-083 ButtonBlock 能力增强评审摘要（2026-05-05，dispatch #211）

**变更模块**：`web/src/components/editor/`（`editor` 模块，仅此一个模块）

**架构决策**：
- `ButtonBlock` propSchema 新增 `bgColor`（`ButtonBgColor` 类型，10 值），`action` 枚举扩展为 4 值（新增 `new_subpage`、`edit_page_props`）
- ISS-043 修复：主按钮从 React 合成 `onClick` 改为原生 `addEventListener("mousedown")` + `mainBtnRef` effect，对齐已验证的 `settingsBtnRef` 模式
- FR-3/FR-4 需要访问 `pageId` 和 `onSelectPage`（Editor Props），通过模块级 `buttonBlockCtxRef` 对象传递，不修改 schema 定义位置
- FR-4 新增内联组件 `PagePropsPanel`（`position:fixed` + `getBoundingClientRect()`，ISS-042 方案），mount 时拉取 `api.pages.get(pageId)`，支持图标/封面/标题编辑
- 封面操作仅支持默认渐变色（不支持自定义图片上传），与需求文档一致

**关键约束**：
- `buttonBlockCtxRef` 在 Editor mount 后才填充，handler 入口须检查 `pageId` 非空
- 属性面板标题更新不自动同步 App.tsx `pageMeta`，如需同步须通过 CustomEvent 通知（可选）
- CSS hover 覆盖需在 `.bg-*` 规则后补充 `.bg-X:hover`，不用 `!important`
- 旧数据完全向后兼容（`bgColor` 默认值 `"default"` 外观不变，未知 `action` 值 fallback 到 `"none"`）

*由前端架构师（arch-frontend）生成，dispatch #211 / REQ-083。*

---

## REQ-084 按钮块触发自动化规则引擎评审摘要（2026-05-05，dispatch #222）

**变更模块**：`web/src/components/editor/`（`editor` 模块，仅此一个模块）

**架构决策**：
- `propSchema` 新增 `rules` 字段（JSON string，默认 `"[]"`）；`ButtonAction` 枚举扩展含 `"run_rules"`；新增 `ButtonRule` 联合类型（4 种规则）
- `rules` 字段序列化为 JSON string（BlockNote propSchema 不支持数组/对象类型），`parseRules` 解析时区分 `null`（格式非法）和 `[]`（空数组）
- 执行逻辑提取为模块级函数 `executeRules`/`executeSingleRule`，通过 `btn.disabled` 直接操作 DOM 实现防重（不走 React state）
- `resolveVariables` 为模块级纯函数，支持 `{{date}}`/`{{time}}`/`{{page_title}}` 三个占位符；`buttonBlockCtxRef` 新增 `pageTitle` 字段
- `append_content` 须用 `editor.insertBlocks([...], lastBlock, "after")` 追加末尾，不可用 `insertOrUpdateBlock`（后者插在光标位置）
- 规则编辑 UI 嵌入现有 `button-block-panel`，不新建文件；面板内交互约束对齐 ISS-044 方案（`onClick` 不用 `onMouseDown`）
- `notify` 规则用 `toast()`（`react-hot-toast`），须在 `Editor.tsx` 新增 `import toast`

**关键约束**：
- `rulesDraft` 须在 `panelOpen` 变为 `true` 时从 `block.props.rules` 回填（不能只用 mount 时的 lazy initializer）
- 有效性校验数组须同步扩展含 `"run_rules"`，否则保存后读取会 fallback 到 `"none"`
- `append_content` 末尾插入 API 选择须严格按评审结论（`editor.insertBlocks`）

*由前端架构师（arch-frontend）生成，dispatch #222 / REQ-084。*

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

---

## ISS-026 修复摘要（2026-05-04，dispatch #157/#159）

**问题**：Table View 行拖拽排序功能缺失（从未实现）。

**方案**：
- `DatabaseView.tsx` 新增 `SortableTableRow` 组件（`useSortable` + `GripVertical` 手柄），`Table View tbody` 包裹 `DndContext + SortableContext(verticalListSortingStrategy)`
- `dragEnabled = groupByColId === "" && activeSorts.length === 0`：分组模式或主动排序激活时禁用拖排序
- `onDragEnd`：`arrayMove` 乐观更新 `rows` state，调用 `api.databases.reorderRows` 持久化；失败回滚
- `api/client.ts` 新增 `reorderRows(dbId, order[])` 方法（POST `/databases/{id}/rows/reorder`）
- `DatabaseView.css` 新增 `.th-row-drag`、`.td-row-drag`、`.row-drag-handle` 样式，手柄 hover 显示

**影响文件**：
- `web/src/components/database/DatabaseView.tsx`
- `web/src/components/database/DatabaseView.css`
- `web/src/api/client.ts`

---

## REQ-086 拖拽系统重写评审摘要（2026-05-07，dispatch #246）

**变更模块**：`web/src/components/editor/`（`editor` 模块，仅此一个模块）

**架构决策**：
- 完全放弃 HTML5 drag-and-drop API，改用 pointer events（pointerdown/pointermove/pointerup/pointercancel）手动实现拖拽系统
- `DropOverlayView` 重写：移除 drag 事件监听，新增 pointer 事件监听；ghost 元素（position:fixed，opacity:0.6）跟随指针；其他块通过 `transform: translateY` 实时让位（rAF 节流，150ms ease）；蓝色横线（`.bn-drop-line`，2px，rgba(59,130,246,0.9)）指示插入位置
- ISS-048 `handleMultiColumnDrop` 函数**零修改**：left/right drop → columnList 分栏创建路径完整保留；pointer events 路径与 HTML5 drag 路径共存，通过 `isDragging` 状态隔离
- 事务提交通过 BlockNote API（`removeBlocks` + `insertBlocks`），不走 ProseMirror 原生 drop 路径（规避 ISS-048 根因中的 Slice 空白字符问题）
- `dropOverlayPlugin` 工厂函数签名不变，与 `Editor.tsx` 接口无变更

**关键约束**：
- `lastDragoverSide` 模块级变量和 `dragover` 事件监听必须保留（供 `handleMultiColumnDrop` 读取分栏意图）
- `setPointerCapture` 失败时降级处理（不崩溃）
- `destroy()` 必须清理 ghost、dropLine、所有 transform、opacity、userSelect、事件监听器
- rAF 节流：`cancelAnimationFrame` + 重新 `requestAnimationFrame`，避免 50+ 块场景卡顿

*由前端架构师（arch-frontend）生成，dispatch #246 / REQ-086。*

---

## REQ-087 编辑器内块拖拽视觉增强评审摘要（2026-05-07，dispatch #253）

**变更模块**：`web/src/components/editor/`（`editor` 模块，仅此一个模块）

**架构决策**：
- REQ-086 pointer events 实现已覆盖 FR-1~FR-5 主体逻辑；REQ-087 评审识别 4 个待补齐项
- Ghost 偏移优化：`pointerdown` 时记录 `ghostOffsetX/Y`，后续 ghost 定位使用 `(clientX - offsetX, clientY - offsetY)`，消除首次 pointermove 跳变
- Escape 键取消：`DropOverlayView` 注册 `keydown` 监听器，`Escape` 按下且 `isDragging` 时调用 `cleanupDrag()`（不提交事务）
- ColumnList 目标命中：`onPointerUp` 中检测目标块是否在 column 内部，若是则提升 `placement` 到 columnList 级别
- 源块 column 内重查找：扩展 `data-id` 重查找范围至 `allBlockOuters`，同步更新 `sourceBlockPos`
- ISS-048 修复（`handleMultiColumnDrop` regular 分支使用 BlockNote API）已实现且与 pointer events 路径完全兼容

**关键约束**：
- 4 个工程师任务可完全并行，总改动量约 50–80 行，均在 `dropOverlayPlugin.ts` 单文件内
- `dropOverlayPlugin` 工厂函数签名不变，CSS 类不变
- `handleMultiColumnDrop` 零修改，`lastDragoverSide` 保留
- `destroy()` 须包含 `keydown` 监听器移除

*由前端架构师（arch-frontend）生成，dispatch #253 / REQ-087。*
