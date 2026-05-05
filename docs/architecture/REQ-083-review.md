# REQ-083 架构评审 — 按钮块能力增强

| 字段 | 内容 |
|------|------|
| REQ ID | REQ-083 |
| 评审角色 | arch-frontend-editor（arch-frontend#211） |
| 评审日期 | 2026-05-05 |
| 评审范围 | `web/src/components/editor/` |
| 来源文档 | `docs/requirements/features/REQ-083.md`、`docs/issues/ISS-043.md` |

---

## 一、模块列表

本次变更只涉及一个模块：

| 模块名 | 路径 | 说明 |
|--------|------|------|
| `editor` | `web/src/components/editor/` | BlockNote 编辑器 + 自定义块定义 |

后续角色（工程师、测试）的摘要文件命名须使用：`{role_key}-editor.md`（如 `eng-editor.md`）。

---

## 二、现状梳理

### 2.1 ButtonBlock 当前结构

`Editor.tsx` 中的 `ButtonBlock` 是一个 `createReactBlockSpec` 定义的 atom 节点（`content: "none"`），其 `propSchema` 当前包含四个字段：

```ts
propSchema: {
  label:  { default: "点击" },
  color:  { default: "default" },   // ButtonColor = "default"|"blue"|...
  action: { default: "none" },      // ButtonAction = "none"|"open_url"
  url:    { default: "" },
}
```

render 函数内部通过 React state 维护面板开关（`panelOpen`）、草稿值（`labelDraft`、`colorDraft` 等），以及 `position:fixed` 面板坐标（`panelPos`）。

设置按钮（⚙）已通过 `settingsBtnRef` + 原生 `addEventListener("mousedown")` 绕过 ProseMirror atom 节点事件拦截（ISS-041/ISS-042 方案），主按钮 `handleClick` 仍依赖 React 合成 `onClick`——这是 ISS-043 的根因。

### 2.2 相关既有模式

- **原生 mousedown 绑定**：`settingsBtnRef` effect（L443–464）是已验证的 atom 节点事件处理模式，FR-2 主按钮修复须对齐此模式，新增 `mainBtnRef` + 对应 effect。
- **subpage 创建**：斜杠菜单 `subpageItem.onItemClick`（L978–990）已有 `api.pages.create` + `insertOrUpdateBlock` 的完整流程，FR-3 直接复用此模式。
- **页面属性编辑 UI**：`App.tsx` 的 `EMOJI_COMMON`、`handleAddCover`、`handleRemoveCover`、`handleIconSelect` 逻辑须在 Editor 内**内联重实现**（不可直接引用 App 级状态），逻辑轻量不需要抽共享 hook。
- **position:fixed 面板**：`button-block-panel` 的 `panelPos` 计算方案（ISS-042）已稳定，FR-4 属性面板沿用同一方案。

---

## 三、各 FR 实现方案

### FR-1 背景色选择器

#### 数据结构变更

新增类型别名和常量：

```ts
type ButtonBgColor = "default"|"gray"|"brown"|"orange"|"yellow"|"green"|"blue"|"purple"|"pink"|"red";

const BUTTON_BG_COLORS: { value: ButtonBgColor; hex: string; hoverHex: string; label: string }[] = [
  { value: "default", hex: "var(--color-bg-surface)",  hoverHex: "var(--color-hover-bg-medium)", label: "默认" },
  { value: "gray",    hex: "#f1f1ef", hoverHex: "#e4e4e1", label: "灰色" },
  { value: "brown",   hex: "#f4eeee", hoverHex: "#ede5e5", label: "棕色" },
  { value: "orange",  hex: "#fbecdd", hoverHex: "#f3e0cc", label: "橙色" },
  { value: "yellow",  hex: "#fef9c3", hoverHex: "#f9f0a8", label: "黄色" },
  { value: "green",   hex: "#e8f5e8", hoverHex: "#d4ecd4", label: "绿色" },
  { value: "blue",    hex: "#e7f0fd", hoverHex: "#d0e3f9", label: "蓝色" },
  { value: "purple",  hex: "#f3eef8", hoverHex: "#e8dff0", label: "紫色" },
  { value: "pink",    hex: "#fbe8f3", hoverHex: "#f3d5e8", label: "粉色" },
  { value: "red",     hex: "#fde8e8", hoverHex: "#f5d5d5", label: "红色" },
];
```

`propSchema` 新增字段：

```ts
bgColor: { default: "default" },   // 类型 ButtonBgColor
```

`ButtonAction` 类型（预留 FR-3/FR-4）：

```ts
type ButtonAction = "none" | "open_url" | "new_subpage" | "edit_page_props";
```

#### 渲染层

读取 `bgColor` prop 后，给主按钮追加 class `bg-{bgColor}`：

```tsx
<button className={`button-block-btn color-${color} bg-${bgColor}`} ...>
```

#### CSS 变更（`Editor.css`）

新增背景色变体（`.button-block-btn.bg-*`）及深色模式覆盖：

```css
/* 亮色模式 */
.button-block-btn.bg-default { background: var(--color-bg-surface); }
.button-block-btn.bg-gray    { background: #f1f1ef; }
.button-block-btn.bg-brown   { background: #f4eeee; }
.button-block-btn.bg-orange  { background: #fbecdd; }
.button-block-btn.bg-yellow  { background: #fef9c3; }
.button-block-btn.bg-green   { background: #e8f5e8; }
.button-block-btn.bg-blue    { background: #e7f0fd; }
.button-block-btn.bg-purple  { background: #f3eef8; }
.button-block-btn.bg-pink    { background: #fbe8f3; }
.button-block-btn.bg-red     { background: #fde8e8; }

/* 深色模式 */
.dark .button-block-btn.bg-gray    { background: #3b3b39; }
.dark .button-block-btn.bg-brown   { background: #4a3b3b; }
.dark .button-block-btn.bg-orange  { background: #4d3a27; }
.dark .button-block-btn.bg-yellow  { background: #3d3a18; }
.dark .button-block-btn.bg-green   { background: #1e3b1e; }
.dark .button-block-btn.bg-blue    { background: #1a2e4a; }
.dark .button-block-btn.bg-purple  { background: #2d2340; }
.dark .button-block-btn.bg-pink    { background: #3d1a2e; }
.dark .button-block-btn.bg-red     { background: #3d1a1a; }
```

#### 设置面板

在现有颜色选择器（`.color-swatch-row`）之后，新增「背景色」区块，UI 结构与文字色选择器完全对称：

```tsx
<div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
  <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>背景色</span>
  <div className="color-swatch-row">
    {BUTTON_BG_COLORS.map(c => (
      <button
        key={c.value}
        className={`color-swatch${bgColorDraft === c.value ? " selected" : ""}`}
        style={{ background: c.hex }}
        title={c.label}
        onMouseDown={ev => { ev.preventDefault(); setBgColorDraft(c.value); }}
      />
    ))}
  </div>
</div>
```

新增 state `bgColorDraft`，初始值来自 `block.props.bgColor`；`commitPanel` 中一并写入。

#### 持久化

`commitPanel` 调用 `editor.updateBlock(block, { props: { ..., bgColor: bgColorDraft } })`，由 BlockNote 序列化到 `block.props`，再经现有 `buildDtosRecursive` 的 `button` 分支（L709）序列化为 `content: JSON.stringify(b.props)` 写入后端——无需修改序列化逻辑。

#### 潜在风险

- `button-block-btn` 原有的 `.button-block-btn:hover` 规则设置 `background: var(--color-hover-bg-medium)`，会覆盖背景色变体的 hover 态，需在 `.bg-*` 样式后额外定义 hover 覆盖，或在 `:hover` 规则中加 `not(.bg-default)` 选择器。推荐做法：每个 `.bg-X:hover` 单独声明一个略深的 hover 色（已在 `BUTTON_BG_COLORS` 中准备了 `hoverHex`）。
- 当 `bgColor = "default"` 时与原有行为完全兼容，不影响现有按钮块展示。

---

### FR-2 修复「打开链接」点击无响应（ISS-043）

#### 根因确认

详见 `docs/issues/ISS-043.md §根因假设`：ProseMirror atom 节点在 `mousedown` 阶段调用 `view.focus()` + `view.dispatch()`，导致 React 合成 `onClick` 无法触发。

#### 修复方案

新增 `mainBtnRef`，对齐 `settingsBtnRef` 的原生 mousedown effect 模式：

```tsx
const mainBtnRef = React.useRef<HTMLButtonElement>(null);

React.useEffect(() => {
  const btn = mainBtnRef.current;
  if (!btn) return;
  const handler = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 读取最新 action/url（闭包中 action/url 为初始值，需从 block.props 读取）
    const currentAction = block.props.action as ButtonAction;
    const currentUrl = block.props.url ?? "";
    if (currentAction === "open_url") {
      if (!isSafeUrl(currentUrl)) {
        alert("URL 不合法：必须以 http:// 或 https:// 开头");
        return;
      }
      window.open(currentUrl, "_blank", "noopener,noreferrer");
    }
    // new_subpage / edit_page_props 在各自 FR 中扩展此 handler
  };
  btn.addEventListener("mousedown", handler);
  return () => btn.removeEventListener("mousedown", handler);
// block.props 是对象引用，不在 deps 中也不需要——每次 render 时 effect 重新注册
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

主按钮 JSX 去掉 `onClick={handleClick}`，改为 `ref={mainBtnRef}`：

```tsx
<button
  ref={mainBtnRef}
  className={`button-block-btn color-${color} bg-${bgColor}`}
  title={action === "open_url" ? url : undefined}
>
  {label}
</button>
```

原有 `handleClick` 函数可删除。

#### 关键细节

**闭包陷阱**：effect 在 mount 时注册，handler 内的 `action`/`url` 变量是 render 时的快照，若用户在设置面板修改后不重新提交，`block.props` 与闭包内 `action`/`url` 可能不一致。**必须在 handler 内读 `block.props.action` 和 `block.props.url`**，而非闭包变量。

`isSafeUrl` 已位于 `web/src/utils/urlUtils.ts`，已在 Editor.tsx 顶部 import（L39），直接复用。

---

### FR-3 新建子页面动作

#### propSchema 变更

`action` 枚举扩展（在 FR-2 修复基础上）：

```ts
type ButtonAction = "none" | "open_url" | "new_subpage" | "edit_page_props";
```

`propSchema.action` 的有效性校验数组同步扩展：

```ts
const a = block.props.action as ButtonAction;
action = (["none","open_url","new_subpage","edit_page_props"] as ButtonAction[]).includes(a) ? a : "none";
```

#### 点击处理

在 `mainBtnRef` effect 的 handler 中新增分支：

```ts
if (currentAction === "new_subpage") {
  void (async () => {
    try {
      const newPage = await api.pages.create({ parent_id: pageId, title: "Untitled", order_index: 9999 });
      insertOrUpdateBlock(editor, {
        type: "subpage",
        props: { pageId: newPage.id, title: newPage.title || "Untitled", icon: "📄" },
      } as any);
      onSelectPage?.(newPage.id);
    } catch (err) {
      console.error("[ButtonBlock] new_subpage failed:", err);
    }
  })();
}
```

`pageId` 和 `onSelectPage` 来自 `Editor` 组件的 Props，需向下传递到 `ButtonBlock` render 函数。

#### 传参方式

`ButtonBlock` 是通过 `createReactBlockSpec` 定义的，render 函数只接收 `{ block, editor }`，**无法直接接收外部 props**。

解决方案：在 `Editor` 组件外层（schema 定义之前）通过 **ref 对象**（不是 state）暴露 `pageId` 和 `onSelectPage`：

```ts
// 模块级 ref，供 ButtonBlock render 访问（ButtonBlock 在 Editor 组件外定义）
const buttonBlockCtxRef = { pageId: "", onSelectPage: undefined as ((id: string) => void) | undefined };
```

在 `Editor` 组件的 effect 中同步最新值：

```ts
useEffect(() => {
  buttonBlockCtxRef.pageId = pageId;
  buttonBlockCtxRef.onSelectPage = onSelectPage;
}, [pageId, onSelectPage]);
```

ButtonBlock handler 内通过 `buttonBlockCtxRef.pageId` 和 `buttonBlockCtxRef.onSelectPage` 读取。

**替代方案**：将 `ButtonBlock` 改为工厂函数 `createButtonBlock(ctxRef)` 按需生成，在 schema 内 `button: createButtonBlock(ctxRef)` 注册。两种方案等价，工厂函数方式封装更明确，推荐优先考虑。但需注意 `schema` 变量须从当前顶层常量改为 `useMemo`（在 Editor 组件内生成）或改为函数形式。

> **注意**：当前 `schema` 定义在 `Editor` 组件外部（L607），`useCreateBlockNote({ schema })` 只在 mount 时使用一次。若引入工厂函数方案，需确认 BlockNote 对 schema 对象的引用稳定性要求——若要求 schema 引用稳定（通常如此），使用模块级 `ctxRef` 模式更安全，无需修改 schema 定义位置。**推荐采用模块级 `ctxRef` 方案**。

#### 设置面板

`PanelSelect` 的 `options` 新增两项：

```tsx
options={[
  { value: "none",           label: "无动作" },
  { value: "open_url",       label: "打开链接" },
  { value: "new_subpage",    label: "新建子页面" },
  { value: "edit_page_props", label: "编辑页面属性" },
]}
```

选中 `new_subpage` 时，面板不展示额外配置项（与 `none` 同等处理，无条件渲染）。

---

### FR-4 编辑页面属性动作

#### 内联子组件设计

新增内联组件 `PagePropsPanel`，在 `ButtonBlock` render 函数内定义（或文件内局部定义）：

```tsx
interface PagePropsPanelProps {
  pageId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

function PagePropsPanel({ pageId, anchorRect, onClose }: PagePropsPanelProps) {
  // ...
}
```

组件职责：
1. mount 时调用 `api.pages.get(pageId)` 拉取最新页面数据，填充本地 state（`icon`、`cover`、`title`）。
2. 渲染三个编辑区：图标（emoji 点选）、封面（按钮操作）、标题（文本输入框）。
3. 每项变更即时调用 `api.pages.update(pageId, { ... })` 保存（title 在失焦或回车时触发）。
4. 点击面板外部或按 Escape 时调用 `onClose`。

组件不更新 `block.props`，只操作页面 API。

#### 定位方案

沿用 `button-block-panel` 的 `position:fixed` + `getBoundingClientRect()` 方案（ISS-042）：

```ts
const rect = mainBtnRef.current!.getBoundingClientRect();
// 计算 top/left，翻转逻辑参照 settingsBtnRef effect（L452–458）
setPagePropsPanelPos({ top: ..., left: rect.left });
setPagePropsPanelOpen(true);
```

#### 图标选择器

内联 `EMOJI_COMMON` 数组（从 App.tsx 复制，共 30 项），使用与 `App.tsx` 相同的 grid 布局。不引入对 App.tsx 的依赖，因为 `EMOJI_COMMON` 是纯数据常量，复制成本低。

封面操作复用 App.tsx 逻辑：
- 「添加/更换默认封面」：写入 `linear-gradient(135deg,#667eea 0%,#764ba2 100%)`。
- 「删除封面」：写入 `""`。

#### 事件处理

面板的 `mousedown` 需用与 `button-block-panel` 相同的原生 `addEventListener` 注册（`panelRef` effect 模式，L471–486），防止 ProseMirror 拦截面板内交互。

面板内 `<input>` 等 interactive 元素的 `e.preventDefault()` 豁免逻辑（L476–480）须保留。

#### CSS 变更（`Editor.css`）

新增面板样式，与 `.button-block-panel` 保持视觉一致：

```css
.page-props-panel {
  /* position/top/left 由 inline style 控制（position:fixed + JS 坐标） */
  z-index: 60;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  box-shadow: rgba(0,0,0,.15) 0 4px 12px;
  padding: 12px 14px;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.page-props-panel-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.page-props-panel-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.page-props-emoji-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  max-width: 200px;
}
.page-props-emoji-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 3px;
  border-radius: 3px;
}
.page-props-emoji-btn:hover { background: var(--color-hover-bg-medium); }
.page-props-cover-row {
  display: flex;
  gap: 6px;
}
.page-props-cover-btn {
  font-size: 12px;
  padding: 3px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
}
.page-props-cover-btn:hover { background: var(--color-hover-bg); }
.page-props-title-input {
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 13px;
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-family: inherit;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.page-props-title-input:focus { border-color: var(--color-accent); }
```

#### 关键细节

- `api.pages.get` 失败时，面板内容降级为空（`icon = ""`、`cover = null`、`title = ""`），不影响面板打开。
- 标题修改保存后**不调用** `refreshSidebar`（该方法属于 App 层），若需侧边栏同步，需通过 `window.dispatchEvent(new CustomEvent("rename-page", ...))` 触发（与现有 Sidebar 订阅模式一致，可选实现）。

---

## 四、接口契约

### 4.1 ButtonBlock propSchema（修改后完整版）

```ts
propSchema: {
  label:   { default: "点击" },         // string
  color:   { default: "default" },      // ButtonColor
  bgColor: { default: "default" },      // ButtonBgColor（新增）
  action:  { default: "none" },         // ButtonAction（扩展）
  url:     { default: "" },             // string（仅 action=open_url 时有效）
}
```

### 4.2 新增类型

```ts
type ButtonBgColor = "default"|"gray"|"brown"|"orange"|"yellow"|"green"|"blue"|"purple"|"pink"|"red";
type ButtonAction  = "none"|"open_url"|"new_subpage"|"edit_page_props";
```

### 4.3 API 调用（前端侧）

| 功能 | 调用 |
|------|------|
| FR-3 创建子页面 | `api.pages.create({ parent_id: pageId, title: "Untitled", order_index: 9999 })` |
| FR-4 拉取页面数据 | `api.pages.get(pageId)` |
| FR-4 更新图标 | `api.pages.update(pageId, { icon: emoji })` |
| FR-4 更新封面 | `api.pages.update(pageId, { cover: value })` |
| FR-4 更新标题 | `api.pages.update(pageId, { title: value })` |

以上接口均已在 `web/src/api/client.ts`（`api.pages.*`）中存在，无需新增后端接口。

### 4.4 模块级 ctxRef 接口

```ts
// 定义在 ButtonBlock createReactBlockSpec 之前（Editor.tsx 模块级）
const buttonBlockCtxRef: {
  pageId: string;
  onSelectPage: ((id: string) => void) | undefined;
} = { pageId: "", onSelectPage: undefined };
```

---

## 五、改动文件总览

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `web/src/components/editor/Editor.tsx` | 修改 | ButtonBlock propSchema 扩展；新增类型/常量；FR-2 mainBtnRef effect；FR-3/FR-4 handler 分支；设置面板 UI；PagePropsPanel 内联组件；buttonBlockCtxRef；Editor useEffect 同步 ctxRef |
| `web/src/components/editor/Editor.css` | 修改 | `.button-block-btn.bg-*` 背景色变体（亮/暗）；`.page-props-panel` 及子类样式 |

**不涉及**：后端代码、`api/client.ts`、其他组件文件、路由、数据库 schema。

---

## 六、实现顺序建议（对应需求文档 T1–T4）

| 步骤 | 工作 | 依赖 |
|------|------|------|
| T1 | FR-2：添加 `mainBtnRef` + mousedown effect，删除 `handleClick` | 无 |
| T2 | FR-1：新增 `ButtonBgColor` 类型 + `BUTTON_BG_COLORS` 常量；propSchema 新增 `bgColor`；`bgColorDraft` state；设置面板背景色选择器；CSS `.bg-*` | T1 完成后（减少 merge 冲突） |
| T3 | FR-3：`buttonBlockCtxRef` 模块级 ref；Editor useEffect 同步；action 枚举扩展；handler 新增 new_subpage 分支；设置面板新增选项 | T1 |
| T4 | FR-4：`PagePropsPanel` 内联组件；handler 新增 edit_page_props 分支；CSS 面板样式；设置面板新增选项 | T1 |

T2/T3/T4 无相互依赖，可并行，但推荐顺序执行以降低冲突风险。

---

## 七、潜在风险与注意事项

### 7.1 buttonBlockCtxRef 初始化时序

`buttonBlockCtxRef` 在模块加载时初始化为 `{ pageId: "", onSelectPage: undefined }`；`Editor` 组件 mount 后 useEffect 才写入真实值。若按钮块在 Editor mount 前就触发了点击（理论上不可能，但需注意 HMR 热重载场景），`pageId` 可能为空，`new_subpage` 调用会因 `parent_id: ""` 失败。防御措施：在 handler 入口检查 `ctxRef.pageId`，为空时直接返回并 `console.warn`。

### 7.2 action 类型值旧数据兼容

现有 block 数据的 `action` 字段只有 `"none"` 和 `"open_url"` 两个值；新枚举成员 `"new_subpage"`、`"edit_page_props"` 不会出现在历史数据中。有效性校验数组扩展后，旧数据仍被正确处理（未知值 fallback 到 `"none"`），完全向后兼容。

### 7.3 PagePropsPanel 与设置面板同时打开

用户理论上可以通过快速操作同时触发设置面板和属性面板。`panelOpen`（设置面板）和 `pagePropsPanelOpen`（属性面板）是独立 state，两者可以同时为 `true`。需在打开属性面板时关闭设置面板（`setPanelOpen(false)`），反之亦然，避免 z-index 层叠混乱。

### 7.4 属性面板标题更新与 App.tsx pageMeta 同步

`PagePropsPanel` 内修改标题时直接调用 `api.pages.update`，但 App.tsx 中的 `pageMeta.title` 和 `titleDraft` 不会感知到变化，导致页面头部标题未实时更新。

解决方案：通过 `window.dispatchEvent(new CustomEvent("page-props-updated", { detail: { pageId, title } }))` 通知 App.tsx 订阅刷新。该 CustomEvent 方案与 Sidebar `rename-page` 模式一致（`arch-frontend.md §重要约束 4`）。可选实现，不计入 FR-4 的基础验收范围，由工程师自行判断是否在本次实现。

### 7.5 封面上传功能受限

`handleChangeCover` 在 App.tsx 中通过 `input[type=file]` + `FileReader` 实现图片上传为 dataURL。该方案在 Tauri WebView 内存在 512KB 限制约束（App.tsx L153）。FR-4 的属性面板封面操作只提供「添加/更换默认封面」（渐变色），不支持自定义图片上传，与需求文档保持一致，不超范围实现。

### 7.6 hover 样式覆盖优先级

`Editor.css` 现有规则：

```css
.button-block-btn:hover {
  background: var(--color-hover-bg-medium);
  filter: none;
}
```

该规则优先级与 `.button-block-btn.bg-*` 相同（均为一个 class selector），**CSS specificity 相等时后定义优先**。因此只要在 `.button-block-btn.bg-*` 规则之后补充 hover 覆盖即可。工程师须在文件末尾追加 `.button-block-btn.bg-X:hover` 规则，不依赖 `!important`。

---

## 八、回归影响分析

| 区域 | 影响评估 |
|------|---------|
| 现有按钮块（`action=none`、`action=open_url`） | `bgColor` 字段默认值 `"default"`，对应 `var(--color-bg-surface)`，与当前 `.button-block-btn` 原有 `background` 一致；`bg-default` class 不改变外观。完全向后兼容。 |
| 设置面板行为 | `commitPanel` 新增 `bgColor` 字段写入，不影响现有字段持久化逻辑。 |
| 序列化/反序列化 | `buildDtosRecursive` L709 的 `button` 分支使用 `JSON.stringify(b.props)`，新增字段自动包含，无需修改。 |
| ISS-041/ISS-042 修复 | `settingsBtnRef` 和 `panelRef` 的 effect 保持不变，主按钮改用 `mainBtnRef` effect，二者独立，不互相影响。 |
| `tsc --noEmit` | 新增类型 `ButtonBgColor` 和 `ButtonAction` 扩展须在 `propSchema` 的校验数组中同步更新；`buttonBlockCtxRef` 需明确类型注解；`as any` 断言模式沿用现有惯例，不新增类型错误。 |

---

*前端架构师（arch-frontend）生成，DISPATCH #211，2026-05-05。*
