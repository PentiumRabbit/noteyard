# ARCH-PLAN-FRONTEND — 前端修复技术方案

| 字段 | 内容 |
|------|------|
| 方案 ID | ARCH-PLAN-FRONTEND |
| 对应需求 | REQ-064 |
| 来源审查 | CODE-REVIEW-001 |
| 日期 | 2026-05-02 |
| 产出人 | 前端架构师（arch-frontend） |
| dispatch ID | 39 |

---

## 1. 执行摘要

本方案覆盖 CODE-REVIEW-001 中属于前端责任的 **16 个问题**（I-001、I-002、I-003、I-006、I-007、I-008、I-009、I-011、I-012、I-013、I-016、I-017、I-018、I-019、I-020、I-022），以及架构建议 AR-1（DatabaseView 拆分）、AR-2（统一错误处理）、AR-5（Zustand 状态管理引入）。

### 问题分布

| 优先级 | 问题 ID | 数量 |
|--------|---------|------|
| P0 | I-001、I-002、I-003 | 3 |
| P1 | I-006、I-007、I-008、I-009、I-011、I-012、I-013 | 7 |
| P2 | I-016、I-017、I-018、I-019、I-020、I-022 | 6 |

### 核心原则

1. 每个修复最小范围原则：不捎带重构、不扩大边界
2. 类型化优先：消除 `any`，建立类型化中间层
3. 复用优先：重复代码统一提取，单一来源
4. 不在本轮写实现代码

---

## 2. 各问题修复方案

---

### I-001 · DatabaseView useEffect 竞态

**问题**：`useEffect`（L408–454）依赖数组使用 `eslint-disable` 仅声明 `[db, rows]`，但内部闭包捕获了 `relationRowsCache` state。当 `rows` 更新触发新 effect 时，新旧 effect 并发执行，新 effect 会用 `new Map(updates)` 覆盖尚未写入的旧缓存 key，导致视图闪回空值。

**方案对比**

| | 方案 A：useRef 缓存 | 方案 B：useCallback + 正确依赖 |
|--|---|---|
| 思路 | 将 `relationRowsCache` 从 state 改为 `useRef`，通过 `ref.current` 读写，避免闭包捕获过期值 | 将批量加载抽取为 `loadRelationRows(db, rows)` `useCallback`，正确声明所有依赖，引入 `isCurrent` guard 防止过期 effect 写入 state |
| 优点 | 简单，不需要引入 cancel flag；缓存更新不触发重渲染 | 依赖图清晰，符合 React 官方推荐 |
| 缺点 | ref 变更不触发重渲染，如果有其他组件需要响应缓存变化则无法感知 | 需要引入 `isCurrent` guard 并在 cleanup 中置 false |
| **推荐** | ✓ | |

**推荐方案 A 细节**

- 将 `const [relationRowsCache, setRelationRowsCache] = useState(new Map())` 改为 `const relationRowsCache = useRef<Map<string, Map<string, DBRow | null>>>(new Map())`
- effect 内部直接读写 `relationRowsCache.current`，写完后调用 `setRows(r => [...r])` 强制触发一次渲染（或通过独立计数 state 触发）
- 依赖数组正确声明为 `[db, rows]`，移除 `eslint-disable`

**影响文件**

- `web/src/components/database/DatabaseView.tsx`（L368、L408–454）

**复杂度**：S

---

### I-002 · API 错误处理缺失

**问题**：`api/client.ts` 的 `req<T>` 正确抛出非 2xx 异常，但所有调用方均使用 `void` 前缀静默丢弃 rejection。用户遭遇网络错误或后端 500 时，UI 停留在旧状态且无任何提示。

**方案对比**

| | 方案 A：api/client 层全局 toast | 方案 B：React ErrorBoundary | 方案 C：onError Context 回调 |
|--|---|---|---|
| 思路 | 在 `req` 函数 catch 块中调用 `toast.error(err.message)` 后重新 throw；引入 `react-hot-toast` | 在组件树根部放置 ErrorBoundary，捕获未处理的 rejection（需搭配 window.onunhandledrejection） | 提供 `ErrorContext`，各组件调用 `const { onError } = useError()`，在 catch 中显式调用 |
| 优点 | 一处修改覆盖全部调用点；无需修改各 callsite | 能捕获同步渲染异常 | 灵活，各组件可自定义错误处理逻辑 |
| 缺点 | 某些操作（如删除）报错后 toast 样式可能不够准确；所有错误统一展示 | Promise rejection 捕获不完整；需要额外 polyfill | 需要修改所有 callsite，改动量大 |
| **推荐** | ✓ | | |

**推荐方案 A 细节**

- 安装 `react-hot-toast`（或使用现有 UI 库的 notification）
- 在 `api/client.ts` 的 `req` 函数中：
  ```
  async function req<T>(method, path, body?): Promise<T> {
    try {
      // ... fetch 逻辑不变
    } catch (err) {
      toast.error((err as Error).message);  // 全局展示
      throw err;  // 仍然 re-throw，保留调用方 catch 的能力
    }
  }
  ```
- 在 `main.tsx` / `App.tsx` 的根节点添加 `<Toaster />` 组件
- 各调用方的 `void` 前缀可保留（不强制要求每处 catch），因为 `req` 层已展示 toast

**影响文件**

- `web/src/api/client.ts`（L5–17，新增 toast 调用）
- `web/src/main.tsx` 或 `web/src/App.tsx`（根节点添加 `<Toaster />`）
- `package.json`（添加 `react-hot-toast` 依赖）

**复杂度**：S

---

### I-003 · toBlockNote 静默丢失数据

**问题**：`buildBlock` 在 JSON.parse 失败时直接置空（`content = []`, `props = {}`），无任何警告日志。`toBlockNote` 返回 `any[]`，类型安全链路断裂。`Editor.tsx` L750 的 `catch` 块完全静默。

**方案（唯一解）**

本问题无需对比方案，直接修复三个独立点：

1. **`buildBlock` 中 parse 失败时增加 warn 日志**  
   在所有 `catch { /* empty */ }` 处改为：  
   `catch (e) { console.warn('[toBlockNote] parse failed for block', b.id, 'field: content/props', b.content, e); }`

2. **`toBlockNote` 返回类型改为 `BNBlock[]`**  
   利用 `Editor.tsx` L38–39 中已定义的 `BNBlock` 接口：  
   `export function toBlockNote(blocks: Block[]): BNBlock[]`  
   同时 `buildBlock` 返回类型改为 `BNBlock`，内部构造对象保持结构化

3. **Editor.tsx L750 catch 块记录日志**  
   `catch (err) { console.error('[Editor] replaceBlocks failed', err); }`

**影响文件**

- `web/src/utils/toBlockNote.ts`（全文：L4、L17、L66、L72、L74、L80）
- `web/src/components/editor/Editor.tsx`（L750–751）

**复杂度**：S

---

### I-006 · TAG_COLORS / parseOptions 重复

**问题**：`TAG_COLORS` 数组、`tagColor` 函数、`parseOptions` 函数在 `DatabaseView.tsx` 和 `KanbanView.tsx` 中各存一份，完全相同或近乎相同。

**方案（唯一解）**

新建 `web/src/components/database/shared.ts`，内容：

```typescript
// TAG_COLORS: 8 色方案，顺序固定，按值 hash 选色
export const TAG_COLORS: ReadonlyArray<{ bg: string; color: string }> = [
  { bg: "#f3f0ff", color: "#6e5fd6" },
  { bg: "#e8f4fd", color: "#2383e2" },
  { bg: "#edfaf3", color: "#0f9b5c" },
  { bg: "#fff3e0", color: "#d9730d" },
  { bg: "#fce8e8", color: "#eb5757" },
  { bg: "#f0f0f0", color: "#6b7280" },
  { bg: "#fdf4e3", color: "#b07d28" },
  { bg: "#eef0ff", color: "#4361c2" },
];

export interface SelectOption { value: string; colorIdx: number }

export function tagColor(val: string): { bg: string; color: string } { ... }

export function parseOptions(raw: string): SelectOption[] { ... }

export function serializeOptions(opts: SelectOption[]): string { ... }
```

- `DatabaseView.tsx` 和 `KanbanView.tsx` 均改为从 `./shared` 导入，删除各自的本地定义

**影响文件**

- 新增：`web/src/components/database/shared.ts`
- 修改：`web/src/components/database/DatabaseView.tsx`（删除 L93–146 的本地定义，改为 import）
- 修改：`web/src/components/database/KanbanView.tsx`（删除 L16–39 的本地定义，改为 import）

**复杂度**：S

---

### I-007 · parseFileAttachments 重复

**问题**：`parseFileAttachments` 在 `DatabaseView.tsx`（L25–33）和 `GalleryView.tsx`（L12–19）逐字节相同定义。

**方案（唯一解）**

新建 `web/src/utils/fileAttachments.ts`：

```typescript
import type { FileAttachment } from "../types";

export function parseFileAttachments(raw: string): FileAttachment[] {
  if (!raw || raw === "[]") return [];
  try {
    return JSON.parse(raw) as FileAttachment[];
  } catch (e) {
    console.warn("[fileAttachments] invalid JSON", raw, e);
    return [];
  }
}
```

注意：当前 `GalleryView.tsx` 的版本无 warn 日志，统一添加。

- `DatabaseView.tsx` 和 `GalleryView.tsx` 均改为从 `../../utils/fileAttachments` 导入

**影响文件**

- 新增：`web/src/utils/fileAttachments.ts`
- 修改：`web/src/components/database/DatabaseView.tsx`（删除 L25–33，改为 import）
- 修改：`web/src/components/database/GalleryView.tsx`（删除 L12–19，改为 import）

**复杂度**：XS

---

### I-008 · Editor 硬编码 localhost URL

**问题**：`FileAttachBlock`（L267）、`BookmarkBlock`（L314）、`PdfBlock`（L434）直接硬编码 `"http://localhost:8080/api/uploads"` 和 `"http://localhost:8080/api/meta"`，绕过 `api/client.ts` 的统一层。

**方案对比**

| | 方案 A：在 api/client.ts 添加专用方法 | 方案 B：仅提取 BASE_URL 常量 |
|--|---|---|
| 思路 | 新增 `api.uploads.upload(file): Promise<{ url: string }>` 和 `api.meta.fetch(url): Promise<BookmarkMeta>` | 在 `api/client.ts` 顶部导出 `export const BASE_URL = "http://localhost:8080"` 常量，各处引用 |
| 优点 | 完整封装，错误处理一致，后续端口变更只改一处；符合 api 层职责 | 改动最小 |
| 缺点 | 需要额外定义接口类型 | `uploads` 不走 `req<T>` 的标准化 fetch 路径，错误处理仍需各处自行实现 |
| **推荐** | ✓ | |

**推荐方案 A 细节**

在 `api/client.ts` 中添加：

```typescript
export const uploads = {
  upload: async (file: File): Promise<{ url: string }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(BASE + "/uploads", { method: "POST", body: form });
    if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error((e as { error: string }).error); }
    return res.json() as Promise<{ url: string }>;
  },
};

export const meta = {
  fetch: (url: string): Promise<{ title: string; description: string; favicon: string }> =>
    req("GET", `/meta?url=${encodeURIComponent(url)}`),
};
```

- `Editor.tsx` 中三处硬编码 fetch 改为调用 `api.uploads.upload(file)` 和 `api.meta.fetch(url)`，删除 `import` 中未使用的本地变量

**影响文件**

- `web/src/api/client.ts`（新增 `uploads` 和 `meta` 导出对象）
- `web/src/components/editor/Editor.tsx`（L267–269、L313–315、L434–436）

**复杂度**：S

---

### I-009 · column overlay DOM 泄漏

**问题**：`hideOverlay` 中调用 `columnOverlayRef.current.remove()`，组件在 drag 进行中卸载时，`columnOverlayRef.current` 可能指向已经从 DOM 移除的 detached 节点。此外 L866 通过 `(editor as any)._tiptapEditor?.view?.dom` 访问 BlockNote 私有 API。

**方案（唯一解）**

1. **`hideOverlay` 增加 `isConnected` 检查**

   ```typescript
   function hideOverlay() {
     const el = columnOverlayRef.current;
     if (el && el.isConnected) {
       el.remove();
     }
     columnOverlayRef.current = null;
   }
   ```

2. **私有 API 访问封装为 try/catch**

   ```typescript
   let editorDom: HTMLElement | undefined;
   try {
     editorDom = (editor as any)._tiptapEditor?.view?.dom as HTMLElement | undefined;
   } catch (e) {
     console.warn('[Editor] _tiptapEditor not accessible, column overlay disabled', e);
   }
   if (!editorDom) return;
   ```

**影响文件**

- `web/src/components/editor/Editor.tsx`（L845–850、L866–867）

**复杂度**：XS

---

### I-011 · Tauri sidecar 无崩溃感知

**问题**：`src-tauri/src/lib.rs` 中 `_rx` 被丢弃（L25），sidecar 崩溃后 Tauri 无感知；`on_window_event` 仅在 `Destroyed` 时 kill child，异常退出可能留孤儿进程。

> **注意**：此问题属于 Rust/Tauri 集成层，实现语言非 TypeScript，但属于前端交付物范围（Tauri 客户端）。

**方案（唯一解）**

需要三处改动，均在 `src-tauri/src/lib.rs`：

1. **后台线程监听 `_rx`**

   ```rust
   let app_handle = app.app_handle().clone();
   std::thread::spawn(move || {
     loop {
       match rx.recv() {
         Ok(line) => { /* 可选：log info */ }
         Err(_) => {
           // channel closed = sidecar exited
           let _ = app_handle.emit("sidecar-crashed", ());
           break;
         }
       }
     }
   });
   ```

2. **前端监听 `sidecar-crashed` 事件**

   在 `web/src/App.tsx` 或 `web/src/main.tsx` 中，通过 `@tauri-apps/api/event` 的 `listen("sidecar-crashed", ...)` 展示对话框提示用户重启应用。

3. **覆盖所有异常退出路径**

   使用 Tauri 2.x 的 `app.on_window_event` 中增加 `WindowEvent::CloseRequested` 和 Rust 的 `atexit` / `Drop` 来确保孤儿进程被 kill。

**影响文件**

- `src-tauri/src/lib.rs`（L12–65）
- `web/src/App.tsx` 或 `web/src/main.tsx`（新增 sidecar-crashed 事件监听）

**复杂度**：M

---

### I-012 · Block 类型链路 any 泛滥

**问题**：`Block.content` 和 `Block.props` 为 `string`（JSON 序列化），数据流中途无类型化中间层，导致 `any` 在 `Editor.tsx` 中至少 15 处蔓延。

**方案（唯一解）**

`Editor.tsx` L38–39 已定义了 `BNInline` 和 `BNBlock` 接口，但未被充分利用。方案分两步：

**步骤 1：将 `BNBlock` / `BNInline` 移到公共类型文件**

将 `Editor.tsx` L38–39 中的接口定义移动到 `web/src/types/blocknote.ts`（新建）：

```typescript
// web/src/types/blocknote.ts
export interface BNInline {
  type: string;
  text?: string;
  content?: BNInline[];
  props?: Record<string, string>;
}

export interface BNBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: BNInline[] | undefined;
  children?: BNBlock[];
}
```

**步骤 2：`toBlockNote` 使用 `BNBlock[]` 返回类型（见 I-003 方案）**

- `buildBlock` 返回 `BNBlock`
- `Editor.tsx` 中 `bn: any[]` 改为 `bn: BNBlock[]`，消除对应 eslint-disable 注释

**关于 `Block.content` 是否改为 `unknown`**：  
当前 `Block.content` 是 server 序列化的 JSON 字符串，在类型定义层保持 `string` 是正确的（因为它确实是字符串）。不需要改动 `web/src/types/index.ts` 的 `Block` 定义，只需在解析处增加类型标注。

**影响文件**

- 新增：`web/src/types/blocknote.ts`
- 修改：`web/src/utils/toBlockNote.ts`（`buildBlock` 和 `toBlockNote` 返回类型）
- 修改：`web/src/components/editor/Editor.tsx`（L38–39 改为从 `../../types/blocknote` import；L728–733 处类型修正）

**复杂度**：M

---

### I-013 · PageItem / PageItemWithRename 重复组件

**问题**：`PageItem`（L68）和 `PageItemWithRename`（L555）几乎完全相同，仅差 `renameTrigger` prop 和对应的 `useEffect`（约 80 行重复代码）。`RenameAwarePageItem` 通过全局 `CustomEvent` 通信，脆弱且绕过 React 数据流。

**方案对比**

| | 方案 A：合并组件 + 保留 CustomEvent | 方案 B：合并组件 + Zustand 替代 CustomEvent |
|--|---|---|
| 思路 | 将两者合并为单个 `PageItem`，增加可选 `renameRequested?: boolean` prop；`RenameAwarePageItem` 继续监听 CustomEvent 但只需维护一处 | 同左，同时引入 `pageStore`（Zustand）存储 `renamingPageId`，Sidebar 中的"重命名"菜单项 dispatch 到 store，`PageItem` subscribe `renamingPageId` | 
| 优点 | 改动量小；不引入新依赖 | 消除全局 CustomEvent 的隐式耦合；符合 AR-5 Zustand 引入方向 |
| 缺点 | CustomEvent 通信模式仍在 | 需要引入 Zustand 或先规划 AR-5 |
| **推荐** | | ✓（与 AR-5 一并推进时）；如单独修复则用方案 A |

**方案 A（独立修复）细节**

- 保留 `PageItemWithRename`，删除 `PageItem`（将其所有使用处替换为 `PageItemWithRename` 但 `renameTrigger` 默认 0）
- 或：删除 `PageItemWithRename`，在 `PageItem` 中增加 `renameTrigger?: number` prop，内部逻辑合并

推荐后者：合并到 `PageItem`，`RenameAwarePageItem` 继续提供 CustomEvent 订阅包装。

**方案 B（与 AR-5 联动）细节**

```typescript
// web/src/store/pageStore.ts（Zustand）
interface PageStore {
  renamingPageId: string | null;
  requestRename: (id: string) => void;
  clearRename: () => void;
}
```

- Sidebar 上下文菜单"重命名"项改为调用 `pageStore.requestRename(pageId)`，替换 `window.dispatchEvent(new CustomEvent("rename-page", ...))`
- `PageItem` 中通过 `usePageStore(s => s.renamingPageId)` 判断是否触发重命名，删除 `RenameAwarePageItem` 包装层

**影响文件（方案 A）**

- `web/src/components/sidebar/Sidebar.tsx`（L534–675 合并组件）

**影响文件（方案 B，额外）**

- 新增：`web/src/store/pageStore.ts`
- 修改：`web/src/components/sidebar/Sidebar.tsx`（L539–552 CustomEvent 调用处）

**复杂度**：M（方案 A）/ L（方案 B，含 AR-5 基础）

---

### I-016 · settingsStore 耦合

**问题**：`Editor.tsx` 引用 `useSettings` 仅为 `themeId`，但与整个 `SettingsContextValue`（包含 `setFont`、`setTheme`）耦合。

**方案（唯一解）**

当前 `settingsStore.ts` 的 Context value 包含 `fontId`、`themeId`、`setFont`、`setTheme`。Editor 只需 `themeId`。

最轻量的方案：不拆文件，改用选择性读取。在 `settingsStore.ts` 中额外导出：

```typescript
export function useThemeId(): string {
  return useContext(SettingsContext).themeId;
}
```

- `Editor.tsx` L34 将 `import { useSettings }` 改为 `import { useThemeId }`，L使用处改为 `const themeId = useThemeId()`

这样 Editor 不感知 `setFont`、`setTheme` 等无关字段，但不需要拆分文件（拆分文件的收益在当前规模不明显）。

**影响文件**

- `web/src/settings/settingsStore.ts`（新增 `useThemeId` 导出，3 行）
- `web/src/components/editor/Editor.tsx`（L34 import 变更）

**复杂度**：XS

---

### I-017 · useMonthNav 重复

**问题**：`CalendarView.tsx`（L12–27）和 `TimelineView.tsx`（L13–39）月份导航逻辑（`year`/`month` state + `prevMonth`/`nextMonth`）几乎逐行相同。

**方案（唯一解）**

新建 `web/src/hooks/useMonthNav.ts`：

```typescript
import { useState } from "react";

export interface MonthNav {
  year: number;
  month: number;
  prevMonth: () => void;
  nextMonth: () => void;
}

export function useMonthNav(initialYear?: number, initialMonth?: number): MonthNav {
  const today = new Date();
  const [year, setYear] = useState(initialYear ?? today.getFullYear());
  const [month, setMonth] = useState(initialMonth ?? today.getMonth());

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  return { year, month, prevMonth, nextMonth };
}
```

注意：`TimelineView` 的 `prevPeriod`/`nextPeriod` 在 week granularity 下有额外逻辑，不完全等同于 `useMonthNav`。TimelineView 的 month granularity 分支可使用 `useMonthNav`，week 分支保留独立逻辑，或在 `useMonthNav` 中增加可选 `granularity` 参数（建议后者仅在与 TimelineView 改造一并进行时处理，避免过度抽象）。

**影响文件**

- 新增：`web/src/hooks/useMonthNav.ts`
- 修改：`web/src/components/database/CalendarView.tsx`（L12–27 替换为 `useMonthNav()`）
- 修改：`web/src/components/database/TimelineView.tsx`（L13–39 中 month 分支替换为 `useMonthNav()`）

**复杂度**：S

---

### I-018 · 封面图 Base64 存 SQLite

**问题**：`App.tsx` `handleChangeCover`（L134–151）将图片 Base64 DataURL（最大 660KB）直接存入 `page.cover` 字段，膨胀 SQLite 体积，影响 `listAll` 接口性能。

**方案对比**

| | 方案 A：走 /api/uploads 存文件 | 方案 B：保留 Base64 但更严格限制 |
|--|---|---|
| 思路 | 将 `handleChangeCover` 中的 `FileReader.readAsDataURL` 替换为 `api.uploads.upload(file)`，`cover` 字段存 URL | 将 512KB 的 alert 改为阻止上传（当前仅提示不阻止），并压缩图片至 ≤50KB | 
| 优点 | 根治数据库膨胀问题；与 I-008 上传逻辑共享同一 api 方法 | 改动量极小 |
| 缺点 | 需要 I-008 先完成（`api.uploads.upload` 方法已存在）；封面离线访问会失效 | 治标不治本，100 个页面仍有 5MB base64 存量 |
| **推荐** | ✓ | |

**推荐方案 A 细节**

```typescript
const handleChangeCover = async () => {
  if (!selectedPageId) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert("封面图片不超过 2MB"); return; }
    const { url } = await api.uploads.upload(file);  // I-008 的 api.uploads.upload
    setPageMeta(m => m ? { ...m, cover: url } : m);
    await api.pages.update(selectedPageId, { cover: url });
  };
  input.click();
};
```

- 此方案依赖 I-008 的 `api.uploads.upload` 先实现
- 历史已存入的 Base64 DataURL 不做迁移（不在本轮范围）

**影响文件**

- `web/src/App.tsx`（L134–151）

**复杂度**：S（依赖 I-008 完成）

---

### I-019 · findPageFlat 多余 / magic literal

**问题**：`findPageFlat` 是对 `findPage` 的单行无意义包装；`toBlockNote.ts` 中块类型字符串为 magic literal。

**方案（唯一解）**

**sub-1：删除 `findPageFlat`**

- `Sidebar.tsx` L534–536 删除函数定义
- 搜索全文中对 `findPageFlat` 的所有调用，替换为 `findPage(tree, id)`

**sub-2：block type 字符串常量化**

在 `web/src/types/blocknote.ts`（I-012 新建的文件）或新建 `web/src/utils/blockTypes.ts` 中定义：

```typescript
export const BLOCK_TYPES = {
  PARAGRAPH: "paragraph",
  COLUMN_LIST: "columnList",
  COLUMN: "column",
  DATABASE: "database",
  SUBPAGE: "subpage",
  FILE_ATTACH: "fileAttach",
  BOOKMARK: "bookmark",
  EMBED: "embed",
  PDF: "pdf",
  BUTTON: "button",
  COLUMNS: "columns",  // legacy
} as const;
```

- `toBlockNote.ts` 中所有字符串字面量（L6、L31、L34、L50 等）改为引用 `BLOCK_TYPES.XX`

**影响文件**

- `web/src/components/sidebar/Sidebar.tsx`（删除 L534–536）
- `web/src/utils/toBlockNote.ts`（magic literal 替换）
- 新增或修改：`web/src/types/blocknote.ts` 或 `web/src/utils/blockTypes.ts`

**复杂度**：S

---

### I-020 · loadAvailableDatabases O(n) 请求

**问题**：`loadAvailableDatabases`（DatabaseView.tsx L618–638）三层嵌套请求，O(pages × blocks_per_page)；缓存无失效机制。

**方案对比**

| | 方案 A：后端新增 GET /api/databases | 方案 B：前端缓存失效 |
|--|---|---|
| 思路 | 后端添加专用接口，一次请求返回所有 database 列表 | 移除 `if (availableDatabases.length > 0) return` 这行缓存 guard，改为每次打开 addColPopover 时重新加载 | 
| 优点 | 根治性能问题 | 纯前端改动，无需后端协作 |
| 缺点 | 需要后端工程师实现新接口（与 REQ-065 协同） | 频繁打开 popover 时仍有 O(n) 请求 |
| **推荐** | ✓（须与后端架构师对齐） | 作为临时 fallback |

**方案 B（临时 fallback）细节**

- 将 `loadAvailableDatabases` 调用从只在缓存为空时触发，改为在 `setAddColPopover` 打开时每次清空并重新加载：
  ```typescript
  const openAddCol = (e: React.MouseEvent) => {
    // ...
    setAvailableDatabases([]);  // 清空缓存，下次打开时重新加载
    setAddColPopover({ x: rect.left, y: getPopoverY(rect, 420) });
    void loadAvailableDatabases();
  };
  ```

**影响文件**

- `web/src/components/database/DatabaseView.tsx`（L618–638；L608–616 的 `openAddCol`）
- （方案 A 额外）`server/internal/handler/` 和 `server/internal/repository/`（由 REQ-065 处理）

**复杂度**：S（方案 B）/ M（方案 A，需后端联动）

---

### I-022 · commitEdit 乐观更新缺失

**问题**：`commitEdit`（L477–482）在 API 调用完成后 `void reload()`，不等待 reload 就清除 `editingCell`，单元格短暂回到旧值后再切换新值，造成视觉闪烁。

**方案（唯一解）**

实现乐观更新：在 API 调用前先本地更新 `rows` state，后台执行 reload，失败时回滚：

```typescript
const commitEdit = async (rowId: string, colId: string) => {
  const prevRows = rows;
  // 乐观更新：立即反映新值
  setRows(prev => prev.map(r =>
    r.id === rowId
      ? { ...r, cells: { ...r.cells, [colId]: cellDraft } }
      : r
  ));
  setEditingCell(null);
  try {
    await api.databases.updateCells(databaseId, rowId, [{ column_id: colId, value: cellDraft }]);
    void reload();  // 后台刷新（不阻塞 UI）
  } catch (err) {
    // 失败回滚
    setRows(prevRows);
    setEditingCell({ rowId, colId });
  }
};
```

**影响文件**

- `web/src/components/database/DatabaseView.tsx`（L477–482）

**复杂度**：S

---

## 3. DatabaseView 拆分组件结构图（AR-1）

### 当前状态

`DatabaseView.tsx`（≈1917 行）承载所有视图渲染、状态管理、弹窗逻辑，是全局单一大组件。

### 拆分后组件树

```
DatabaseView (web/src/components/database/DatabaseView.tsx)
│  职责：状态协调、数据加载、操作回调定义、视图路由
│  状态：db, rows, viewMode, editingCell, sortStates, filterStates,
│        colWidths, rowModal, selectedRowIds, ...所有当前 state
│
├── DatabaseToolbar (web/src/components/database/DatabaseToolbar.tsx)
│     职责：视图切换按钮 + 筛选/排序/隐藏/分组工具栏
│     Props:
│       viewMode: ViewMode
│       onViewModeChange: (mode: ViewMode) => void
│       sortStates: SortState[]
│       filterStates: FilterState[]
│       onSortChange: (states: SortState[]) => void
│       onFilterChange: (states: FilterState[]) => void
│       hiddenCount: number
│       columns: DBColumn[]
│       onToggleHide: (colId: string) => void
│       groupByColId: string
│       onGroupByChange: (colId: string) => void
│       toolbarPanel: ToolbarPanel
│       onToolbarPanelChange: (panel: ToolbarPanel) => void
│
├── DatabaseTableView (web/src/components/database/DatabaseTableView.tsx)
│     职责：表格视图（thead + tbody + 列拖拽 + 列宽调整 + 单元格编辑）
│     Props:
│       db: Database
│       rows: DBRow[]         ← displayedRows（已 filter + sort）
│       columns: DBColumn[]   ← 可见列
│       editingCell: { rowId, colId } | null
│       cellDraft: string
│       colWidths: Record<string, number>
│       selectedRowIds: Set<string>
│       relationRowsCache: RelationRowsCache
│       onStartEdit: (rowId, colId, val) => void
│       onCommitEdit: (rowId, colId) => void
│       onCellKeyDown: (e, rowId, colId) => void
│       onCellDraftChange: (val: string) => void
│       onToggleCheckbox: (rowId, colId, val) => void
│       onOpenRow: (row: DBRow) => void
│       onAddRow: () => void
│       onDeleteRow: (rowId: string) => void
│       onDuplicateRow: (row: DBRow) => void
│       onToggleSelectRow: (id: string) => void
│       onToggleSelectAll: () => void
│       onColWidthChange: (colId, width) => void
│       onOpenColMenu: (e, col) => void
│       onOpenAddCol: (e) => void
│       onOpenSelectDropdown: (rowId, colId, opts, pos) => void
│       onOpenMultiSelectDropdown: (rowId, colId, opts, pos) => void
│       onOpenRowRelation: (rowId, colId) => void
│       // refs (通过 callback 传递)
│       cellInputRef: React.RefObject<HTMLInputElement>
│
├── DatabaseColMenu (web/src/components/database/DatabaseColMenu.tsx)
│     职责：列标题右键/点击弹出菜单（重命名、改类型、删除、隐藏等）
│     Props:
│       colMenu: ColMenu | null
│       menuCol: DBColumn | null
│       onClose: () => void
│       onCommitRename: () => void
│       onChangeType: (type) => void
│       onDelete: () => void
│       onToggleHide: () => void
│       onOpenFormula: (e, col) => void
│       onOpenSelectOptions: (e, col) => void
│       onOpenRollupConfig: (e, col) => void
│       renameInputRef: React.RefObject<HTMLInputElement>
│       draft: string
│       onDraftChange: (v: string) => void
│
├── DatabaseAddColPopover (web/src/components/database/DatabaseAddColPopover.tsx)
│     职责：新增列弹窗（列名、列类型、relation 选择、submit）
│     Props:
│       popover: AddColPopover | null
│       columns: DBColumn[]
│       newColName: string
│       newColType: DBColumn["type"]
│       colTypeOpen: boolean
│       newColRelationDbId: string
│       availableDatabases: Database[]
│       error: string | null
│       onNameChange: (v: string) => void
│       onTypeChange: (t: DBColumn["type"]) => void
│       onRelationDbChange: (id: string) => void
│       onColTypeOpenChange: (v: boolean) => void
│       onSubmit: () => void
│       onClose: () => void
│       onLoadDatabases: () => void
│       newColInputRef: React.RefObject<HTMLInputElement>
│
├── DatabaseRowModal (web/src/components/database/DatabaseRowModal.tsx)
│     职责：行详情弹窗（所有字段展示 + 编辑 + 内容编辑器）
│     Props:
│       rowModal: RowModal | null
│       db: Database
│       rowModalDraft: Record<string, string>
│       onDraftChange: (colId: string, val: string) => void
│       onSelectOption: (colId: string, val: string) => void
│       onToggleMultiSelect: (colId: string, val: string) => void
│       onClose: () => void
│       onSave: () => void
│       databaseId: string
│       rowContentSaveRef: React.MutableRefObject<(() => void) | null>
│       relationRowsCache: RelationRowsCache
│
├── DatabaseBatchBar (web/src/components/database/DatabaseBatchBar.tsx)
│     职责：批量操作工具栏（选中 N 行 · 批量填充 · 批量删除）
│     Props:
│       selectedCount: number
│       columns: DBColumn[]
│       batchColId: string
│       batchVal: string
│       batchPanel: boolean
│       onBatchColChange: (id: string) => void
│       onBatchValChange: (v: string) => void
│       onBatchPanelToggle: () => void
│       onBatchUpdate: () => void
│       onBatchDelete: () => void
│       onClearSelection: () => void
│
└── [已有子组件，不需要移动]
      KanbanView, GalleryView, CalendarView, TimelineView,
      FilesCell, FilesModalField, RelationCell, RollupConfigPopover,
      ColorDotPicker, Chip
```

### 说明

- `DatabaseView` 保留所有 state 和逻辑函数，通过 props 向下传递；本轮拆分是"提取渲染层"，不做状态下移
- 新增 `useRowEditor` hook（见第 4 节）负责 `editingCell`、`cellDraft`、`commitEdit`、`startEdit` 逻辑，可将这部分 state 从 `DatabaseView` 中提取，减少主组件的 state 数量
- `RowContentEditor`（内部子组件）保留在 `DatabaseView.tsx` 或随 `DatabaseRowModal` 一起迁移

---

## 4. 提取的工具函数 / Hook 清单

| 名称 | 类型 | 来源文件（当前位置） | 目标文件路径 | 导出接口签名 |
|------|------|------|------|------|
| `parseFileAttachments` | 工具函数 | `DatabaseView.tsx` L25、`GalleryView.tsx` L12 | `web/src/utils/fileAttachments.ts` | `export function parseFileAttachments(raw: string): FileAttachment[]` |
| `TAG_COLORS` | 常量 | `DatabaseView.tsx` L93、`KanbanView.tsx` L16 | `web/src/components/database/shared.ts` | `export const TAG_COLORS: ReadonlyArray<{ bg: string; color: string }>` |
| `tagColor` | 工具函数 | `DatabaseView.tsx` L104 | `web/src/components/database/shared.ts` | `export function tagColor(val: string): { bg: string; color: string }` |
| `parseOptions` | 工具函数 | `DatabaseView.tsx` L131、`KanbanView.tsx` L29 | `web/src/components/database/shared.ts` | `export function parseOptions(raw: string): SelectOption[]` |
| `serializeOptions` | 工具函数 | `DatabaseView.tsx` L148 | `web/src/components/database/shared.ts` | `export function serializeOptions(opts: SelectOption[]): string` |
| `SelectOption` | 接口 | `DatabaseView.tsx` L128 | `web/src/components/database/shared.ts` | `export interface SelectOption { value: string; colorIdx: number }` |
| `useMonthNav` | 自定义 Hook | `CalendarView.tsx` L12、`TimelineView.tsx` L13 | `web/src/hooks/useMonthNav.ts` | `export function useMonthNav(initY?: number, initM?: number): MonthNav` |
| `useRowEditor` | 自定义 Hook | `DatabaseView.tsx` L471–527（editingCell 相关逻辑） | `web/src/hooks/useRowEditor.ts` | `export function useRowEditor(databaseId: string, rows: DBRow[], setRows: React.Dispatch<...>): UseRowEditorReturn` |
| `useKeyboardShortcuts` | 自定义 Hook | `App.tsx` L161–175 | `web/src/hooks/useKeyboardShortcuts.ts` | `export function useKeyboardShortcuts(handlers: Partial<Record<string, () => void>>): void` |
| `BNBlock` | 类型接口 | `Editor.tsx` L39 | `web/src/types/blocknote.ts` | `export interface BNBlock { id: string; type: string; props: Record<string, unknown>; content?: BNInline[]; children?: BNBlock[] }` |
| `BNInline` | 类型接口 | `Editor.tsx` L38 | `web/src/types/blocknote.ts` | `export interface BNInline { type: string; text?: string; content?: BNInline[]; props?: Record<string, string> }` |
| `BLOCK_TYPES` | 常量（as const） | `toBlockNote.ts`（magic literal 散落） | `web/src/types/blocknote.ts` 或 `web/src/utils/blockTypes.ts` | `export const BLOCK_TYPES = { PARAGRAPH: "paragraph", COLUMN_LIST: "columnList", ... } as const` |
| `useThemeId` | 自定义 Hook（小） | `settingsStore.ts`（新增） | `web/src/settings/settingsStore.ts` | `export function useThemeId(): string` |
| `api.uploads` | API 方法对象 | `Editor.tsx`（硬编码 fetch） | `web/src/api/client.ts` | `export const uploads: { upload(file: File): Promise<{ url: string }> }` |
| `api.meta` | API 方法对象 | `Editor.tsx`（硬编码 fetch） | `web/src/api/client.ts` | `export const meta: { fetch(url: string): Promise<BookmarkMeta> }` |

---

## 5. 实现任务拆分建议

### P0 先行（阻塞用户体验，须优先完成）

---

#### T-P0-1：I-001 修复 useEffect 竞态

**做什么**：将 `DatabaseView.tsx` L368 的 `relationRowsCache` state 改为 `useRef`；修正 L408–454 effect 的读写方式；移除 `eslint-disable` 注释。

**不做什么**：不重构 effect 内部的批量加载逻辑；不引入 cancel token 模式（useRef 方案已足够）。

**估算工作量**：0.5 天

---

#### T-P0-2：I-002 全局错误 toast

**做什么**：安装 `react-hot-toast`；在 `api/client.ts` 的 `req` 函数 catch 块中调用 `toast.error`；在 `App.tsx` 根节点添加 `<Toaster />`。

**不做什么**：不修改各调用方的 `void` 前缀（保留，因 toast 已处理）；不区分错误级别（统一 error toast）。

**前置条件**：无

**估算工作量**：0.5 天

---

#### T-P0-3：I-003 toBlockNote 类型化 + warn 日志

**做什么**：
1. 新建 `web/src/types/blocknote.ts`，定义 `BNBlock`、`BNInline`（从 Editor.tsx L38–39 迁移并扩展）
2. `toBlockNote.ts` 修改 `buildBlock` 和 `toBlockNote` 返回类型为 `BNBlock`；所有 `catch` 块加 `console.warn`
3. `Editor.tsx` L750 catch 块改为 `console.error`

**不做什么**：不做 runtime validation（不引入 zod 等库）；不修改 `Block` 类型定义（`content: string` 保持不变）。

**前置条件**：无（可与 T-P0-2 并行）

**估算工作量**：1 天

---

### P1 次之（影响代码质量 / Tauri 稳定性，应在 P0 完成后尽快推进）

---

#### T-P1-1：I-006 + I-007 提取共享工具

**做什么**：
1. 新建 `web/src/components/database/shared.ts`，迁移 `TAG_COLORS`、`tagColor`、`parseOptions`、`serializeOptions`、`SelectOption` 接口
2. 新建 `web/src/utils/fileAttachments.ts`，迁移 `parseFileAttachments`（含 warn 日志）
3. `DatabaseView.tsx`、`KanbanView.tsx`、`GalleryView.tsx` 改为从新文件 import，删除各自本地定义

**不做什么**：不修改这些函数的行为逻辑；不迁移 `SortableOptionRow` 等依赖 TAG_COLORS 的组件（它们在同文件内保持引用即可）。

**估算工作量**：0.5 天

---

#### T-P1-2：I-008 Editor 硬编码 URL 修复

**做什么**：
1. 在 `api/client.ts` 中新增 `uploads` 和 `meta` 导出对象（含接口定义）
2. `Editor.tsx` 三处硬编码 fetch 替换为 `api.uploads.upload` 和 `api.meta.fetch`

**不做什么**：不修改 `FileAttachBlock`、`BookmarkBlock`、`PdfBlock` 的其他逻辑。

**前置条件**：T-P0-2（api/client.ts 已有 toast 集成，上传错误会自动 toast）

**估算工作量**：0.5 天

---

#### T-P1-3：I-009 column overlay DOM 泄漏修复

**做什么**：`Editor.tsx` `hideOverlay` 中添加 `el.isConnected` 检查；`_tiptapEditor` 访问封装为 try/catch。

**不做什么**：不重构整个 column overlay 逻辑。

**估算工作量**：0.25 天

---

#### T-P1-4：I-011 Tauri sidecar 崩溃感知

**做什么**：
1. `src-tauri/src/lib.rs` 中 `_rx` 变量重命名为 `rx`，spawn 后台线程监听，channel closed 时 emit `sidecar-crashed` 事件
2. `web/src/App.tsx` 中使用 `@tauri-apps/api/event` 的 `listen` 订阅该事件，显示 dialog 提示用户重启

**不做什么**：不实现自动重启（上限 N 次重试属于增强功能，不在本修复范围）；不修改 on_window_event 的 Destroyed 逻辑（保留现有行为，仅补充新增监听）。

**估算工作量**：1 天

---

#### T-P1-5：I-012 Block 类型链路类型化

**做什么**：利用 T-P0-3 产出的 `web/src/types/blocknote.ts`，将 `Editor.tsx` 中 `bn: any[]` 改为 `bn: BNBlock[]`，逐步消除可消除的 `eslint-disable` 注释（不强求全部消除，以不引入类型断言为目标）。

**不做什么**：不修改 `Block` 类型定义中的 `content: string`；不做 runtime validation。

**前置条件**：T-P0-3

**估算工作量**：1 天

---

#### T-P1-6：I-013 PageItem 重复组件合并

**做什么**：将 `PageItem` 和 `PageItemWithRename` 合并为单个 `PageItem`，增加可选 `renameTrigger?: number` prop；保留 `RenameAwarePageItem` 作为 CustomEvent 订阅包装层（不动通信机制）。

**不做什么**：不引入 Zustand（AR-5 另立任务）；不修改 CustomEvent 通信模式。

**估算工作量**：1 天

---

### P2 最后（优化项，按优先级酌情推进）

---

#### T-P2-1：I-022 commitEdit 乐观更新

**做什么**：`DatabaseView.tsx` `commitEdit` 函数实现乐观更新（本地 state 先更新，失败时回滚），消除视觉闪烁。

**估算工作量**：0.5 天

---

#### T-P2-2：I-017 useMonthNav 提取

**做什么**：新建 `web/src/hooks/useMonthNav.ts`；`CalendarView.tsx` 和 `TimelineView.tsx`（month 分支）改为使用此 hook。

**估算工作量**：0.5 天

---

#### T-P2-3：I-016 settingsStore 解耦

**做什么**：在 `settingsStore.ts` 中新增 `useThemeId()` 导出；`Editor.tsx` 改为使用 `useThemeId()`。

**估算工作量**：0.25 天

---

#### T-P2-4：I-019 findPageFlat 删除 + magic literal

**做什么**：删除 `Sidebar.tsx` L534–536 的 `findPageFlat`；在 `blocknote.ts` 或 `blockTypes.ts` 定义 `BLOCK_TYPES` 常量；`toBlockNote.ts` 替换 magic literal。

**估算工作量**：0.5 天

---

#### T-P2-5：I-018 封面图改文件存储

**做什么**：`App.tsx` `handleChangeCover` 改用 `api.uploads.upload`，`cover` 字段存 URL。

**前置条件**：T-P1-2（`api.uploads.upload` 已实现）

**估算工作量**：0.5 天

---

#### T-P2-6：I-020 loadAvailableDatabases 缓存失效（临时方案）

**做什么**：修改 `openAddCol` 在每次打开 popover 时清空 `availableDatabases`，触发重新加载；同时为 GET /api/databases 接口预留前端调用占位（待后端 REQ-065 实现后替换）。

**估算工作量**：0.25 天

---

#### T-P2-7：AR-1 DatabaseView 组件拆分（大型任务）

**做什么**：按第 3 节结构图，将 `DatabaseView.tsx` 拆分为 `DatabaseToolbar`、`DatabaseTableView`、`DatabaseColMenu`、`DatabaseAddColPopover`、`DatabaseRowModal`、`DatabaseBatchBar` 六个新文件；提取 `useRowEditor` hook。

**不做什么**：不做状态下移（所有 state 保留在 `DatabaseView`）；不改变组件对外的 `Props` 接口（`{ databaseId: string }` 不变）。

**注意**：此任务改动量大（≈1200 行移动），建议在以上所有 P0/P1 bug fix 全部完成且合并主干后再进行，避免 merge conflict。

**估算工作量**：3–4 天（含测试）

---

### 任务依赖关系

```
T-P0-2 (toast)
  └── T-P1-2 (api.uploads/meta)
        └── T-P2-5 (封面图)

T-P0-3 (BNBlock 类型)
  └── T-P1-5 (类型链路消 any)

T-P1-1 (shared.ts)        — 无前置
T-P1-3 (overlay isConnected) — 无前置
T-P1-4 (Tauri sidecar)    — 无前置
T-P1-6 (PageItem 合并)    — 无前置

T-P2-1 (乐观更新)         — 无前置
T-P2-2 (useMonthNav)      — 无前置
T-P2-3 (settingsStore)    — 无前置
T-P2-4 (findPageFlat)     — 无前置
T-P2-6 (缓存失效)         — 无前置
T-P2-7 (DatabaseView 拆分) — 建议 P0+P1 全部完成后进行
```

---

*本方案由前端架构师（arch-frontend）于 2026-05-02 生成，dispatch #39 / REQ-064。本轮只出方案，未修改任何源代码文件。*
