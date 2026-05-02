# ARCH-PLAN-FRONTEND — REQ-064 前端修复技术方案

| 字段 | 内容 |
|------|------|
| 文档 ID | ARCH-PLAN-FRONTEND |
| 版本 | v2.0（REQ-064 更新） |
| 日期 | 2026-05-02 |
| 作者角色 | 前端架构师-REQ064-66 |
| 关联 REQ | REQ-064 |
| 状态 | 待实现 |

---

## 1. 概述

本轮覆盖 REQ-064 前端问题清单全部 **16 个**待修复问题，跨以下层级：

| 优先级 | 问题数 | 涉及层面 |
|--------|--------|----------|
| P0（紧急） | 3 | 竞态、错误处理、数据静默丢失 |
| P1（重要） | 7 | 重复代码、硬编码、DOM 泄漏、类型 any、组件重复、Tauri 集成 |
| P2（建议） | 6 | 耦合、重复 hook、Base64 存储、冗余函数、O(n) 请求、乐观更新 |

架构建议同步落地：AR-1（DatabaseView 拆分）、AR-2（统一错误层）、AR-5（Zustand 引入）。

---

## 2. 各问题修复方案

### I-001 — DatabaseView useEffect 竞态（P0）

**方案选择：使用 AbortController 标记过期 effect + useRef 持久化缓存**

REQ-064 提供了两个方向：useCallback 重构依赖 vs useRef 保存缓存。选择后者，原因：
- 当前 effect（L409–452）同时做"批量加载"和"写缓存"两件事，拆出 useCallback 会让依赖链更复杂，`rows` 和 `db` 的双重依赖难以彻底消除。
- `relationRowsCache` 本身已是 `useRef`，问题核心是 effect 在新一轮触发前旧轮异步操作写回已过期的 cache。用 AbortController（或局部 `cancelled` ref）在 effect cleanup 里标记取消，异步操作回调前检查 `cancelled` 再决定是否写入，即可杜绝竞态。

**影响范围：**
- `web/src/components/database/DatabaseView.tsx`，L408–452（relation 批量加载 effect）

**注意事项：**
1. `rows` 在依赖数组中，每次 `setRows(r => [...r])` 都会重新触发此 effect，形成循环。修复后应在 effect 内用 stable 的 `databaseId` 驱动，rows 仅作只读读取而非依赖触发源；或将 relation 加载逻辑抽入 `useRelationCache(databaseId, db, rows)` 自定义 hook，在 hook 内用 `useEffect` + `useRef(rows)` 避免循环。
2. `changed` flag 触发 `setRows(r => [...r])` 是强制重渲的粗暴方式，修复后改为仅在真正有新数据时触发，减少不必要渲染。

---

### I-002 — API 错误处理缺失（P0）

**方案选择：在 api/client.ts 的 req 函数内保持 toast 集成，消除调用方 void 吞弃**

`client.ts` 已有 `import toast from "react-hot-toast"`（L1）且在 catch 块中调用了 `toast.error()`（L20），该层已具备能力。问题是调用方用 `void` 前缀吞掉了 rejection，导致 toast 在某些路径仍不可靠。

修复步骤：
1. `req` 中的 `toast.error` 已覆盖全部 throw 路径，无需改动。
2. 在所有调用方将 `void someApiCall()` 改为 `.catch(() => {})` 或改成 `await`（在 async 函数内），核心是不再让调用方静默吞弃 rejection。
3. 对于确实不需要等待结果的"fire and forget"场景（如 `void reload()`），`reload` 自身需有 catch 路由到 toast。

不引入全局 React Context onError，原因：client 层已在非 React 上下文中正常工作，引入 Context 反而增加耦合。

**影响范围：**
- `web/src/api/client.ts` — 确认 catch 覆盖完整（目前已有，基本满足）
- `web/src/App.tsx` L80–83 — 将 `void api.xxx()` 改为 await/catch
- `web/src/components/database/DatabaseView.tsx` L397–404 — reload 调用处
- `web/src/components/sidebar/Sidebar.tsx` L178–181 — 加载调用处

**注意事项：**
1. `req` 内已有 `toast.error` 但也会 re-throw，调用方的 unhandled rejection 在生产 build 中只会出现在 console，不影响 toast 显示。但若调用方在 `useEffect` 内，React 严格模式会捕获并报 uncaught error，导致 error boundary 触发。应在 effect 内统一用 `.catch(() => {})` 终结 rejection 链。
2. 不要在 `req` 内吃掉 throw（即不要去掉 `throw err`），上层调用方需要知道操作是否成功以决定是否继续（如 `submitNewCol` 里的 catch block）。

---

### I-003 — toBlockNote 静默丢失数据（P0）

**方案选择：在 catch 块添加 console.warn + 明确返回类型**

已读取 `web/src/utils/toBlockNote.ts`：当前版本已经在多处 catch 块中添加了 `console.warn('[toBlockNote] parse failed for block', col.id, e)`（L17、36、66、72、74），并从 `../types/blocknote` 导入了 `BNBlock` 类型，函数返回 `BNBlock[]`。此问题在当前代码中**已部分修复**。

需要确认的额外项：
1. `toBlockNote` 函数签名返回 `BNBlock[]`，确保 `BNBlock` 定义完整（有 `id`、`type`、`props`、`content`、`children` 字段），不含 `any`。
2. `Editor.tsx` L731、L750–751 的 `replaceBlocks` catch 块需要加 `console.error` 日志（不能静默）。
3. `toBlockNote.ts` 中 block type 字符串（`"database"`, `"subpage"`, `"fileAttach"` 等）以 magic literal 出现，应使用 enum 或 `as const` 对象统一（与 I-019 合并处理）。

**影响范围：**
- `web/src/utils/toBlockNote.ts` — 确认 warn 覆盖所有 parse 路径（已有）
- `web/src/types/blocknote.ts`（或同路径）— 确认 BNBlock 类型定义无 any
- `web/src/components/editor/Editor.tsx` L731、L750–751 — replaceBlocks catch 块添加日志

**注意事项：**
catch 块内的 warn 不应包含原始内容全文（可能含敏感数据），只记录 blockId 和错误类型即可。修复后去掉 `toBlockNote` 签名上的 `any[]` 返回类型注解（如有残留）。

---

### I-006 — TAG_COLORS/parseOptions 重复（P1）

**方案选择：提取到 `web/src/components/database/shared.ts`**

`TAG_COLORS` 数组在 `DatabaseView.tsx`（L93–102）和 `KanbanView.tsx`（L16–25）完全相同；`parseOptions` 在两处实现相似（KanbanView 版本对 `raw` 有 `?? "[]"` 保护，DatabaseView 版本没有）。

选择 `shared.ts` 而非 `utils/tagColors.ts`，原因：这两者都是 database 功能域专属，放在 `utils/` 层级过于通用化。

`shared.ts` 导出：
- `TAG_COLORS` 常量
- `tagColor(val: string)` 哈希函数
- `parseOptions(raw: string): SelectOption[]` — 合并两处实现，保留 `?? "[]"` 保护
- `serializeOptions(opts: SelectOption[]): string`
- `SelectOption` 接口

**影响范围：**
- 新建 `web/src/components/database/shared.ts`
- `web/src/components/database/DatabaseView.tsx` — 删除本地定义，改为 import
- `web/src/components/database/KanbanView.tsx` — 删除本地定义，改为 import

**注意事项：**
`SelectOption` 接口在 DatabaseView 和 KanbanView 各自定义，迁移时使用同一个定义，注意两处字段完全一致（`value: string; colorIdx: number`）。`serializeOptions` 是纯单行函数（JSON.stringify 包装），一并放入 `shared.ts`。

---

### I-007 — parseFileAttachments 重复（P1）

**方案选择：提取到 `web/src/utils/fileAttachments.ts`**

`parseFileAttachments` 在 `DatabaseView.tsx`（L25–33）和 `GalleryView.tsx`（L12–19）逐字节相同。GalleryView 版本缺少 console.warn，合并时保留 warn 版本。

此函数不属于 database 功能域专属（Editor 等将来也可能用到），放 `utils/` 合适。

**影响范围：**
- 新建 `web/src/utils/fileAttachments.ts`
- `web/src/components/database/DatabaseView.tsx` — 删除本地定义，改为 import
- `web/src/components/database/GalleryView.tsx` — 删除本地定义，改为 import

**注意事项：**
`FileAttachment` 类型需从 `../../types` 正确引用，确保 `utils/fileAttachments.ts` 的类型路径解析正确。

---

### I-008 — Editor 内硬编码 localhost URL（P1）

**方案选择：从 api/client.ts 导出 API_BASE 常量，Editor.tsx 引用**

`api/client.ts` L4 有 `const BASE = "http://localhost:8080/api"`，Editor.tsx（L267、314、434）直接硬编码相同 URL。从 `api/client.ts` 导出 `API_BASE`（或 `export const API_BASE`）常量，Editor.tsx 的 `FileAttachBlock`、`BookmarkBlock`、`PdfBlock` 使用导入的常量拼接路径。

不必为每个资源抽取独立 `api.xxx()` 方法（那是更大的重构），仅统一常量即可保持修改点单一。

**影响范围：**
- `web/src/api/client.ts` — 将 `const BASE` 改为 `export const API_BASE`
- `web/src/components/editor/Editor.tsx` L267、L312–319、L434–438 — 替换硬编码字符串

**注意事项：**
`api/client.ts` 中 `batchUpdateBeacon` 也硬编码了 `BASE + "/blocks/batch"`（L79），一并修复。后续若需支持自定义后端地址，只需修改 `API_BASE` 一处。

---

### I-009 — column overlay DOM 泄漏（P1）

**方案选择：isConnected 检查 + try/catch 包装 _tiptapEditor 访问**

`hideOverlay` 函数在调用 `columnOverlayRef.current.remove()` 前应先检查：
```ts
if (columnOverlayRef.current?.isConnected) {
  columnOverlayRef.current.remove();
}
```
私有 API `_tiptapEditor` 访问用 try/catch 包装，catch 块记录 `console.warn`。

不做更大重构（如改用 React Portal 管理 overlay），原因：该 overlay 是 TipTap 内部拖拽交互的配合产物，Portal 方案需要理解 TipTap 内部生命周期，风险高于收益。

**影响范围：**
- `web/src/components/editor/Editor.tsx` L799–882 — hideOverlay 函数 + _tiptapEditor 调用处

**注意事项：**
组件卸载时需在 cleanup 函数中调用 `hideOverlay()`，确保不残留 DOM 节点。如果已有 cleanup，确认 cleanup 内有 `isConnected` 检查。

---

### I-011 — Tauri sidecar 无崩溃感知（P1）

**方案选择：后台线程监听 _rx + on_exit 覆盖异常退出路径**

`src-tauri/src/lib.rs` L25 中 `_rx` 被丢弃（`let (_rx, child) = ...`）。修复步骤：
1. 保留 `_rx` 并在 `spawn` 成功后，另起 `std::thread::spawn` 消费 `_rx`，监听 `TerminatedPayload`；sidecar 异常退出时通过 `app_handle.dialog().message(...)` 提示用户，并提供重启或退出选项（重试上限设为 3 次）。
2. `on_window_event` 目前只处理 `Destroyed`，需补充对异常退出路径的覆盖，或用 app 级 `on_exit` handler。

**影响范围：**
- `src-tauri/src/lib.rs` L25（_rx 丢弃处）、L49–62（on_window_event）

**注意事项：**
1. 重试逻辑需将重试次数存入 `Mutex<u32>` 状态，超限后不再重启，直接提示退出。
2. dialog 调用在后台线程必须用 `blocking_show()`，不可用异步版本。
3. Tauri v2 的 `CommandChild` 有 `on_event` 回调，可替代手动消费 `_rx` channel，但需确认 API 签名稳定性。

---

### I-012 — Block 类型链路 any 泛滥（P1）

**方案选择：在 types/blocknote.ts 定义 BNBlock 接口，渐进式替换 any**

不求一步到位消除所有 `any`，采用渐进式策略：
1. 确认 `web/src/types/blocknote.ts` 已有 `BNBlock` 类型，其中 `content` 和 `props` 有明确类型（非 `any`）。
2. `Block.content` 在 `web/src/types/index.ts` 为 `string` 类型（序列化 JSON），不改，但解析后的中间类型明确为 `BNBlock[]`。
3. Editor.tsx 内超过 15 处 `eslint-disable @typescript-eslint/no-explicit-any`：优先消除 `replaceBlocks` 调用处的 any（用 `BNBlock[]` cast 替代），其余标注 TODO 供后续轮次逐步消除。
4. 不将 `Block.content` 改为 `unknown`，原因：变更核心类型会影响后端 API 响应反序列化路径，风险超过收益。

**影响范围：**
- `web/src/types/index.ts` — 不修改，确认无 any 字段
- `web/src/types/blocknote.ts`（新建或已有）— BNBlock、BNInlineContent 接口
- `web/src/components/editor/Editor.tsx` — replaceBlocks 调用处替换 any

**注意事项：**
`BNBlock.content` 字段在 BlockNote 中区分不同 block 类型有不同结构（InlineContent[] | undefined），定义时使用 union type 而非 `unknown`，以便下游组件有类型推断。

---

### I-013 — PageItem/PageItemWithRename 重复组件（P1）

**方案选择：合并为单一组件 + 用 Zustand 替换全局 CustomEvent**

`Sidebar.tsx` 中 `PageItem`（L68–约195）和 `PageItemWithRename`（L555–约675）几乎完全相同，差异仅为 `renameTrigger` prop 和对应的 useEffect。`RenameAwarePageItem`（L539–553）作为包装层监听全局 CustomEvent。

修复方案：
1. **合并组件**：将 `PageItemWithRename` 的逻辑合入 `PageItem`，添加可选 prop `renameRequested?: boolean`，由父层传入。当 `renameRequested` 为 true 时触发 `setRenaming(true)`，等效于原 renameTrigger。
2. **替换 CustomEvent**：引入 Zustand store（`useSidebarStore`），store 中维护 `renamingPageId: string | null`。触发重命名的地方 dispatch `setRenamingPageId(pageId)`，PageItem 通过 selector 订阅 `renamingPageId === page.id` 判断是否进入 rename 模式。

不选择 React Context 方案，原因：Context 会导致 Sidebar 树所有 PageItem 在 rename 状态变化时全部重渲，Zustand 的 selector 可精确订阅，只让目标 PageItem 重渲。

**影响范围：**
- `web/src/components/sidebar/Sidebar.tsx` — 合并 PageItem/PageItemWithRename/RenameAwarePageItem
- 新建 `web/src/stores/sidebarStore.ts`（若 Zustand 整体引入在 AR-5 计划内，可同步创建）
- `package.json` — 添加 `zustand` 依赖（如未有）

**注意事项：**
1. `findPageFlat`（I-019）也在 Sidebar.tsx，合并时一并删除。
2. Zustand store 不需要 Provider，直接 import 即可，无需修改 App.tsx 树结构。
3. 合并组件时需保留 `depth` prop 控制的缩进逻辑，不要遗漏。

---

### I-016 — settingsStore 耦合（P2）

**方案选择：Editor 只 subscribe themeId selector**

Editor.tsx L34 用 `useSettings()` 拿到整个 settings 对象但只用 `themeId`。若 settings store 基于 Zustand，修改为：

```ts
const themeId = useSettingsStore(s => s.themeId);
```

不拆 `settingsUtils.ts`，原因：纯工具函数拆分代价高于收益，且当前 themeId 用法是 React hook 场景，不属于"纯工具函数"范畴。

**影响范围：**
- `web/src/components/editor/Editor.tsx` L34 — 修改 useSettings 调用为 selector
- `web/src/settings/settingsStore.ts` — 确认已导出 selector 友好的 store

**注意事项：**
若 `settingsStore` 尚未基于 Zustand（仍是 Context），此修复需等 AR-5 Zustand 迁移完成后再做，避免两次改动。

---

### I-017 — useMonthNav 重复（P2）

**方案选择：提取 useMonthNav() 自定义 hook**

`CalendarView.tsx`（L13–26）和 `TimelineView.tsx`（L15–40）均有 `year`/`month` state + `prevMonth`/`nextMonth` 函数，逻辑等价（TimelineView 的 prevPeriod/nextPeriod 在 granularity=month 时与 CalendarView 完全一样）。

`useMonthNav` hook 签名：
```ts
function useMonthNav(initialYear?: number, initialMonth?: number): {
  year: number;
  month: number;
  prevMonth: () => void;
  nextMonth: () => void;
}
```

TimelineView 的 week 粒度 prevPeriod/nextPeriod 保留在组件内，不纳入 hook，原因：week 粒度逻辑是 TimelineView 特有的，强行放入 hook 会增加 hook 复杂度。

**影响范围：**
- 新建 `web/src/hooks/useMonthNav.ts`
- `web/src/components/database/CalendarView.tsx` — 替换本地实现
- `web/src/components/database/TimelineView.tsx` — month 粒度部分替换

**注意事项：**
hook 内用 `new Date()` 计算默认值时，注意测试时可能需要 mock `Date`，建议接受 `initialYear/initialMonth` 参数而非在 hook 内硬依赖 `new Date()`。

---

### I-018 — 封面图 Base64 存 SQLite（P2）

**方案选择：封面图走 /api/uploads，cover 字段只存 URL**

`App.tsx` L137–151 的 `handleChangeCover` 将图片读取为 Base64 DataURL 后直接存入 `page.cover`。每张封面图约 50KB–500KB（Base64 膨胀约 33%），大量页面时严重膨胀 SQLite 且影响 `GET /api/pages` 的 JSON 响应体积。

修复方案：
1. `handleChangeCover` 读取文件后，调用 `api.uploads.upload(file)` 上传（需添加该 API 方法），返回 URL 后更新 `page.cover = url`。
2. 若 `uploads` API 尚未存在（需与后端 REQ-065 对齐），本轮方案只规划接口形态，实现时等后端接口就绪。

**影响范围：**
- `web/src/App.tsx` L137–151
- `web/src/api/client.ts` — 新增 `uploads.upload(file: File): Promise<{ url: string }>`
- 后端（REQ-065 范围）— `POST /api/uploads` 接口

**注意事项：**
1. 迁移前已存入的 Base64 封面需做一次性迁移或在前端读取时判断是否为 DataURL（`startsWith("data:")`），旧数据降级展示。
2. 上传失败时应有错误提示，不要静默回退到 Base64 存储（违反 I-002 修复原则）。

---

### I-019 — findPageFlat 多余 + magic literal（P2）

**方案选择：删除 findPageFlat + 定义 BLOCK_TYPES as const**

`findPageFlat`（Sidebar.tsx L534–536）是单行包装：`return findPage(tree, id)`，无任何额外逻辑，直接删除，调用方改用 `findPage`。

`toBlockNote.ts` 中的 block type 字符串定义为 `as const` 对象：

```ts
// web/src/types/blockTypes.ts
export const BLOCK_TYPES = {
  DATABASE: "database",
  SUBPAGE: "subpage",
  FILE_ATTACH: "fileAttach",
  BOOKMARK: "bookmark",
  EMBED: "embed",
  PDF: "pdf",
  BUTTON: "button",
  COLUMN_LIST: "columnList",
  COLUMN: "column",
} as const;

export type BlockType = typeof BLOCK_TYPES[keyof typeof BLOCK_TYPES];
```

**影响范围：**
- `web/src/components/sidebar/Sidebar.tsx` L534–536 — 删除 findPageFlat，替换调用方
- 新建 `web/src/types/blockTypes.ts`
- `web/src/utils/toBlockNote.ts` — 替换字符串字面量

**注意事项：**
block type 字符串与后端数据库存储的 type 字段一一对应，不可随意改名，`as const` 确保类型精确。

---

### I-020 — loadAvailableDatabases O(n) 请求（P2）

**方案选择：每次打开 addColPopover 时清空缓存（短期）+ 规划后端接口（长期）**

当前 `loadAvailableDatabases`（L616–636）三层嵌套请求：listAll pages → 每页 listBlocks → 每个 database block get，O(pages × blocks_per_page) 请求数。缓存无失效机制（判断 `availableDatabases.length > 0` 就跳过）。

**短期方案**（不依赖后端改动）：
- 将缓存改为 `useRef<Database[] | null>`（null 表示未加载，[] 表示真实空），每次打开 addColPopover 时重置为 null 触发重新加载。
- 加 loading state，在加载中显示 spinner，避免 relation 选择器空白误导用户。

**长期方案**（与后端 REQ-065 对齐）：
- 后端新增 `GET /api/databases` 接口，一次返回所有数据库，O(1) 请求。
- 前端 `loadAvailableDatabases` 改为单次 API 调用。

本轮规划短期方案，长期方案在 ARCH-PLAN-BACKEND 中一并提出。

**影响范围：**
- `web/src/components/database/DatabaseView.tsx` L616–636、L366–368

**注意事项：**
清空缓存后重新加载会有短暂延迟，需要 loading indicator。用户重复打开/关闭 addColPopover 时不应每次都重新加载，可加 debounce 或仅在 popover 从关闭→打开时触发一次。

---

### I-022 — commitEdit 乐观更新缺失（P2）

**方案选择：commitEdit 后立即在本地 rows state 更新，后台 reload，失败时回滚**

当前 `commitEdit`（L475–480）流程：setEditingCell(null) → await API 更新 → void reload()。步骤 1 和步骤 3 之间单元格会回到旧值（来自 rows state），出现视觉闪烁。

修复方案（伪代码）：
```ts
const commitEdit = async (rowId: string, colId: string) => {
  const prevRows = rows;  // 保存回滚快照
  // 乐观更新
  setRows(rs => rs.map(r =>
    r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: cellDraft } } : r
  ));
  setEditingCell(null);
  try {
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value: cellDraft }]);
    void reload();  // 后台同步，刷新计算列（formula/rollup）
  } catch {
    setRows(prevRows);  // 失败时回滚
  }
};
```

`useRowEditor` hook（见第4节）可封装此逻辑。

**影响范围：**
- `web/src/components/database/DatabaseView.tsx` L475–480

**注意事项：**
1. 乐观更新后 `void reload()` 会再次设置 rows，如果 reload 比用户下一次编辑更慢，需确保 reload 不会覆盖用户正在编辑中的值（editingCell 非 null 时，reload 后不覆盖该 cell）。
2. formula 和 rollup 列依赖其他列的值，乐观更新不能预算这些列，因此后台 reload 仍有必要。

---

## 3. DatabaseView 拆分结构图

当前 `DatabaseView.tsx` 约 1917 行，承担状态管理、视图路由、表格渲染、弹出层管理等全部职责。拆分后结构如下：

```
DatabaseView（容器，状态协调 + 视图路由）
├── 状态层（hooks，可选抽取）
│   ├── useRowEditor         封装 editingCell/cellDraft/commitEdit/startEdit/乐观更新
│   ├── useColumnManager     封装 colMenu/addColPopover/submitNewCol/deleteCol/changeColType
│   ├── useToolbar           封装 sortStates/filterStates/toolbarPanel/groupByColId
│   └── useRelationCache     封装 relationRowsCache + 批量加载 effect（修复 I-001）
│
├── 视图层（已有，接收 props）
│   ├── TableView            从 DatabaseView 内联表格 JSX 中提取（新组件）
│   │   ├── TableHeader      col 表头行（含 resize handle、ColMenu 触发）
│   │   └── TableBody        行渲染、单元格 switch、批量选择
│   ├── KanbanView           已有
│   ├── GalleryView          已有
│   ├── CalendarView         已有
│   ├── TimelineView         已有
│   └── ListView             从 DatabaseView 内联 list JSX 中提取（新组件，含 ListGroup）
│
├── 弹出层（已有或新提取）
│   ├── ColMenu              已在 JSX 中，可提取为独立组件
│   ├── AddColPopover        已在 JSX 中，可提取为独立组件
│   ├── FormulaPopover       已在 JSX 中，可提取为独立组件
│   ├── SelectOptionsPopover 已在 JSX 中
│   ├── SelectDropdown       已在 JSX 中
│   └── RowModal             已在 JSX 中，可提取为独立组件
│
└── 子组件（已有）
    ├── RowContentEditor     已存在（L163–244）
    ├── SortableOptionRow    已存在（L247–295）
    ├── ListGroup            已存在（L297–331）
    ├── FilesCell            独立文件
    ├── FilesModalField      独立文件
    ├── RelationCell         独立文件
    ├── RollupConfigPopover  独立文件
    ├── ColorDotPicker       独立文件
    └── Chip                 独立文件
```

**拆分原则：**
- `DatabaseView` 保留状态（`db`、`rows`、`viewMode`、弹出层开关）和数据加载逻辑，不渲染任何 DOM。
- `TableView` 接收 `{ columns, rows, editingCell, ... }` 纯 props，不直接访问全局 state。
- hook 层可选：若一次性拆分风险过高，先拆出 `TableView` 和 `ListView`，hook 层作为第二轮任务。

---

## 4. 提取工具函数/Hook 清单

| 名称 | 类型 | 目标路径 | 迁移自 | 预计影响组件数 |
|------|------|----------|--------|--------------|
| `parseFileAttachments` | 工具函数 | `web/src/utils/fileAttachments.ts` | DatabaseView.tsx L25, GalleryView.tsx L12 | 2 |
| `TAG_COLORS` | 常量 | `web/src/components/database/shared.ts` | DatabaseView.tsx L93, KanbanView.tsx L16 | 3 |
| `tagColor` | 工具函数 | `web/src/components/database/shared.ts` | DatabaseView.tsx L104 | 2 |
| `parseOptions` | 工具函数 | `web/src/components/database/shared.ts` | DatabaseView.tsx L131, KanbanView.tsx L29 | 3 |
| `serializeOptions` | 工具函数 | `web/src/components/database/shared.ts` | DatabaseView.tsx L148 | 1 |
| `SelectOption` | 接口 | `web/src/components/database/shared.ts` | DatabaseView.tsx, KanbanView.tsx | 2 |
| `BLOCK_TYPES` | as const 对象 | `web/src/types/blockTypes.ts` | toBlockNote.ts（magic literals） | 2 |
| `useMonthNav` | 自定义 Hook | `web/src/hooks/useMonthNav.ts` | CalendarView.tsx L13, TimelineView.tsx L15 | 2 |
| `useRowEditor` | 自定义 Hook | `web/src/hooks/useRowEditor.ts` | DatabaseView.tsx L471–527 | 1 |
| `useKeyboardShortcuts` | 自定义 Hook | `web/src/hooks/useKeyboardShortcuts.ts` | App.tsx L161–175 | 1 |
| `API_BASE` | 导出常量 | `web/src/api/client.ts` | client.ts L4, Editor.tsx L267/314/434 | 2 |
| `useSidebarStore` | Zustand store | `web/src/stores/sidebarStore.ts` | Sidebar.tsx CustomEvent 通信 | 1 |

---

## 5. 实现任务拆分建议

按优先级 P0 → P1 → P2 排列，每个任务建议由单独工程师 commit，符合"一角色一 commit"规范。

### P0 — 必须先行

```
[P0] 修复 I-002：确认 api/client.ts toast 覆盖 + 消除所有 void api.xxx() 静默吞弃
     — web/src/api/client.ts, web/src/App.tsx,
       web/src/components/database/DatabaseView.tsx,
       web/src/components/sidebar/Sidebar.tsx

[P0] 修复 I-003：Editor.tsx replaceBlocks catch 块添加日志 + 确认 BNBlock 类型无 any
     — web/src/components/editor/Editor.tsx,
       web/src/types/blocknote.ts

[P0] 修复 I-001：relation 批量加载 effect 引入 AbortController 消除竞态，
     提取为 useRelationCache hook（可选）
     — web/src/components/database/DatabaseView.tsx (L408–452),
       可选新建 web/src/hooks/useRelationCache.ts
```

### P1 — 重要修复

```
[P1] 修复 I-008：api/client.ts 导出 API_BASE，Editor.tsx 替换硬编码 URL（含 batchUpdateBeacon）
     — web/src/api/client.ts,
       web/src/components/editor/Editor.tsx

[P1] 修复 I-006 + I-007：提取 shared.ts 和 fileAttachments.ts
     — 新建 web/src/components/database/shared.ts,
       新建 web/src/utils/fileAttachments.ts,
       web/src/components/database/DatabaseView.tsx,
       web/src/components/database/KanbanView.tsx,
       web/src/components/database/GalleryView.tsx

[P1] 修复 I-013：合并 PageItem/PageItemWithRename，引入 Zustand useSidebarStore 替换 CustomEvent
     — web/src/components/sidebar/Sidebar.tsx,
       新建 web/src/stores/sidebarStore.ts,
       package.json

[P1] 修复 I-009：Editor.tsx column overlay isConnected 检查 + _tiptapEditor try/catch
     — web/src/components/editor/Editor.tsx (L799–882)

[P1] 修复 I-011：lib.rs 后台线程监听 _rx，sidecar 崩溃弹 dialog，on_exit 覆盖退出路径
     — src-tauri/src/lib.rs

[P1] 修复 I-012：定义/完善 BNBlock 类型，消除 Editor.tsx replaceBlocks 处 any，标注其余 TODO
     — web/src/types/blocknote.ts,
       web/src/components/editor/Editor.tsx

[P1] DatabaseView 拆分（AR-1）：提取 TableView + ListView 组件，DatabaseView 保留状态协调
     — web/src/components/database/DatabaseView.tsx
       → 新建 web/src/components/database/TableView.tsx,
         新建 web/src/components/database/ListView.tsx
```

### P2 — 建议改进

```
[P2] 修复 I-022：commitEdit 乐观更新 + 失败回滚，可封装 useRowEditor hook
     — web/src/components/database/DatabaseView.tsx (L475–480),
       可选新建 web/src/hooks/useRowEditor.ts

[P2] 修复 I-017：提取 useMonthNav hook
     — 新建 web/src/hooks/useMonthNav.ts,
       web/src/components/database/CalendarView.tsx,
       web/src/components/database/TimelineView.tsx

[P2] 修复 I-019：删除 findPageFlat + 定义 BLOCK_TYPES as const
     — web/src/components/sidebar/Sidebar.tsx (L534–536),
       新建 web/src/types/blockTypes.ts,
       web/src/utils/toBlockNote.ts

[P2] 修复 I-020：loadAvailableDatabases 缓存失效修复 + loading state
     — web/src/components/database/DatabaseView.tsx (L616–638)

[P2] 修复 I-016：Editor 仅 subscribe themeId selector
     — web/src/components/editor/Editor.tsx (L34),
       web/src/settings/settingsStore.ts

[P2] 修复 I-018：handleChangeCover 改走 /api/uploads（需与后端 REQ-065 对齐后实施）
     — web/src/App.tsx (L137–151),
       web/src/api/client.ts

[P2] 提取 useKeyboardShortcuts hook（AR-5 预备）
     — web/src/App.tsx (L161–175),
       新建 web/src/hooks/useKeyboardShortcuts.ts
```

---

*本文档由前端架构师-REQ064-66 于 2026-05-02 产出，仅包含方案规划，不含实现代码。*
