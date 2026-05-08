# REQ-079 架构评审 (Architecture Review)

> 架构师: dev-lead（兼前端架构师）
> REQ: REQ-079
> 日期: 2026-05-04
> 状态: 已确认

---

## 一、需求摘要

REQ-079 是对 noteyard v0.1.19 的全面健康度审查，涉及 4 项 P1 bug 修复（columnList 崩溃、数据库块宽度回归、拖动并排失效、文档状态同步）、1 项后端 feature 补全（REQ-076 write_frontend_log Tauri command）、前端架构重构（6 组件提取 + 5 公共函数收拢 + 5 模块隔离整改）、以及 6 处接口契约对齐，变更体量前端约 80%、后端约 20%。

---

## 二、模块影响分析

| 模块/文件 | 变更类型 | 说明 |
|-----------|---------|------|
| `web/src/utils/toBlockNote.ts` | 修改 | ISS-004：空 column 子块补占位段落（已有修复代码，需验证并确认 issues.md 状态） |
| `web/src/components/database/DatabaseView.css` | 修改 | ISS-006/008：撤销负 margin 方案，改为 `overflow-x: auto` 横向滚动 |
| `web/src/components/editor/Editor.tsx` | 修改 | ISS-014 multiColumnDropCursor 排查；抽离 FileUploadField、UrlInputField、useResizable；裸 fetch → api.uploads；markdownUtils 收拢 |
| `web/src/components/editor/FileUploadField.tsx` | 新增 | 统一文件上传 UI 组件（FileAttachBlock + PdfBlock 共用） |
| `web/src/components/editor/UrlInputField.tsx` | 新增 | 统一 URL 输入框（BookmarkBlock + EmbedBlock 共用） |
| `web/src/hooks/useResizable.ts` | 新增 | 抽取 startResize 逻辑，EmbedBlock + PdfBlock 共用 |
| `web/src/utils/markdownUtils.ts` | 新增 | 收拢 blocksToMarkdown/blockToMd/inlinesToText（来自 Editor.tsx）+ importMarkdown 调用封装 |
| `web/src/utils/filterUtils.ts` | 新增 | 收拢前端 applyFilter（来自 DatabaseView.tsx 内联函数），与后端 sort_filter.go 操作符对齐 |
| `web/src/utils/columnUtils.ts` | 新增 | 收拢 parseRelationOpts + parseRollupOpts（来自 DatabaseView.tsx） |
| `web/src/utils/urlUtils.ts` | 新增 | 收拢 isSafeUrl / URL 安全校验（来自 Editor.tsx + Sidebar.tsx 散落处） |
| `web/src/utils/blockDtoUtils.ts` | 新增 | 收拢 buildDtosRecursive / applyTemplate 中重复的 Partial<Block> 构造逻辑 |
| `web/src/utils/sidebarPersistence.ts` | 新增 | 收拢 loadRecent/saveRecent/recordVisit/loadFavorites/saveFavorites（来自 Sidebar.tsx 顶部） |
| `web/src/components/database/databaseConstants.ts` | 修改 | 将 STATUS_PRESETS 从 DatabaseView.tsx 内联位置迁入 |
| `web/src/components/common/PanelSelect.tsx` | 新增 | 将 ToolbarPanel.tsx 中已有的 PanelSelect 提升为公共组件 |
| `web/src/services/pageService.ts` | 新增 | 提取 createFromTemplate + duplicatePage（来自 Sidebar.tsx 跨职责调用） |
| `web/src/hooks/useBlockNoteEditor.ts` | 新增 | 抽取 BlockNote 初始化 + debounce + readyRef + flush 共用逻辑（Editor.tsx + RowModal.tsx 共用） |
| `web/src/types/index.ts` | 修改 | 新增 UploadResponse、BookmarkMeta（从内联迁出）；对齐后端字段 |
| `web/src/api/client.ts` | 修改 | 新增 api.uploads.upload()、api.meta.fetch()；补充 reorderRows JSDoc；统一上传调用 |
| `src-tauri/src/lib.rs` | 修改 | REQ-076：注册 write_frontend_log Tauri command |
| `web/src/lib/logger.ts` | 修改 | REQ-076：新增 invoke("write_frontend_log") 本地文件持久化调用 |
| `server/internal/handler/` | 参考 | sort_filter.go 操作符集合作为 filterUtils.ts 对齐基准；AddColumn/UpdateColumn 添加 type 白名单校验 |
| `docs/issues/issues.md` | 修改 | ISS-001 状态更新为已修复；ISS-027 状态核实并更新 |

**模块边界判断**：
- 安全：toBlockNote.ts 修改（已有占位符代码，只需确认）、databaseConstants.ts 新增常量迁移、issues.md 文档更新——均在现有模块边界内
- 跨边界（需特别设计）：useBlockNoteEditor hook 提取涉及 Editor.tsx 和 RowModal.tsx 两个独立组件共用 schema，需确认 schema 不产生循环依赖；pageService.ts 引入新服务层，Sidebar.tsx 需同步修改调用点

---

## 三、模块列表

> 后续工程师按此命名产出摘要文件，不得自行创建新模块划分。

| 模块名称 | 模块描述 | 摘要文件举例 |
|---------|---------|------------|
| `p1-bug-column-crash` | ISS-004 空 column 崩溃修复 + issues.md 状态确认 | eng-p1-bug-column-crash.md |
| `p1-bug-db-width` | ISS-006/008 数据库块宽度 + 负 margin 回归修复 | eng-p1-bug-db-width.md |
| `p1-bug-multicolumn-drag` | ISS-014 拖动并排 multiColumnDropCursor 排查修复 | eng-p1-bug-multicolumn-drag.md |
| `p1-doc-status-sync` | ISS-001/027 issues.md 文档状态同步（轻量任务） | eng-p1-doc-status-sync.md |
| `req-076-tauri-log` | REQ-076 write_frontend_log Tauri command + TS 调用实现 | eng-req-076-tauri-log.md |
| `arch-file-upload` | FileUploadField 组件提取 + UrlInputField + useResizable hook | arch-file-upload.md |
| `arch-editor-utils` | markdownUtils + blockDtoUtils 公共函数收拢；Editor.tsx 裸 fetch → api.uploads | arch-editor-utils.md |
| `arch-database-utils` | filterUtils + columnUtils + STATUS_PRESETS 迁入 databaseConstants | arch-database-utils.md |
| `arch-sidebar-service` | sidebarPersistence 工具函数提取；pageService.ts 新服务层 | arch-sidebar-service.md |
| `arch-blocknote-hook` | useBlockNoteEditor hook 提取（Editor.tsx + RowModal.tsx 共用） | arch-blocknote-hook.md |
| `arch-panel-select` | PanelSelect 提升为公共组件；ButtonBlock + 添加列弹窗替换原生 select（ISS-007） | arch-panel-select.md |
| `api-contract-types` | UploadResponse/BookmarkMeta 类型对齐；api.uploads/api.meta 封装；reorderRows JSDoc | arch-api-contract-types.md |

---

## 四、技术方案

### 4.1 ISS-004 — column 空内容崩溃（P1 最高风险）

**根因**：toBlockNote.ts 的 buildBlock 函数在 columnList 处理时，若某 column 无子块则 colChildren 为空数组，BlockNote 的 ProseMirror schema 要求 column 节点至少有一个子节点，触发 `RangeError: Invalid content for node column`，整页渲染失败。

**现状**：查看 toBlockNote.ts（第 25-29 行），safeChildren 处理已存在：
```ts
const safeChildren = colChildren.length > 0
  ? colChildren
  : [{ id: `${col.id}-placeholder`, type: BLOCK_TYPES.PARAGRAPH, props: {}, content: [], children: [] }];
```
代码已修复，需验证该修复是否在最新 commit 中生效，并将 ISS-004 在 issues.md 中标注为已修复。

**修复方案**：验证确认 → 更新 issues.md 状态 → 若代码确实已在生产分支，无需额外代码改动。

### 4.2 ISS-006/008 — 数据库块宽度回归（P1）

**根因**：ISS-006 通过负 `margin-left` / `margin-right` 让数据库块突破父容器宽度限制，ISS-008 发现此方案导致块与正文列错位、出现 BlockNote 蓝色聚焦边框（`.bn-block-outer` 边框计算错位）。

**推荐方案：块内横向滚动**
- 撤销 DatabaseView.css 中的负 margin 方案
- 对 `.db-wrap` 容器应用 `overflow-x: auto`，使表格在容器内横向滚动
- 优点：不影响父容器布局，BlockNote 聚焦边框正常
- 缺点：宽表格需横向滚动，不"全宽突破"；可接受，与 Notion Web 的默认行为一致

**方案否决（负 margin + 补偿）**：需精确计算 padding 补偿值，依赖外层容器，脆弱且难维护。

### 4.3 ISS-014 — 拖动并排失效（P1 最高风险）

**根因**：`multiColumnDropCursor` 是 BlockNote 0.26 `@blocknote/xl-multi-column` 的核心 API，用于检测侧边 drop 并触发 columnList 合并。失效原因可能是：
1. BlockNote 0.26 中 `multiColumnDropCursor` 函数签名变更（参数/选项格式）
2. 与 `SideMenuController` 的 drag event 产生冲突（ISS-030 修复后可能引入）
3. Editor.tsx 中 `withMultiColumn` 的 schema 扩展顺序问题

**排查方案**：
- Step 1：检查当前 `Editor.tsx` 中 `multiColumnDropCursor` 的调用参数，对照 `@blocknote/xl-multi-column` 0.26 changelog 和类型定义
- Step 2：在 BlockNoteView 的 `editorContentEditableProps` 中临时注入 drag 事件 console.log，确认 drop 事件是否触达
- Step 3：如果 API 签名变更，按最新文档更新参数；如果事件冲突，在 `SideMenuController` 中加 `stopPropagation` 豁免

**修复要点**：工程师执行前必须在 node_modules 中查阅 `@blocknote/xl-multi-column` 的实际导出类型，不得仅凭旧文档假设。

### 4.4 REQ-076 — write_frontend_log Tauri command（P1 feature 补全）

**缺失情况**：
- `src-tauri/src/lib.rs` 的 `invoke_handler` 仅注册了 `get_port`，无 `write_frontend_log`
- `web/src/lib/logger.ts` 无 `invoke("write_frontend_log")` 调用

**实现方案**：
```rust
// lib.rs — 新增 command
#[tauri::command]
async fn write_frontend_log(app: tauri::AppHandle, level: String, layer: String, msg: String, fields: Option<serde_json::Value>) -> Result<(), String> {
    use std::io::Write;
    let log_dir = app.path().app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log_path = log_dir.join("frontend.log");
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&log_path)
        .map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs()).unwrap_or(0);
    let entry = format!("{} [{}] [{}] {}{}\n", ts, level, layer, msg,
        fields.as_ref().map(|f| format!(" {:?}", f)).unwrap_or_default());
    file.write_all(entry.as_bytes()).map_err(|e| e.to_string())
}
```
- 在 `.invoke_handler(tauri::generate_handler![get_port, write_frontend_log])` 中注册
- `logger.ts` 在 Tauri 环境检测（`window.__TAURI__` 存在）时同时调用 `invoke("write_frontend_log", {...})`，不阻塞原有 HTTP log 路径

### 4.5 架构重构总体原则

- **提取不破坏现有行为**：新文件仅做搬运+重命名，不修改业务逻辑；原调用处改为 import 新路径
- **文件冲突管理**：Editor.tsx 和 DatabaseView.tsx 各有多项改动，同一文件的多个任务串行；跨文件独立任务并行
- **STATUS_PRESETS 迁移**：仅常量移动，不涉及组件逻辑，零风险

---

## 五、任务拆分表

| # | 任务描述 | 负责角色 | 涉及文件 | 估时 | 依赖 | 可并行 |
|---|---------|---------|---------|------|------|--------|
| T01 | **P1** 确认 ISS-004 修复已生效，更新 issues.md ISS-004 状态为已修复；同步确认 ISS-001/027 状态 | 前端工程师 | `toBlockNote.ts`, `docs/issues/issues.md` | 0.5h | 无 | ✅ |
| T02 | **P1** ISS-006/008：撤销 DatabaseView.css 负 margin，改为 `.db-wrap` overflow-x:auto 横向滚动 | 前端工程师 | `DatabaseView.css` | 1h | 无 | ✅ |
| T03 | **P1** ISS-014：排查 multiColumnDropCursor API 在 @blocknote/xl-multi-column 0.26 的参数变化，修复拖动并排 | 前端工程师 | `Editor.tsx`, `@blocknote/xl-multi-column` 类型 | 3h | 无 | ✅ |
| T04 | **P1** REQ-076：Rust 侧实现 write_frontend_log command，注册到 invoke_handler | Rust/Tauri 工程师 | `src-tauri/src/lib.rs` | 2h | 无 | ✅ |
| T05 | **P1** REQ-076：logger.ts 中在 Tauri 环境下调用 invoke("write_frontend_log")，不影响 Web 环境 | 前端工程师 | `web/src/lib/logger.ts` | 1h | T04 | ❌ |
| T06 | **架构** 提取 FileUploadField.tsx：将 FileAttachBlock 和 PdfBlock 的重复上传 UI 抽为独立组件；统一 2MB/10MB 校验 | 前端工程师 | `Editor.tsx`, `components/editor/FileUploadField.tsx` | 2h | 无 | ✅ |
| T07 | **架构** 提取 useResizable hook：将 EmbedBlock + PdfBlock 的 startResize 逻辑抽为 `hooks/useResizable.ts` | 前端工程师 | `Editor.tsx`, `hooks/useResizable.ts` | 1h | T06（同文件，串行） | ❌ |
| T08 | **架构** 提取 UrlInputField.tsx：统一 BookmarkBlock + EmbedBlock 的 URL 输入框外壳；修复 EmbedBlock 使用 bookmark CSS class | 前端工程师 | `Editor.tsx`, `components/editor/UrlInputField.tsx` | 1.5h | T07（同文件，串行） | ❌ |
| T09 | **架构** Editor.tsx 裸 fetch → api.uploads：FileAttachBlock、PdfBlock 上传改用 `api.uploads.upload(file)` 封装（需先在 client.ts 新增该方法） | 前端工程师 | `Editor.tsx`, `api/client.ts` | 1h | T06（同文件，串行） | ❌ |
| T10 | **架构** markdownUtils.ts 提取：将 blocksToMarkdown/blockToMd/inlinesToText 从 Editor.tsx 迁出，Editor.tsx 改为 import | 前端工程师 | `Editor.tsx`, `utils/markdownUtils.ts` | 1h | T08（同文件，串行） | ❌ |
| T11 | **架构** filterUtils.ts 提取：将 DatabaseView.tsx 内联 applyFilter 迁出为纯函数；操作符与 sort_filter.go 对齐 | 前端工程师 | `DatabaseView.tsx`, `utils/filterUtils.ts` | 1.5h | 无 | ✅ |
| T12 | **架构** columnUtils.ts 提取：将 parseRelationOpts + parseRollupOpts 从 DatabaseView.tsx 迁出；CellRenderer.tsx 改为直接 import | 前端工程师 | `DatabaseView.tsx`, `CellRenderer.tsx`, `utils/columnUtils.ts` | 1.5h | T11（同文件，串行） | ❌ |
| T13 | **架构** STATUS_PRESETS 迁入 databaseConstants.ts；DatabaseView.tsx import 使用 | 前端工程师 | `DatabaseView.tsx`, `databaseConstants.ts` | 0.5h | T12（同文件，串行） | ❌ |
| T14 | **架构** sidebarPersistence.ts 提取：loadRecent/saveRecent/recordVisit/loadFavorites/saveFavorites 从 Sidebar.tsx 迁出 | 前端工程师 | `Sidebar.tsx`, `utils/sidebarPersistence.ts` | 1h | 无 | ✅ |
| T15 | **架构** pageService.ts 新建：将 createFromTemplate + duplicatePage 从 Sidebar.tsx 迁出为 services 层函数 | 前端工程师 | `Sidebar.tsx`, `services/pageService.ts` | 2h | T14（同文件，串行） | ❌ |
| T16 | **架构** urlUtils.ts 提取：收拢 isSafeUrl（Editor.tsx）+ Sidebar.tsx URL 校验为公共工具函数 | 前端工程师 | `Editor.tsx`, `Sidebar.tsx`, `utils/urlUtils.ts` | 1h | T10, T15（同文件，串行） | ❌ |
| T17 | **架构** api-contract：types/index.ts 新增 UploadResponse、BookmarkMeta（对齐后端）；client.ts 新增 api.uploads.upload()、api.meta.fetch()；reorderRows 补 JSDoc | 前端工程师 | `types/index.ts`, `api/client.ts` | 1.5h | 无 | ✅ |
| T18 | **架构** PanelSelect 提升为公共组件：从 ToolbarPanel.tsx 提取为 `components/common/PanelSelect.tsx`；ISS-007 ButtonBlock + 添加列弹窗替换原生 select | 前端工程师 | `ToolbarPanel.tsx`, `components/common/PanelSelect.tsx`, `Editor.tsx`（ButtonBlock）, `DatabaseView.tsx`（添加列弹窗） | 2.5h | T13（DatabaseView 串行）, T10（Editor 串行） | ❌ |
| T19 | **架构** 后端 AddColumn/UpdateColumn handler 添加 col.Type 白名单校验（防非法列类型写入 DB） | 后端工程师 | `server/internal/handler/database_handler.go` | 1h | 无 | ✅ |
| T20 | **验收** REQ-059 T13：执行 23 条场景矩阵验收测试，更新 REQ-059 状态为已实现 | 前端工程师（测试） | REQ-059 验收文档 | 2h | T02, T03 | ❌ |
| T21 | **下一轮** ISS-005 下拉菜单底部裁切（P2）| — | — | — | — | — |
| T22 | **下一轮** ISS-002/003 TD-001 undo/redo 跨列迁移（P2 技术债，需大范围重构）| — | — | — | — | — |

> T01–T05 为 P1，必须优先完成。T06–T19 为架构重构，T06/T11/T14/T17/T19 可并行启动；同一文件的任务严格串行（T06→T07→T08→T09→T10→T16 均在 Editor.tsx；T11→T12→T13 均在 DatabaseView.tsx；T14→T15→T16 均在 Sidebar.tsx）。

---

## 六、回归影响分析

| 回归点 | 受影响模块 | 回归优先级 |
|--------|----------|-----------|
| columnList 页面加载：含空 column 子块的页面不再崩溃 | `toBlockNote.ts` | P0 |
| 数据库块正常显示，宽表格横向滚动，不与正文列错位，无蓝色聚焦边框异常 | `DatabaseView.css` | P0 |
| 拖动块到侧边可正确合并为 columnList 两列布局 | `Editor.tsx` (multiColumnDropCursor) | P0 |
| 文件上传（FileAttach、PDF）功能正常，2MB/10MB 限制生效 | `Editor.tsx`, `FileUploadField.tsx` | P1 |
| Embed 和 PDF 高度拖拽调整正常 | `useResizable.ts` | P1 |
| Bookmark 和 Embed URL 输入框行为一致，enter 确认/onBlur 触发正常 | `UrlInputField.tsx` | P1 |
| 数据库筛选条件（contains/equals/gt/lt 等）前端结果与后端一致 | `filterUtils.ts` vs `sort_filter.go` | P1 |
| Relation 列和 Rollup 列 CellRenderer 渲染正常（parseRelationOpts/parseRollupOpts 提取后） | `CellRenderer.tsx`, `columnUtils.ts` | P1 |
| Select/multi-select 列新增/删除选项正常；STATUS_PRESETS 预设选项正常写入 | `databaseConstants.ts` | P1 |
| Sidebar 最近访问、收藏功能 localStorage 读写正常 | `sidebarPersistence.ts` | P1 |
| 页面模板应用（applyTemplate）和页面复制（handleCtxCopy）功能正常 | `pageService.ts`, `Sidebar.tsx` | P1 |
| Tauri 环境下日志写入本地文件（write_frontend_log）；Web 环境不受影响 | `lib.rs`, `logger.ts` | P1 |
| 公式弹窗在视口下半部触发时不超出屏幕（ISS-027 已修复，回归确认） | `DatabaseView.tsx` (openFormulaPopover) | P2 |
| REQ-059 T13 全量 23 条场景矩阵通过 | 数据库视图 | P1 |

---

## 七、风险点

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| ISS-014 multiColumnDropCursor：@blocknote/xl-multi-column 0.26 API 可能有 breaking change，排查时间可能超出估时 | 中 | 高 | T03 工程师优先查阅 node_modules 实际类型定义和 CHANGELOG，预留 1h buffer；若 3h 内无法定位，升级为异常冒泡 |
| useBlockNoteEditor hook 提取（未纳入本轮任务表，但 REQ 报告建议）：Editor.tsx 和 RowModal.tsx schema 不共享，提取时可能引发 schema 循环依赖或编辑器状态混乱 | 高 | 高 | 本轮不执行此提取，标注为下一轮独立评审项（需专项架构设计） |
| Editor.tsx 串行任务链（T06→T07→T08→T09→T10→T16）跨越多个功能域，单人执行周期长，中途被中断可能导致文件处于半重构状态 | 中 | 中 | 每个任务完成后立即提交（one-role-one-commit），不允许跨任务合并；工程师每完成一个子任务需运行 `pnpm run typecheck` 验证编译 |
| filterUtils.ts 与后端 sort_filter.go 操作符不一致：前端 applyFilter 和后端 matchFilter 的行为在 `gt`/`lt` 类型转换上略有差异（前端 parseFloat，后端同样 ParseFloat，但前端 NaN 比较返回 true，后端返回 false）| 低 | 中 | T11 工程师在提取时同步对齐 NaN 行为，前端改为 NaN 时返回 false，与后端一致 |
| pageService.ts 新建服务层：Sidebar.tsx 调用 api.blocks.listByPage/batchUpdate 被移出后，applyTemplate 和 handleCtxCopy 错误处理（toast）需在 pageService 中保留 | 低 | 中 | T15 工程师在 pageService 中保留 try/catch + toast，Sidebar.tsx 只调用 service 函数，不重复处理错误 |
| REQ-076 Rust command 异步文件 I/O：write_frontend_log 如使用同步 I/O 在高频日志场景下可能阻塞 Tauri 主线程 | 低 | 低 | T04 实现时使用 `tokio::fs` 异步文件写入，或使用 `tauri::async_runtime::spawn_blocking` 包装同步 I/O |
| CellRenderer.tsx 的 parseRelationOpts prop 移除后，若有其他组件也通过 prop 传入而非直接 import，会编译报错 | 低 | 低 | T12 前先全局搜索 `parseRelationOpts` 引用，确认仅 DatabaseView.tsx → CellRenderer.tsx 一条路径 |

---

## 八、方案对比

### 8.1 ISS-006/008 数据库块宽度

| 维度 | 方案 A：块内横向滚动 | 方案 B：负 margin + 补偿 |
|------|--------------|--------------|
| 描述 | `.db-wrap` 加 `overflow-x: auto`，表格在容器内滚动 | 保留负 margin，精确计算 padding 补偿值修复对齐 |
| 优点 | 不影响父容器布局；BlockNote 聚焦边框正常；与 Notion Web 一致 | 表格"全宽"不被裁切 |
| 缺点 | 宽表格需横向滚动 | 依赖外层 padding 硬编码，脆弱；已证明引入 ISS-008 回归 |
| 适用条件 | 一般场景 | 需要真全宽突破且有固定布局时 |
| 推荐 | ✅ | ❌ |

**推荐方案**：方案 A（块内横向滚动）
**推荐理由**：方案 B 已在 ISS-008 中被证明会引入 BlockNote 聚焦边框回归，且负 margin 方案依赖外层 padding 精确值，在多种屏幕尺寸下不稳定。方案 A 是业界标准（Notion、Linear 均采用），无副作用。

### 8.2 REQ-076 日志写入触发时机

| 维度 | 方案 A：Tauri 环境判断后调用 invoke | 方案 B：logger.ts 统一改为仅走 Tauri command |
|------|--------------|--------------|
| 描述 | 保留现有 HTTP log 路径，Tauri 环境额外 invoke 写文件 | 废弃 HTTP /api/log，全部改走 Tauri command |
| 优点 | 向后兼容；Web 版（如未来有）不受影响 | 简化路径 |
| 缺点 | 双路径，略复杂 | Web 版完全失去日志；与 log_handler.go 已有实现冲突 |
| 推荐 | ✅ | ❌ |

**推荐方案**：方案 A
**推荐理由**：log_handler.go 已有完整实现，HTTP log 路径在 Web 环境（dev server）下也有用；Tauri 环境下叠加 invoke 写本地文件，满足 REQ-076 「本地文件持久化」要求，互不干扰。

---

*N2 自检通过 — 研发负责人 [dev-lead] 2026-05-04*
