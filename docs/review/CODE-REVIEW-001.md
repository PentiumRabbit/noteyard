# CODE-REVIEW-001 — noteyard 全局代码审查报告

| 字段 | 内容 |
|------|------|
| 报告 ID | CODE-REVIEW-001 |
| 对应需求 | REQ-063 |
| 审查日期 | 2026-05-02 |
| 审查人 | 总架构师（arch） |
| dispatch ID | 38 |
| 代码快照 | branch `main`，HEAD `1b0d8ea` |

---

## 1. 执行摘要

### 总体健康评分：3 / 5

项目整体结构清晰，后端分层严格（handler → repository 接口），前端通过统一 api/client 调用后端。主要问题集中在两个超大组件（DatabaseView.tsx ≈ 1917 行、Editor.tsx ≈ 1106 行）的状态管理复杂度、前端类型安全漏洞（大量 `any`），以及部分 useEffect 缺少清理。后端质量整体较好，formula_eval 边界处理完善；backup 并发安全需要关注。

### 各维度小结

| 维度 | 评级 | 主要发现 |
|------|------|----------|
| **A 代码质量** | C | 前端 `any` 滥用普遍（≥30 处 `@ts-expect-any`/`eslint-disable`）；useEffect 清理不完整；API 错误处理部分缺失 |
| **B 架构** | B | 层间职责总体清晰；但前端存在 props drilling 和全局状态耦合；Tauri sidecar 缺重试机制 |
| **C 复用性** | C | DatabaseView 内 filter/sort 逻辑与后端 sort_filter.go 重复；四个视图组件存在大量相似渲染模式；`parseFileAttachments` 重复定义 |

---

## 2. 问题清单

### P0 — 紧急（须优先修复）

---

#### I-001
- **层 / 文件路径 / 行号**：前端组件 / `web/src/components/database/DatabaseView.tsx` / 408–454
- **维度**：A3（潜在 Bug）
- **优先级**：P0
- **问题描述**：`useEffect`（relation 行批量加载）的依赖数组被注释为 `eslint-disable-next-line react-hooks/exhaustive-deps`（L453），实际只依赖 `[db, rows]`，但内部闭包捕获了 `relationRowsCache`（L415）。当 `relationRowsCache` 在上一次 effect 尚未执行完时被外部更新，新 effect 覆盖旧结果，导致已加载的关联行缓存被覆盖，出现**竞态覆盖**——旧缓存数据丢失，视图闪回空值。
- **建议修复方向**：将 relation 批量加载抽取为 `useCallback`，正确声明依赖；或使用 `useRef` 保存缓存并通过 `ref.current` 读取，避免闭包捕获过期值。

---

#### I-002
- **层 / 文件路径 / 行号**：前端 API 客户端 / `web/src/api/client.ts` / 5–17
- **维度**：A2（边界与错误处理）
- **优先级**：P0
- **问题描述**：`req<T>` 函数本身有 try/catch 逻辑，但**所有调用方均未包裹 try/catch**（`App.tsx` L80–83、`DatabaseView.tsx` L397–404、`Sidebar.tsx` L178–181 等）。当网络请求失败或后端 500 时，`req` 抛出 `Error`，调用方使用 `void` 前缀静默丢弃 Promise rejection，导致**错误被完全吞掉**，用户不会收到任何提示，UI 停留在加载/旧数据状态。场景矩阵 [#2]：api/client 非 2xx 响应已正确 `throw`，但上层调用层 100% 无 catch。
- **建议修复方向**：在 api/client 层或各调用点统一添加错误边界（React ErrorBoundary 或 toast 通知机制），至少在 `reload`、`handleSelect` 等关键路径捕获并展示错误提示。

---

#### I-003
- **层 / 文件路径 / 行号**：前端工具函数 / `web/src/utils/toBlockNote.ts` / 4–90
- **维度**：A2 / A3（边界与错误处理 / 潜在 Bug）
- **优先级**：P0
- **问题描述**：`buildBlock`（L4）入参 `b: Block` 的 `b.content` 和 `b.props` 均为 `string`，在 L66/L72/L74 使用 `JSON.parse` 时有 try/catch，但**解析失败时直接使用空默认值**（`content = []`, `props = {}`）而不记录任何警告——数据静默丢失。更危险的是 `toBlockNote(blocks)` 的返回类型为 `any[]`（L80），下游调用方 `Editor.tsx` L731 将其直接传入 `editor.replaceBlocks` 而无任何类型校验；若 BlockNote schema 不接受某块类型，调用会抛异常（catch 被静默忽略 L750–751）。场景矩阵 [#10]。
- **建议修复方向**：解析失败时 `console.warn` 记录 blockId 和原始内容；为 `toBlockNote` 添加明确的返回类型或至少 `unknown[]`；Editor 内 replaceBlocks 的 catch 块应记录错误日志而非完全静默。

---

#### I-004
- **层 / 文件路径 / 行号**：后端 Repository / `server/internal/repository/sqlite/database_repo.go` / 157–278
- **维度**：A3（潜在 Bug）
- **优先级**：P0
- **问题描述**：`ListRows`（L157）在每行上单独执行 `SELECT column_id,value FROM database_cells WHERE row_id=?`（L191–206），形成**N+1 查询**。若数据库有 100 行，将产生 101 次 SQL 查询（1 次查行 + 100 次查 cell）。在并发多用户或大型数据集下，将严重拖慢响应速度并可能导致 SQLite 写锁竞争。
- **建议修复方向**：用一次 `SELECT row_id, column_id, value FROM database_cells WHERE row_id IN (?,?,...)` 批量获取所有 cells，然后在内存中按 `row_id` 分组。参考已实现的 `batchFetchCells`（L282）逻辑作为模板。

---

### P1 — 重要（应在近期 REQ 中修复）

---

#### I-005
- **层 / 文件路径 / 行号**：前端组件 / `web/src/components/database/DatabaseView.tsx` / 876–909（`applyFilter` / `activeSorts`）
- **维度**：C3（重复后端逻辑）
- **优先级**：P1
- **问题描述**：前端在 L876–909 完整实现了与后端 `server/internal/handler/sort_filter.go`（L11–66）功能对等的 filter + sort 逻辑，且两者支持的操作符集合略有差异（后端支持 `not_contains`/`gt`/`lt`，前端字符串比较使用 `localeCompare`，后端用 `ParseFloat`）。场景矩阵 [#4]：两份实现可能出现不一致行为（大写/小写敏感、数字比较精度）。
- **建议修复方向**：将 filter/sort 参数统一传递给后端 API（`listRows` 已支持 query params），前端只负责展示；或明确约定哪一层为权威实现，删除另一层的重复逻辑。

---

#### I-006
- **层 / 文件路径 / 行号**：前端组件 / `web/src/components/database/KanbanView.tsx` L16–25 / `web/src/components/database/DatabaseView.tsx` L93–102
- **维度**：C1（重复组件）
- **优先级**：P1
- **问题描述**：`TAG_COLORS` 数组在 `DatabaseView.tsx` L93–102 和 `KanbanView.tsx` L16–25 中**逐字段完全相同地重复定义**，颜色值硬编码。同样的 `parseOptions` 函数在两个文件中也各有一份近乎相同的实现（`DatabaseView.tsx` L131–146，`KanbanView.tsx` L29–39），仅有微小差异（null 处理路径）。场景矩阵 [#3]。
- **建议修复方向**：将 `TAG_COLORS`、`parseOptions`、`tagColor` 等公共逻辑提取到 `web/src/utils/tagColors.ts` 或 `web/src/components/database/shared.ts`，所有视图组件统一引用。

---

#### I-007
- **层 / 文件路径 / 行号**：前端组件 / `web/src/components/database/GalleryView.tsx` L12–19 / `web/src/components/database/DatabaseView.tsx` L25–33
- **维度**：C2（重复工具函数）
- **优先级**：P1
- **问题描述**：`parseFileAttachments` 函数在 `DatabaseView.tsx`（L25–33）和 `GalleryView.tsx`（L12–19）中**逐字节相同地重复定义**，两处行为完全一致。若解析逻辑需要变更（如添加错误日志），必须同步修改两处，存在维护漏洞风险。
- **建议修复方向**：提取到 `web/src/utils/fileAttachments.ts` 作为共享工具函数。

---

#### I-008
- **层 / 文件路径 / 行号**：前端组件 / `web/src/components/editor/Editor.tsx` / 267–294（`FileAttachBlock`）、312–319（`BookmarkBlock`）、434–438（`PdfBlock`）
- **维度**：A2（边界与错误处理）
- **优先级**：P1
- **问题描述**：三个块组件（`FileAttachBlock`、`BookmarkBlock`、`PdfBlock`）内部直接使用**硬编码字符串** `"http://localhost:8080/api/uploads"` 和 `"http://localhost:8080/api/meta"` 发起 fetch 请求（L267、L314、L434），绕过了 `api/client.ts` 中的统一 `req<T>` 层和错误处理机制。当后端地址变更（如 Tauri 生产环境不同端口）时，这三处将独立失效且没有统一的错误拦截。
- **建议修复方向**：将上传和 meta 获取抽取为 `api.uploads.upload(file)` 和 `api.meta.fetch(url)` 方法，集中管理 BASE_URL；或至少将 BASE_URL 提取为模块级常量统一引用。

---

#### I-009
- **层 / 文件路径 / 行号**：前端组件 / `web/src/components/editor/Editor.tsx` / 799–882
- **维度**：A3（潜在 Bug）
- **优先级**：P1
- **问题描述**：column overlay 的 `useEffect`（L801）在 `editorDom` 上注册 `dragover`/`dragleave`/`drop`/`dragend` 四个事件监听器，cleanup 函数（L874–880）正确移除了这些监听器。但 `hideOverlay` 函数内部通过 `columnOverlayRef.current.remove()` 直接操作 DOM，**如果组件在 drag 进行中卸载**，`columnOverlayRef.current` 可能指向已卸载组件的遗留 DOM 节点，导致 detached DOM 节点泄漏。此外 L866 处通过 `(editor as any)._tiptapEditor?.view?.dom` 访问私有内部 API，存在 BlockNote 版本升级后 silent break 的风险。
- **建议修复方向**：在 `hideOverlay` 中增加对 `columnOverlayRef.current` 的 `isConnected` 检查；将私有 API 访问封装为 try/catch，并记录警告以便升级时检测。

---

#### I-010
- **层 / 文件路径 / 行号**：后端 Handler / `server/internal/handler/meta_handler.go` / 27–70
- **维度**：A2（边界与错误处理）、B3（Tauri 集成边界）
- **优先级**：P1
- **问题描述**：`MetaHandler`（L27）接受任意 `url` query 参数，仅校验 scheme 为 `http/https`（L34），但**未限制目标域名或 IP 范围**。攻击者可通过 `?url=http://127.0.0.1:6379/` 触发 SSRF（服务端请求伪造），探测 noteyard-server 本机运行的内网服务（Redis、数据库管理端口等）。Tauri 应用场景下，sidecar 以本地进程运行，内网服务更加暴露。
- **建议修复方向**：添加目标 IP 白名单校验（拒绝 RFC1918 私有地址、loopback、link-local）；或将 meta 抓取功能限制为仅在 Tauri 前端上下文中可用，并通过 Origin/Referer 验证请求来源。

---

#### I-011
- **层 / 文件路径 / 行号**：Tauri 集成层 / `src-tauri/src/lib.rs` / 12–65
- **维度**：A2 / B3（边界与错误处理 / Tauri 集成边界）
- **优先级**：P1
- **问题描述**：sidecar `noteyard-server` 启动后，其 stdout/stderr（即 `_rx` 被丢弃 L25）**完全被忽略**。若 sidecar 在启动后崩溃（如数据库损坏、端口被占用），Tauri 不会感知到，前端仍然渲染并发起 API 请求，用户会看到无意义的网络错误而非明确的"服务已崩溃"提示。同时 `on_window_event` 中（L49–62）只在 `Destroyed` 事件时 kill child，若应用异常退出（panic），sidecar 可能成为孤儿进程。场景矩阵 [#6]。
- **建议修复方向**：启动后在后台线程监听 `_rx` channel；sidecar 异常退出时通过 Tauri dialog 提示用户，并设置重试次数上限；使用 `on_exit` handler 确保在所有异常退出路径下都 kill sidecar。

---

#### I-012
- **层 / 文件路径 / 行号**：前端类型定义 / `web/src/types/index.ts` L1–11，后端模型 / `server/internal/model/model.go` L1–13
- **维度**：A1（类型安全）
- **优先级**：P1
- **问题描述**：前端 `Page` 接口中 `title` 定义为 `string`（`web/src/types/index.ts` L4），而后端 `model.Page`（L5）`Title` 为 `string`，两者对空值处理一致；但 `cover` 在前端为 `string | null`（L6），后端为 `*string`（L9），序列化后均为 nullable 字符串——虽然 Go 中 `*string` 可 omitempty，实际一致。
  关键不一致点：前端 `Block` 的 `content` 和 `props` 为 `string`（L17-18），但 `buildDtosRecursive`（`Editor.tsx` L658–697）构建 DTO 时将 content 赋值为 `JSON.stringify(...)` 字符串，这与 `toBlockNote.ts` 中 `JSON.parse(b.content)` 的预期一致，但**整条数据流缺少类型化中间层**，导致 `any` 在链路各处传播（Editor.tsx 中有 ≥15 处 `eslint-disable` 注释）。场景矩阵 [#9]。
- **建议修复方向**：为 BlockNote 内容格式定义 TypeScript 接口（`BNBlock`、`BNInlineContent`），替换 `any[]` 类型；审查 `Block.content` 是否可改为 `unknown` 并在解析时添加 runtime validation。

---

#### I-013
- **层 / 文件路径 / 行号**：前端组件 / `web/src/components/sidebar/Sidebar.tsx` / 540–675
- **维度**：C4 / A4（可抽象 Hook / 可读性）
- **优先级**：P1
- **问题描述**：`PageItem`（L68）和 `PageItemWithRename`（L555）是**几乎完全相同的组件**（相差仅 `renameTrigger` prop 和对应的 useEffect），形成重复类。两个组件各自独立维护相同的 `expanded`/`renaming`/`title` 状态逻辑（各约 80 行）。`RenameAwarePageItem`（L539）作为包装层的唯一作用是监听 `rename-page` 全局事件——这是一个脆弱的通信模式，全局 CustomEvent 绕过了 React 数据流。
- **建议修复方向**：合并为一个组件，通过 `renameRequested?: boolean` prop 触发重命名；考虑用 Zustand/Context 中的页面操作 store 替换全局 CustomEvent 通信。

---

#### I-014
- **层 / 文件路径 / 行号**：后端 Handler / `server/internal/handler/database_handler.go` / 34–40 vs `server/internal/handler/page_handler.go` / 48–55
- **维度**：A2（边界与错误处理）
- **优先级**：P1
- **问题描述**：两处 `Get` handler 在 repository 调用失败时均返回 404（`"database not found"`，`"page not found"`），**无论失败原因是资源不存在还是数据库 I/O 错误**。`sql.ErrNoRows` 应返回 404，其他 DB 错误应返回 500（并脱敏错误消息）。目前将真实数据库错误字符串暴露给客户端（其他 handler 如 `ListRows` L140 已正确使用 500）。
- **建议修复方向**：统一错误处理：检查 `errors.Is(err, sql.ErrNoRows)` 返回 404，其他 err 返回 500 并日志记录完整错误，响应中只返回通用错误描述。

---

#### I-015
- **层 / 文件路径 / 行号**：后端备份 / `server/internal/backup/backup.go` / 36–58
- **维度**：A3（潜在 Bug）
- **优先级**：P1
- **问题描述**：`RecordWrite`（L36）用 `atomic.Int64` 计数器，`triggerAsync` 在独立 goroutine 运行。但**两次快速触发的 `RecordWrite` 可能同时将计数器跌到 0 并各自启动一个 `go triggerAsync()`**，导致**同时并发两次备份**。两个备份会同时打开同一个 `noteyard.db` 文件（已有读写锁），但两个备份的 `destName` 以毫秒时间戳命名（L69），若在同一毫秒内生成，文件名相同，`os.Create(tmpPath)` 会发生竞争，最终 rename 阶段可能覆盖对方的 .tmp 文件。场景矩阵 [#12]。
- **建议修复方向**：引入 `atomic.Bool` 类型的 `running` 标志，在 `triggerAsync` 入口检查并 CAS 设置；或使用带缓冲的 channel（`chan struct{}`，容量 1）作为 trigger token，防止积压触发。

---

### P2 — 建议（可在条件允许时优化）

---

#### I-016
- **层 / 文件路径 / 行号**：前端设置模块 / `web/src/settings/settingsStore.ts` / 全文
- **维度**：B2（模块耦合）
- **优先级**：P2
- **问题描述**：`settingsStore.ts` 导出三类内容：纯工具函数（`loadSavedSettings`、`saveFont`、`saveTheme`）、初始化副作用（`initSettings`）、React Context（`SettingsContext`、`useSettings`）。`Editor.tsx`（L34）引用 `useSettings` 只为获取 `themeId` 以传递给 BlockNoteView，但因此将 Editor 与整个设置上下文耦合。场景矩阵 [#7]。
- **建议修复方向**：将纯工具函数拆到 `settingsUtils.ts`；React Context 保留在 `settingsStore.ts`；Editor 只 subscribe `themeId` 而无需感知完整 SettingsContext shape。

---

#### I-017
- **层 / 文件路径 / 行号**：前端组件 / `web/src/components/database/CalendarView.tsx` L32–41 / `web/src/components/database/TimelineView.tsx` L21–39
- **维度**：C4（可抽象 Hook）
- **优先级**：P2
- **问题描述**：`CalendarView` 和 `TimelineView` 都有完全相同的"月份导航"逻辑（`year`/`month` 状态 + `prevMonth`/`nextMonth` 函数），代码几乎逐行相同。
- **建议修复方向**：提取 `useMonthNav()` 自定义 hook，返回 `{ year, month, prevMonth, nextMonth }`，两个视图组件共享。

---

#### I-018
- **层 / 文件路径 / 行号**：前端组件 / `web/src/App.tsx` / 137–151（`handleChangeCover`）
- **维度**：A2（边界与错误处理）
- **优先级**：P2
- **问题描述**：`handleChangeCover` 用 `FileReader` 将图片读为 Base64 DataURL 后直接存入 `page.cover` 字段，通过 `api.pages.update` 发往后端。500KB 的图片 Base64 编码后约 660KB，**直接存入 SQLite 文本字段**。大量页面设置封面后将显著膨胀数据库体积，并且每次 `listAll` 都会传输这些数据，影响侧边栏加载性能。
- **建议修复方向**：封面图片应走 `/api/uploads` 接口存储为文件，`cover` 字段只存 URL；或对 DataURL 设置更严格的大小限制（目前 512KB 已有 alert，但未阻止）。

---

#### I-019
- **层 / 文件路径 / 行号**：前端工具函数 / `web/src/utils/toBlockNote.ts` / 85–89
- **维度**：A4（可读性与命名）
- **优先级**：P2
- **问题描述**：`findPageFlat`（`Sidebar.tsx` L534–536）是对 `findPage` 的单行包装，函数体完全等价于直接调用 `findPage(tree, id)`，无任何附加逻辑，是多余的函数声明。同类问题：`toBlockNote.ts` 中的 `buildBlock` 对 `"columns"`（旧格式，L34–52）的处理中大量 magic literal `"columnList"`、`"column"`、`"paragraph"` 缺少常量命名。
- **建议修复方向**：删除 `findPageFlat` 直接使用 `findPage`；将 block type 字符串定义为 enum 或 `as const` 对象。

---

#### I-020
- **层 / 文件路径 / 行号**：前端组件 / `web/src/components/database/DatabaseView.tsx` / 617–638（`loadAvailableDatabases`）
- **维度**：A3 / B4（潜在 Bug / 数据流一致性）
- **优先级**：P2
- **问题描述**：`loadAvailableDatabases`（L617）通过先 `listAll pages` 再对每个 page `listByPage blocks` 再对每个 database block `get database` 的三层嵌套请求方式枚举所有数据库，**时间复杂度为 O(pages × blocks_per_page)**，在页面数量多时产生大量并发请求。同时结果被缓存到 `availableDatabases` state 但无失效机制（L618 的 `if (availableDatabases.length > 0) return`），若用户在打开关联列选择器后创建了新数据库，列表不会更新。
- **建议修复方向**：后端添加 `GET /api/databases` 接口直接列出所有数据库；或至少在每次打开 addColPopover 时清空缓存。

---

#### I-021
- **层 / 文件路径 / 行号**：后端 Handler / `server/internal/handler/sort_filter.go` / 49–66
- **维度**：A4（可读性与命名）
- **优先级**：P2
- **问题描述**：`applySort` 的排序比较逻辑（L50–65）混合了数值比较和字符串比较，在 `order == "desc"` 时通过取反 `less` 实现降序（`return !less`）。这一模式在代码层面不够直观，`less` 对于 `desc` 实际语义是"大于"，变量命名具有误导性。同时 `matchFilter`（L22）的 default case 返回 `true`（L46）而非 `false`——对未知 operator 默认通过所有行，静默忽略客户端传入的错误操作符。
- **建议修复方向**：将 `!less` 逻辑改为显式 `if desc: return a > b`；default 分支记录 warn 日志并返回 false，防止未知操作符导致的意外"全通"行为。

---

#### I-022
- **层 / 文件路径 / 行号**：前端组件 / `web/src/components/database/DatabaseView.tsx` / 473–482（`commitEdit`）
- **维度**：B4（数据流一致性）
- **优先级**：P2
- **问题描述**：`commitEdit` 在 API 调用完成后执行 `void reload()`，不等待 reload 完成就清除 `editingCell` 状态（L478），导致**乐观更新不一致**：用户离开输入框后，单元格短暂回到旧值（reload 前），再切换到新值（reload 后），出现视觉闪烁。整个组件无乐观更新机制，所有写操作依赖 reload 结果，用户体验上有明显的"写后读延迟"。
- **建议修复方向**：实现乐观更新：`commitEdit` 后立即在本地 `rows` state 中更新对应 cell 值，然后后台 reload；失败时回滚并显示错误。

---

## 3. 统计汇总

### 按优先级分组

| 优先级 | 数量 | 问题 ID |
|--------|------|---------|
| P0 | 4 | I-001, I-002, I-003, I-004 |
| P1 | 11 | I-005 ~ I-015 |
| P2 | 7 | I-016 ~ I-022 |
| **合计** | **22** | |

**P0 + P1 合计：15 条**（满足验收标准 ≥10 条）

### 按层分布

| 层 | 数量 | 问题 ID |
|----|------|---------|
| 前端组件层（database/editor） | 9 | I-001, I-005, I-006, I-007, I-008, I-009, I-013, I-020, I-022 |
| 前端主入口 / 工具函数 | 3 | I-002, I-003, I-019 |
| 前端类型定义 / 设置模块 | 2 | I-012, I-016 |
| 前端视图组件（sidebar/calendar/timeline） | 2 | I-013, I-017 |
| 后端 Handler 层 | 3 | I-010, I-014, I-021 |
| 后端 Repository 层 | 2 | I-004, I-005（共享） |
| 后端配置与备份 | 1 | I-015 |
| Tauri 集成层 | 1 | I-011 |

---

## 4. 场景矩阵全覆盖结论

| # | 场景 | 结论 | 关联问题 |
|---|------|------|----------|
| 1 | DatabaseView React state 闭包竞态、useEffect 依赖数组 | **发现问题**：L453 依赖数组 eslint-disable，relationRowsCache 闭包竞态 | I-001 |
| 2 | api/client.ts fetch 全覆盖 try/catch，非 2xx reject | **发现问题**：req 本身抛出正确，但所有调用方无 catch，错误被 void 静默丢弃 | I-002 |
| 3 | KanbanView/GalleryView/CalendarView/TimelineView 列渲染逻辑重复 | **发现问题**：TAG_COLORS、parseOptions、parseFileAttachments 在多处重复定义 | I-006, I-007 |
| 4 | sort_filter.go 参数解析是否多处重复 | **发现问题**：前端独立实现 filter/sort，与后端重复；handler 内参数解析逻辑已集中在 sort_filter.go，后端层无重复 | I-005 |
| 5 | formula_eval.go 公式边界处理（除零、nil、循环依赖） | **未发现 P0/P1 问题**：除零在 parseTerm L87–89 已正确处理；nil 字段在 evalFormula L540 替换为 "0"；循环依赖检测通过 checkFormulaLoop DFS 实现（L469–513）。但 evalExpr 中 `float64(int64(v))` 在 v 超过 int64 范围时有溢出风险（低优先级）。 | — |
| 6 | sidecar 进程启停错误恢复 | **发现问题**：_rx 丢弃，sidecar 崩溃无感知，无重试机制 | I-011 |
| 7 | settingsStore.ts 是否被非设置组件引入 | **发现问题**：Editor.tsx 引用 useSettings 仅为 themeId，造成不必要耦合 | I-016 |
| 8 | Go model 层是否含业务逻辑，handler 是否绕过 repository | **未发现问题**：model.go 为纯数据结构；所有 handler 均通过 repository 接口访问 DB，无直接 DB 操作 | — |
| 9 | types/index.ts 与后端 model 一致性，any/object 风险 | **发现问题**：Block.content/props 的 string↔JSON 类型转换链路全程 any，缺少中间类型 | I-012 |
| 10 | toBlockNote.ts null/undefined 防御，转换失败静默丢失 | **发现问题**：JSON.parse 失败静默置空，无 warn 日志；返回 any[] | I-003 |
| 11 | 各组件 useEffect 键盘事件清理 | **基本合格，有局部问题**：App.tsx L161–175 的 keydown handler 有完整 cleanup；Editor.tsx L780–797 的 click handler 有 cleanup；Editor.tsx L801–882 的 columnOverlay dragover 有 cleanup。主要风险是 overlay DOM 可能泄漏（见 I-009）。 | I-009 |
| 12 | backup.go 超时控制、并发锁、高频写入多次备份 | **发现问题**：RecordWrite 并发竞态可导致同毫秒内两次备份写相同文件名的 .tmp | I-015 |

---

## 5. 架构建议

**AR-1 拆分 DatabaseView.tsx（≈1917 行）**  
当前文件承载了完整的数据库组件状态机、所有视图（table/kanban/gallery/list/calendar/timeline）的 JSX 渲染、列管理弹窗、行详情弹窗、批量操作栏。建议按视图模式拆分：`DatabaseViewTable`、`DatabaseViewKanban` 等，`DatabaseView` 只负责状态协调和视图路由，通过 props 下发数据和操作回调。

**AR-2 建立统一错误处理层**  
目前所有 API 错误均通过 `void` 调用静默丢弃。建议引入全局错误 toast（如 `react-hot-toast`）并在 `api/client.ts` 的 `req` 函数中集成，或通过 React Context 提供 `onError` 回调，避免 UI 在无感知的情况下失去状态。

**AR-3 前后端共享 filter/sort 契约**  
前端目前维护了独立的 filter/sort 实现，与后端逻辑存在语义差异。建议明确"单一权威"：将所有 filter/sort 移至后端（API 参数驱动），前端只做 UI 状态管理，删除前端重复计算逻辑。如需本地即时响应，通过 optimistic local filter + background reload 实现。

**AR-4 Tauri 层增加 sidecar 健康监控**  
当前 sidecar 的 stdout/stderr channel（`_rx`）被丢弃，进程状态对 Tauri 完全不可见。建议在 setup 中 spawn 一个监听线程读取 `_rx`，遇到进程退出信号时通过 Tauri event 通知前端，并弹出对话框提示用户重启。同时通过 `Child::wait` 检测退出码，区分正常关闭与崩溃。

**AR-5 引入轻量级前端状态管理**  
当前 `App.tsx` 承担了全局状态中枢（selectedPageId、pageMeta、backlinks、view、sidebarKey），通过 props 和回调下发给 Sidebar/Editor/Breadcrumb，形成深层 props drilling。建议引入 Zustand 管理全局 page 选择状态，各组件直接 subscribe，减少 App.tsx 的状态管理负担和不必要的重渲染。

---

## 6. 复用机会清单

| 候选名称 | 类型 | 当前重复位置 | 说明 |
|----------|------|-------------|------|
| `parseFileAttachments` | 工具函数 | `DatabaseView.tsx` L25, `GalleryView.tsx` L12 | 提取到 `web/src/utils/fileAttachments.ts` |
| `TAG_COLORS` / `tagColor` / `parseOptions` | 常量 + 工具函数 | `DatabaseView.tsx` L93, `KanbanView.tsx` L16 | 提取到 `web/src/components/database/shared.ts` |
| `useMonthNav` | 自定义 Hook | `CalendarView.tsx` L13–27, `TimelineView.tsx` L13–39 | 提取 `{ year, month, prevMonth, nextMonth }` hook |
| `useKeyboardShortcuts` | 自定义 Hook | `App.tsx` L161–175（全局快捷键）| 封装为 `useKeyboardShortcuts(handlers: Record<string, () => void>)` |
| `useRowEditor` | 自定义 Hook | `DatabaseView.tsx` L471–527（单元格编辑状态）| 封装 `editingCell`/`cellDraft`/`commitEdit`/`startEdit` 状态逻辑 |
| `parseParamsMiddleware` | 后端中间件 | `database_handler.go` L147–158（filter/sort 参数解析）| 提取为 `ParseSortFilter(r *http.Request) (sortCol, sortOrder, filterCol, filterOp, filterVal string)` helper |
| API BASE_URL | 常量 | `api/client.ts` L3, `Editor.tsx` L267/314/434 | 统一为模块常量或环境变量，删除 Editor 内硬编码 |

---

*报告由总架构师（arch）于 2026-05-02 生成，基于 dispatch #38 / REQ-063 任务要求。本轮审查仅产出报告，未修改任何代码文件，git diff 为空。*
