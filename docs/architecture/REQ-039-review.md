# REQ-039 架构评审 — 个性化设置系统（字体 + 主题）

**日期**：2026-04-30
**需求**：个性化设置系统：字体切换 + 主题切换
**状态**：待实现

---

## 一、现状分析

### 1.1 CSS 变量体系现状

当前代码库**没有任何 CSS 自定义变量**（`--` 前缀）。所有颜色和字体均为硬编码值，分布在 4 个 CSS 文件中：

| 文件 | 硬编码颜色 | 硬编码字体 |
|------|-----------|-----------|
| `index.css` | `#fff`, `#37352f` | `-apple-system, BlinkMacSystemFont, ...` |
| `App.css` | `#37352f`, `#9b9a97`, `#fff`, `rgba(55,53,47,...)` | `font-family: inherit` |
| `Editor.css` | `#37352f`, `#9b9a97`, `#f7f6f3`, `#2383e2`, `#fff` | `-apple-system, ...` + 等宽栈 |
| `DatabaseView.css` | `#37352f`, `#9b9a97`, `#fff`, `#2383e2`, `#eb5757`, `#e3e2e0`, `rgba(55,53,47,...)` | `font-family: inherit` |
| `Sidebar.css` | `#37352f`, `#9b9a97`, `#f7f7f5`, `#fff`, `rgba(55,53,47,...)` | `font-family: inherit` |

**关键发现**：颜色使用量最多的是 `#37352f`（主文本色）和 `rgba(55,53,47,...)`（半透明边框/悬停），出现 60+ 次；若全部替换为 CSS 变量，迁移工作量相当。

### 1.2 字体现状

`index.css` body 和 `Editor.css .bn-default-styles` 各自有字体栈（REQ-037 已分析），但均为硬编码 `font-family`。`--font-body` 变量不存在。

代码块字体在 `Editor.css` 中用显式等宽栈，需在主题/字体切换时保持**隔离**（不跟随 `--font-body`）。

### 1.3 `data-theme` 机制现状

`<html>` / `<body>` 上无任何 `data-theme` 属性，也无基于 `data-theme` 的 CSS 选择器。BlockNote 自身用 `data-color-scheme` 切换暗色，与本需求 `data-theme` 不冲突，但暗色主题时需额外处理 BlockNote 内部暗色变量（详见风险部分）。

### 1.4 应用入口现状

`main.tsx` 仅 10 行，负责挂载 React 根节点并 `import "./index.css"`。`App.tsx` 是 React 主组件，负责页面渲染和状态。初始化逻辑（读 localStorage）放在 `main.tsx` 的 `createRoot` 之前最合适，能保证 DOM 准备好即应用字体/主题，避免首帧闪烁（FOUC）。

---

## 二、具体实现方案

### 2.1 文件结构

```
web/src/
  settings/
    resourceTypes.ts          # ResourceEntry 类型定义
    fontConfig.ts             # 字体预置清单（11 条 ResourceEntry）
    themeConfig.ts            # 主题预置清单（5 条 ResourceEntry）
    resourceLoader.ts         # 通用加载器实现
    settingsStore.ts          # localStorage 读写 + 初始化
  components/
    settings/
      SettingsPanel.tsx       # 设置面板 UI（字体+主题选择器）
      SettingsPanel.css       # 面板样式
  index.css                   # 新增 :root CSS 变量声明 + data-theme 覆盖规则
```

新增文件 7 个，修改文件 4 个（`index.css`、`Editor.css`、`Sidebar.css`、`App.tsx`）。

### 2.2 CSS 变量体系设计

#### 2.2.1 变量定义位置

所有 CSS 变量统一在 `web/src/index.css` 的 `:root`（`default-light` 基准值）中定义，各主题通过 `[data-theme="xxx"]` 选择器覆盖。

#### 2.2.2 变量清单（最小可行集）

```css
:root {
  /* 字体 */
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", "Fira Code",
    "Consolas", "Courier New", monospace;

  /* 背景 */
  --color-bg-primary: #ffffff;        /* 主背景（main、modal、popover）*/
  --color-bg-secondary: #f7f7f5;      /* 次级背景（sidebar）*/
  --color-bg-surface: #f7f6f3;        /* 悬浮面（code block bg、行悬停）*/

  /* 文字 */
  --color-text-primary: #37352f;      /* 主文字 */
  --color-text-secondary: #9b9a97;    /* 次文字 / placeholder */
  --color-text-placeholder: #c7c6c3;  /* placeholder 更浅 */

  /* 强调 */
  --color-accent: #2383e2;            /* 蓝色强调（按钮、选中、链接）*/
  --color-danger: #eb5757;            /* 危险/错误色 */

  /* 边框 / 分割线 */
  --color-border: rgba(55, 53, 47, 0.09);       /* 分割线 */
  --color-border-medium: rgba(55, 53, 47, 0.16); /* 弹窗边框 */

  /* 交互层 */
  --color-hover-bg: rgba(55, 53, 47, 0.04);     /* 行悬停 */
  --color-hover-bg-medium: rgba(55, 53, 47, 0.06); /* 按钮悬停 */
  --color-selected-bg: rgba(55, 53, 47, 0.08);  /* 选中行 */
}
```

#### 2.2.3 主题覆盖规则

```css
/* dark 主题 */
[data-theme="dark"] {
  --color-bg-primary: #191919;
  --color-bg-secondary: #212121;
  --color-bg-surface: #2d2d2d;
  --color-text-primary: #e6e3dd;
  --color-text-secondary: #706f6c;
  --color-text-placeholder: #4a4845;
  --color-accent: #529cca;
  --color-border: rgba(255, 255, 255, 0.07);
  --color-border-medium: rgba(255, 255, 255, 0.13);
  --color-hover-bg: rgba(255, 255, 255, 0.03);
  --color-hover-bg-medium: rgba(255, 255, 255, 0.055);
  --color-selected-bg: rgba(255, 255, 255, 0.07);
}

/* warm 主题 */
[data-theme="warm"] {
  --color-bg-primary: #faf8f5;
  --color-bg-secondary: #f0ece4;
  --color-bg-surface: #ede8df;
  --color-text-primary: #3d3529;
  --color-text-secondary: #9a8f82;
  --color-text-placeholder: #c5b9a9;
  --color-accent: #c97a3a;
  --color-border: rgba(80, 60, 40, 0.09);
  --color-border-medium: rgba(80, 60, 40, 0.15);
  --color-hover-bg: rgba(80, 60, 40, 0.04);
  --color-hover-bg-medium: rgba(80, 60, 40, 0.06);
  --color-selected-bg: rgba(80, 60, 40, 0.08);
}

/* aurora / forest 由远程 CSS 文件提供，动态注入后自动生效 */
```

#### 2.2.4 现有硬编码颜色迁移策略

迁移分两阶段：

**阶段 A（本期 REQ-039）**：只在 `index.css` 添加变量定义和主题覆盖规则；现有 CSS 文件中的硬编码值**仅迁移必须覆盖主题的全局色**，包括：
- `body { background }` → `var(--color-bg-primary)`
- `body { color }` → `var(--color-text-primary)`
- `Editor.css` 中的 `color: #37352f` → `var(--color-text-primary)`
- `.bn-toolbar`、`.bn-suggestion-menu` 背景 `#fff` → `var(--color-bg-primary)`
- Sidebar `.sidebar { background }` → `var(--color-bg-secondary)`
- 弹窗 `.col-menu`、`.formula-popover` 等 `background: #fff` → `var(--color-bg-primary)`

**阶段 B（后续迭代）**：全量替换 `rgba(55,53,47,...)` 系列为变量，完成完整主题体系。

> 阶段 A 最小改动即可保证主题视觉切换有效果，但 `rgba(55,53,47,...)` 的悬停色在暗色主题下仍显浅灰（不影响可用性，但不完美）。

### 2.3 加载器接口设计

```ts
// settings/resourceLoader.ts

interface LoadResult {
  success: boolean;
  fallbackUsed?: boolean;
  fromCache?: boolean;   // true = 从本地持久缓存命中
  error?: string;
}

async function loadResource(entry: ResourceEntry): Promise<LoadResult>
```

#### 2.3.1 加载优先级（远程资源四级降级链）

```
网络请求（最新内容）
  │ 失败/超时
  ▼
本地持久缓存（IndexedDB，上次下载内容，含 MD5 校验）
  │ 无缓存 / 哈希不匹配
  ▼
内置本地默认（default-sans / default-light）
```

> 只有在网络**和**本地缓存都无法使用时，才降级到内置默认，并展示提示。若从本地缓存加载，展示"已离线，使用上次下载版本"通知（不视为失败）。

#### 2.3.2 本地持久缓存机制

**存储方案**：IndexedDB（`noteyard-resources` 数据库，`css-cache` 对象仓库）。

每条缓存记录结构：

```ts
interface CacheRecord {
  id: string;       // ResourceEntry.id，如 "noto-sans-sc"
  cssText: string;  // 完整 CSS 文本内容
  md5: string;      // cssText 的 MD5 哈希（hex 字符串，用于校验内容完整性）
  cachedAt: number; // 缓存时间戳（毫秒），用于显示"上次更新"
}
```

**MD5 实现**：使用 `crypto.subtle.digest("SHA-256", ...)` 替代 MD5（Web Crypto API 原生支持，无需引入依赖；文档仍沿用"MD5"称呼，实际用 SHA-256 hex）。

#### 2.3.3 完整实现逻辑

1. **本地资源**（`entry.type === "local"`）：
   - `applyMethod === "css-var"` → `document.documentElement.style.setProperty("--font-body", entry.fontStack)`
   - `applyMethod === "data-theme"` → `document.documentElement.setAttribute("data-theme", entry.id)`
   - 返回 `{ success: true }`

2. **远程资源，已在 DOM**（`[data-resource-id]` 存在）：
   - 直接执行生效操作，跳过所有 fetch，返回 `{ success: true }`

3. **远程资源，网络可达**：
   - `fetch(entry.url)` → 读取响应文本
   - 计算 SHA-256 哈希
   - 读取 IndexedDB 旧记录；若哈希相同，跳过写入（节省 I/O）；若不同，更新缓存
   - 将 CSS 文本注入 `<style data-resource-id={entry.id}>` 到 `document.head`
   - 执行生效操作，返回 `{ success: true }`
   - 网络失败/超时（8s）→ 进入步骤 4

4. **远程资源，网络失败 → 读本地缓存**：
   - 从 IndexedDB 读取对应 `id` 的 `CacheRecord`
   - 若存在：注入 `<style>` → 执行生效操作 → 返回 `{ success: true, fromCache: true }`
   - 若不存在：进入步骤 5

5. **降级**：`applyFallback(type: "font" | "theme")` → 应用对应类型的本地默认资源，返回 `{ success: false, fallbackUsed: true, error }`

#### 2.3.4 缓存辅助函数清单

| 函数 | 说明 |
|------|------|
| `openCacheDB(): Promise<IDBDatabase>` | 打开/升级 IndexedDB |
| `getCacheRecord(id): Promise<CacheRecord \| null>` | 读取单条缓存 |
| `setCacheRecord(record: CacheRecord): Promise<void>` | 写入/更新缓存 |
| `hashText(text: string): Promise<string>` | SHA-256 → hex 字符串 |
| `injectStyleTag(id, cssText)` | 将 CSS 文本注入 `<style>` 标签 |
| `applyFallback(type)` | 降级到本地默认 |

### 2.4 fontConfig.ts / themeConfig.ts

```ts
// settings/fontConfig.ts
export const FONTS: ResourceEntry[] = [
  { id: "default-sans", name: "Default Sans", type: "local", applyMethod: "css-var",
    fontStack: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif` },
  { id: "serif", name: "Serif", type: "local", applyMethod: "css-var",
    fontStack: `ui-serif, Georgia, "Times New Roman", Times, serif` },
  { id: "mono", name: "Mono", type: "local", applyMethod: "css-var",
    fontStack: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` },
  { id: "noto-sans-sc", name: "思源黑体", type: "remote", applyMethod: "css-var",
    url: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap",
    fontStack: `"Noto Sans SC", sans-serif` },
  // ... 其余 7 种网络字体
];

// settings/themeConfig.ts
export const THEMES: ResourceEntry[] = [
  { id: "default-light", name: "默认亮色", type: "local", applyMethod: "data-theme" },
  { id: "dark",  name: "暗色", type: "local", applyMethod: "data-theme" },
  { id: "warm",  name: "暖米色", type: "local", applyMethod: "data-theme" },
  { id: "aurora", name: "极光", type: "remote", applyMethod: "data-theme",
    url: "/themes/aurora.css" },
  { id: "forest", name: "森林", type: "remote", applyMethod: "data-theme",
    url: "/themes/forest.css" },
];
```

> `ResourceEntry` 需在 `resourceTypes.ts` 中扩展 `fontStack?: string` 字段供 `applyMethod: "css-var"` 使用，或将其放入单独的 `FontEntry` 子类型。

### 2.5 settingsStore.ts

```ts
// 读取持久化偏好
export function loadSavedSettings(): { fontId: string; themeId: string } {
  return {
    fontId: localStorage.getItem("noteyard_font") ?? "default-sans",
    themeId: localStorage.getItem("noteyard_theme") ?? "default-light",
  };
}

// 保存偏好
export function saveFont(id: string): void { localStorage.setItem("noteyard_font", id); }
export function saveTheme(id: string): void { localStorage.setItem("noteyard_theme", id); }
```

### 2.6 初始化时机

**在 `main.tsx` 的 `createRoot` 之前同步调用初始化**：

```ts
// main.tsx（修改后）
import { initSettings } from "./settings/settingsStore";
initSettings();   // 同步读 localStorage，立即设置 CSS 变量和 data-theme
createRoot(document.getElementById("root")!).render(...);
```

`initSettings` 对本地资源（`default-sans` / `default-light`）做同步处理，对远程资源只有在用户之前保存了网络字体/主题时才异步加载；首帧前已完成本地默认应用，不产生 FOUC。

### 2.7 UI 入口：设置面板

**位置**：侧边栏底部 `.sidebar-footer` 区域，在「新建页面」按钮**下方**新增一个「设置」图标按钮（`⚙`），点击弹出悬浮设置面板。

**理由**：
- Sidebar.css 已有 `.sidebar-footer` 结构，`.sidebar-new-page-btn` 样式可复用。
- 设置是工作区全局操作，放侧边栏符合 Notion 等工具惯例。
- 不新增顶栏，避免影响编辑区域宽度。

**面板结构**（`SettingsPanel.tsx`）：
```
[字体]
  ○ Default Sans   ○ Serif   ○ Mono
  ○ 思源黑体 🌐   ○ 阿里普惠体 🌐  ○ 霞鹜文楷 🌐  ...
  [加载中...] / [无法加载，已使用默认]

[主题]
  ○ 默认亮色  ○ 暗色  ○ 暖米色
  ○ 极光 🌐  ○ 森林 🌐
```

面板以绝对定位浮层呈现（`position: fixed`，参考 `.ctx-menu` 样式规范），点击外部关闭。

### 2.8 与现有代码的兼容

#### 字体迁移

`Editor.css` 中 `.bn-default-styles` 的 `font-family` 改为 `var(--font-body)`，代码块字体保持硬编码等宽栈（**不**使用 `--font-body`），实现字体隔离（对应验收标准场景 11）。

```css
/* Editor.css 修改后 */
.editor-wrap .bn-default-styles {
  font-size: 16px;
  font-weight: 400;
  line-height: 1.5;
  color: var(--color-text-primary);
  font-family: var(--font-body);
}
```

#### BlockNote 暗色模式兼容

BlockNote 用 `data-color-scheme="dark"` 控制编辑器内部暗色（背景、文字均有内置变量）。切换到 `dark` 主题时，需同步设置 BlockNote 的 `theme` prop 为 `"dark"`，或通过 CSS 在 `[data-theme="dark"] .bn-editor` 上覆盖 BlockNote 内部变量。

**推荐方案**：在 `settingsStore` 中暴露一个 React context / event，`App.tsx` 订阅后将 `theme` prop 传入 `<BlockNoteView>`，实现 BlockNote 内部暗色同步。这是本需求最复杂的兼容点。

---

## 三、任务拆分

| ID | 描述 | 文件 | 依赖 |
|----|------|------|------|
| T01 | 定义 `ResourceEntry` 类型（含可选 `fontStack`） | `settings/resourceTypes.ts`（新建） | — |
| T02 | 实现字体配置清单（11 条） | `settings/fontConfig.ts`（新建） | T01 |
| T03 | 实现主题配置清单（5 条） | `settings/themeConfig.ts`（新建） | T01 |
| T04 | 实现 `resourceLoader.ts`（加载器 + 四级降级 + IndexedDB 缓存） | `settings/resourceLoader.ts`（新建） | T01 |
| T05 | 实现 `settingsStore.ts`（localStorage + initSettings） | `settings/settingsStore.ts`（新建） | T02、T03、T04 |
| T06 | `index.css`：添加 `:root` CSS 变量 + `[data-theme]` 覆盖规则 | `index.css` | — |
| T07 | 在 `main.tsx` 调用 `initSettings()`（同步初始化） | `main.tsx` | T05、T06 |
| T08 | `Editor.css`：将 `font-family` 和主色 `color` 改为 CSS 变量 | `Editor.css` | T06 |
| T09 | `Sidebar.css`：将 `background`、`color` 等主色改为 CSS 变量 | `Sidebar.css` | T06 |
| T10 | `App.css`：将 `background`、`color` 等主色改为 CSS 变量 | `App.css` | T06 |
| T11 | 实现 `SettingsPanel.tsx` UI（字体 + 主题选择 + 状态反馈） | `components/settings/SettingsPanel.tsx`（新建）+ CSS | T04、T05 |
| T12 | `App.tsx`（或 `Sidebar.tsx`）集成设置入口按钮 + 面板 | `App.tsx` / `Sidebar.tsx` | T11 |
| T13 | BlockNote 暗色同步（context + `<BlockNoteView theme>` prop） | `Editor.tsx`、`settingsStore.ts` | T05、T12 |
| T14 | 远程主题 CSS 文件制作（`aurora.css` / `forest.css`） | `public/themes/`（新建） | T06 |

**建议执行顺序**：
```
T01 → T06 → T02/T03 并行 → T04 → T05 → T07
                                         ↓
                              T08/T09/T10 并行 → T11 → T12 → T13
                                                              T14（可并行）
```

---

## 四、风险评估

| 风险 | 级别 | 说明 | 缓解措施 |
|------|------|------|---------|
| BlockNote 内部暗色变量与 `data-theme="dark"` 不同步 | 高 | BlockNote 有自己的暗色机制（`data-color-scheme`），若不处理，切暗色时编辑器内部仍为亮色 | T13 专项处理；可先用 CSS 覆盖 `.editor-wrap` 内 BlockNote 变量作为临时方案 |
| 全量 CSS 变量迁移工作量大 | 中 | `rgba(55,53,47,...)` 出现 60+ 次；阶段 A 若只迁移部分，暗色下悬停色与背景对比度异常 | 分阶段，阶段 A 只迁移背景/文字主色，悬停色放阶段 B |
| Google Fonts 在中国大陆无法访问 | 中 | 思源黑体、ZCOOL 系列来自 Google Fonts，即便有网络也可能超时；首次下载后依赖本地缓存 | jsDelivr 镜像作备用 CDN；超时 8s 后转本地缓存；用户提示 |
| IndexedDB 读写失败（隐私模式/存储配额） | 中 | 隐私浏览模式下 IndexedDB 可能被禁用；存储配额耗尽时写入失败 | 所有 IndexedDB 操作包裹 try/catch；失败时跳过缓存写入（不影响当次加载），降级为内置默认 |
| 远程字体 CSS 含 @import 或多条 @font-face（无法直接注入 `<style>`） | 中 | Google Fonts 返回的 CSS 包含多个 `@font-face`，直接注入 `<style>` 可正常工作；但若字体文件本身（`.woff2`）需要跨域缓存则需 CORS | 只缓存 CSS 文本（`@font-face` 声明），字体二进制文件仍走浏览器 HTTP 缓存；首次加载后浏览器通常已缓存字体文件，后续离线时 CSS 能注入但字体文件可能缺失（接受此限制）|
| 远程字体加载导致 FOUC（内容已渲染但字体未就绪） | 低-中 | 网络字体加载期间浏览器用回退字体渲染，字体加载完成后重排 | 加载中展示 spinner 反馈；用 `font-display: swap` 保证文字可读 |
| 首次启动时远程资源恢复（localStorage 已有网络字体/主题） | 低 | `initSettings` 在 `main.tsx` 异步加载，可能首帧略有延迟 | 先同步应用本地默认，异步加载（含本地缓存读取）完成后无缝切换 |
| `[data-theme]` CSS 特异性低于现有硬编码选择器 | 低 | 若某 CSS 规则带 class 前缀（如 `.sidebar { background: #f7f7f5 }`），其特异性高于 `[data-theme="dark"]` 下的裸变量声明 | 统一在各组件选择器内引用变量，如 `.sidebar { background: var(--color-bg-secondary) }` 替代硬编码 |
| 网络主题 CSS 路径（`/themes/aurora.css`）需 Vite 静态资源配置 | 低 | 文件放 `public/themes/` 下，Vite dev server 自动 serve，无额外配置 | 确认 `public/` 目录在项目中存在 |

---

## 五、总结

本需求工程量适中，核心路径清晰：**CSS 变量体系建立（T06）** 是地基；**BlockNote 暗色同步（T13）** 是最高风险点（建议用 React context 而非纯 CSS 覆盖）；**本地持久缓存（T04 IndexedDB）** 是本期新增的关键能力——网络不可达时仍能使用已下载资源，需覆盖隐私模式降级路径。

**三级降级链（最终版）**：网络 → IndexedDB 缓存（含 SHA-256 校验）→ 内置本地默认。只有两级都失败时才影响用户视觉，且均有友好提示。

阶段 A 按 T01–T14 完成后，可支撑全部 12 个场景矩阵和验收标准；阶段 B 再全量迁移剩余硬编码颜色，完成完整主题体系。
