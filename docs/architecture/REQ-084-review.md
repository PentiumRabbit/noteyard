# REQ-084 架构评审 — 按钮块触发自动化规则引擎

| 字段 | 内容 |
|------|------|
| REQ ID | REQ-084 |
| 评审角色 | arch-frontend-REQ084（arch-frontend#222） |
| 评审日期 | 2026-05-05 |
| 评审范围 | `web/src/components/editor/` |
| 来源文档 | `docs/requirements/features/REQ-084.md` |
| 前置评审 | `docs/architecture/REQ-083-review.md` |

---

## 一、模块列表

本次变更只涉及一个模块：

| 模块名 | 路径 | 说明 |
|--------|------|------|
| `editor` | `web/src/components/editor/` | BlockNote 编辑器 + ButtonBlock 自定义块 |

后续角色（工程师、测试）的摘要文件命名须使用：`{role_key}-editor.md`（如 `eng-editor.md`）。

---

## 二、现状梳理

### 2.1 ButtonBlock 当前结构（REQ-083 已交付）

REQ-083 已完成以下扩展（以下均为现有实现，本次评审基于此为基准）：

```ts
type ButtonAction = "none" | "open_url" | "new_subpage" | "edit_page_props";

propSchema: {
  label:   { default: "点击" },
  color:   { default: "default" },
  bgColor: { default: "default" },
  action:  { default: "none" },
  url:     { default: "" },
}
```

主按钮通过 `mainBtnRef` + 原生 `addEventListener("mousedown")` 绑定处理器，读取 `block.props.action` 判断分支执行。设置面板通过 `panelRef` + 原生 `addEventListener("mousedown")` 阻断 PM 拦截。`buttonBlockCtxRef`（模块级 ref）持有 `pageId` 和 `onSelectPage`，由 `Editor` useEffect 同步。

序列化路径：`buildDtosRecursive` 的 button 分支（`Editor.tsx` L958）将整个 `b.props` 序列化为 `content: JSON.stringify(b.props)` 写入后端，新增字段自动包含，无需修改。

### 2.2 关键已验证模式

- **原生 mousedown handler**：`mainBtnRef` + `useEffect + addEventListener` 模式，handler 内必须从 `block.props` 读最新值（不可依赖 mount 时闭包快照）
- **面板内事件阻断**：`panelRef` 原生 mousedown handler + `stopPropagation` + interactive 元素豁免 `preventDefault`
- **`position:fixed` 面板**：`wrapRef.getBoundingClientRect()` 动态定位 + 滚动时关闭面板
- **模块级 ctxRef**：`buttonBlockCtxRef` 对象跨渲染周期暴露 Editor props，Handler 读取前检查 `pageId` 非空
- **toast 通知**：`react-hot-toast` 已在 `api/client.ts` 集成，`<Toaster>` 挂载在 `App.tsx`，`import toast from "react-hot-toast"` 可直接在 `Editor.tsx` 中使用

---

## 三、各评审要点方案

### 3.1 ButtonBlock propSchema 扩展方案

#### rules 字段类型

新增一个 TypeScript 类型联合体定义规则结构：

```ts
type ButtonRule =
  | { type: "create_page"; title: string; parent: "current" | "root" }
  | { type: "append_content"; text: string }
  | { type: "set_page_prop"; prop: "title" | "icon" | "cover"; value: string }
  | { type: "notify"; message: string };
```

`ButtonAction` 枚举扩展为：

```ts
type ButtonAction = "none" | "open_url" | "new_subpage" | "edit_page_props" | "run_rules";
```

#### propSchema 变更

`propSchema` 新增一个字段：

```ts
rules: { default: "[]" },   // JSON 序列化的 ButtonRule[]，默认空数组
```

`rules` 字段存储为 JSON 字符串（`string` 类型），而非对象。这与 `url` 字段的处理方式一致——BlockNote propSchema 的值类型只支持 `string`，不支持数组或对象。序列化为 JSON 字符串是唯一可行方案。

#### 序列化策略

- **保存时**：`commitPanel` 中调用 `JSON.stringify(rulesDraft)` 将 `ButtonRule[]` 序列化为字符串，写入 `block.props.rules`
- **读取时**：初始化 state 时解析 `block.props.rules`（`JSON.parse`），解析失败时降级为 `[]`
- **执行时**：点击主按钮时再次解析 `block.props.rules`，解析失败时弹出错误提示，不执行

解析失败的防御写法：

```ts
function parseRules(raw: string): ButtonRule[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null; // null 表示格式非法，与空数组 [] 区分
  }
}
```

`null` 返回值触发「规则配置格式错误，请重新配置」提示；`[]` 返回值直接静默成功。

#### 有效性校验扩展

现有 action 有效性校验数组须同步更新：

```ts
action = (["none","open_url","new_subpage","edit_page_props","run_rules"] as ButtonAction[]).includes(a) ? a : "none";
```

---

### 3.2 规则列表编辑 UI 组件设计

#### 状态管理

在 ButtonBlock render 函数内新增以下 state：

```ts
const [rulesDraft, setRulesDraft] = React.useState<ButtonRule[]>(() => {
  try {
    const parsed = JSON.parse(block.props.rules ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
});
```

使用函数初始化（lazy initializer）避免每次 render 重复解析。

`commitPanel` 扩展：

```ts
const commitPanel = () => {
  editor.updateBlock(block, {
    props: {
      label: labelDraft, color: colorDraft, bgColor: bgColorDraft,
      action: actionDraft, url: urlDraft,
      rules: JSON.stringify(rulesDraft),
    },
  } as any);
  setPanelOpen(false);
};
```

#### 草稿 vs 已保存

- `rulesDraft`：面板内的未提交状态，存在于组件 state 中
- 已保存：`block.props.rules`（JSON 字符串），由 BlockNote 管理持久化
- 面板关闭时（外部点击触发 `commitPanel`）：草稿写入 `block.props`，不丢失
- 切换 `actionDraft` 离开 `run_rules` 再切回：`rulesDraft` 保持当前 state，不重置——行为与需求文档「已保存规则保留，未保存草稿丢弃」语义一致（因为 props 未提交，切换 action 并不触发 commit，rulesDraft 来自上次 commit 时的 block.props 解析值，已是最后一次保存状态）

**注意**：`rulesDraft` 的初始值在组件 mount 时从 `block.props.rules` 读取，若面板关闭时触发了 `commitPanel`，再次打开时 state 已是已保存值，行为自洽。

#### 面板内交互约束

规则编辑区域嵌入在现有 `button-block-panel` 内，该面板已通过 `panelRef` 原生 mousedown handler 阻断 PM 拦截（见 `docs/knowledge/prosemirror-event-interception.md §场景 2`）。

面板内交互约束：
- 排序按钮（↑↓）、删除按钮、规则类型选择菜单：使用 `onMouseDown={ev => ev.preventDefault()} onClick={...}` 模式——mousedown 仅阻止默认行为，点击逻辑在 `onClick` 中
- 参数输入框（`<input>`）：使用标准 React onChange，无需额外处理（面板已豁免 interactive 元素的 preventDefault）
- 「+ 添加规则」按钮：使用 `onClick`，同上

这是因为面板的 `panelRef` handler 已对 `INPUT/BUTTON/SELECT/TEXTAREA` 跳过 `preventDefault`，react 合成事件可以正常触发。

#### 组件结构

规则编辑区作为面板内的条件渲染块，**不新建独立组件文件**——理由：规则编辑区是设置面板的一个条件分支，与现有面板 state（`rulesDraft`）深度耦合，抽出独立组件需要向下传递大量 setter，增加接口复杂度，100 行以内的 JSX 不必抽离。

```tsx
{actionDraft === "run_rules" && (
  <div className="button-rules-editor">
    {rulesDraft.length === 0 && (
      <div className="button-rules-empty">暂无规则，点击添加</div>
    )}
    {rulesDraft.map((rule, idx) => (
      <div key={idx} className="button-rule-row">
        {/* 规则类型标题 + 排序 + 删除 */}
        {/* 参数输入区 */}
      </div>
    ))}
    <button
      className="button-rules-add"
      disabled={rulesDraft.length >= 10}
      title={rulesDraft.length >= 10 ? "最多 10 条" : undefined}
      onMouseDown={ev => ev.preventDefault()}
      onClick={() => setShowRuleTypeMenu(true)}
    >
      + 添加规则
    </button>
  </div>
)}
```

规则类型选择菜单：额外 state `showRuleTypeMenu`，点击后展示 4 个类型按钮（inline，不用 PanelSelect）。选择后追加到 `rulesDraft`，菜单关闭。

---

### 3.3 执行逻辑与现有 mainBtnRef mousedown handler 的整合方案

#### 整合位置

在现有 `mainBtnRef` effect 的 handler 中新增 `run_rules` 分支：

```ts
} else if (currentAction === "run_rules") {
  const ctxRef = buttonBlockCtxRef;
  if (!ctxRef.pageId) {
    alert("页面未就绪，请稍后重试");
    return;
  }
  const rawRules = block.props.rules as string ?? "[]";
  const rules = parseRules(rawRules);
  if (rules === null) {
    alert("规则配置格式错误，请重新配置");
    return;
  }
  if (rules.length === 0) return;
  void executeRules(rules, ctxRef, editor, e.currentTarget as HTMLButtonElement);
}
```

handler 本身保持同步轻量，异步执行逻辑提取为模块级函数 `executeRules`（见下节）。

#### 按钮禁用防重

`executeRules` 入参接收 `HTMLButtonElement`，执行期间直接操作 DOM：

```ts
async function executeRules(
  rules: ButtonRule[],
  ctxRef: typeof buttonBlockCtxRef,
  editor: BlockNoteEditor<typeof schema>,
  btn: HTMLButtonElement,
): Promise<void> {
  btn.disabled = true;
  try {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      try {
        await executeSingleRule(rule, ctxRef, editor);
      } catch (err) {
        const ruleNames: Record<ButtonRule["type"], string> = {
          create_page: "创建页面", append_content: "追加内容",
          set_page_prop: "修改页面属性", notify: "发送通知",
        };
        toast.error(`规则 ${i + 1}（${ruleNames[rule.type]}）执行失败：${(err as Error).message}`);
        return;
      }
    }
    // 全部成功，静默
  } finally {
    btn.disabled = false;
  }
}
```

直接操作 `btn.disabled` 而非走 React state 的原因：`mainBtnRef` handler 在 mount 时注册一次，与 React 渲染周期解耦，通过 `block.props` 访问最新数据。若改用 React state `isExecuting`，需要在 mount 时注册的 handler 里 setState，且 setState 是异步的，不能可靠地防止瞬时双击。直接操作 DOM 属性是这里唯一可靠的方式。

#### 各规则类型执行函数

```ts
async function executeSingleRule(
  rule: ButtonRule,
  ctxRef: typeof buttonBlockCtxRef,
  editor: BlockNoteEditor<typeof schema>,
): Promise<void> {
  switch (rule.type) {
    case "create_page": {
      const parentId = rule.parent === "current" ? ctxRef.pageId : null;
      await api.pages.create({ parent_id: parentId, title: rule.title || "Untitled", order_index: 9999 });
      break;
    }
    case "append_content": {
      const resolved = resolveVariables(rule.text, ctxRef);
      insertOrUpdateBlock(editor, { type: "paragraph", content: [{ type: "text", text: resolved, styles: {} }] } as any);
      break;
    }
    case "set_page_prop": {
      const resolved = resolveVariables(rule.value, ctxRef);
      await api.pages.update(ctxRef.pageId, { [rule.prop]: resolved });
      break;
    }
    case "notify": {
      const resolved = resolveVariables(rule.message, ctxRef);
      toast(resolved);
      break;
    }
  }
}
```

`notify` 规则使用 `toast()`（默认 toast，非 error），已可用，无需额外引入。

**`append_content` 的 `insertOrUpdateBlock` 行为说明**：BlockNote 的 `insertOrUpdateBlock` 会将块插入到当前选中块之后，而非文档末尾。需求文档要求「追加到文档末尾」。实现时须先通过 `editor.document` 找到最后一个块，再调用 `editor.insertBlocks([newBlock], lastBlock, "after")`，而非直接用 `insertOrUpdateBlock`。

---

### 3.4 变量占位符替换工具函数设计

#### 位置

`resolveVariables` 定义为 `Editor.tsx` 模块级函数（不新建文件），放在 `ButtonBlock` 定义之前、`buttonBlockCtxRef` 之后。理由：该函数只被 `executeSingleRule` 调用，绑定 noteyard 业务（`ctxRef` 结构），无跨项目通用价值，不值得提取到 `utils/`。

#### 接口

```ts
function resolveVariables(
  template: string,
  ctxRef: { pageId: string; pageTitle?: string },
): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 5);  // HH:mm
  return template
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{page_title\}\}/g, ctxRef.pageTitle ?? "");
}
```

#### ctxRef 扩展

`buttonBlockCtxRef` 须新增 `pageTitle` 字段：

```ts
const buttonBlockCtxRef: {
  pageId: string;
  pageTitle: string;
  onSelectPage: ((id: string) => void) | undefined;
} = { pageId: "", pageTitle: "", onSelectPage: undefined };
```

`Editor` useEffect 同步扩展：

```ts
useEffect(() => {
  buttonBlockCtxRef.pageId = pageId;
  buttonBlockCtxRef.pageTitle = pageMeta?.title ?? "";
  buttonBlockCtxRef.onSelectPage = onSelectPage;
}, [pageId, pageMeta, onSelectPage]);
```

**注意**：`Editor` 组件的 Props 中目前无 `pageMeta`——需确认 `Editor` 是否已接收 `pageMeta`，或通过其他方式获取页面标题。查看 `App.tsx` 调用 `<Editor>` 的方式：若 `pageMeta` 未传入，`pageTitle` 降级为空字符串，符合需求文档「`{{page_title}}` 无法取到时替换为空字符串」的规定，可接受。工程师实现时按需决定是否传入 `pageMeta`。

未知占位符保持原样（`replace` 只替换已知模式，无需额外处理）。

---

### 3.5 风险识别

#### 风险 1：面板内规则编辑区的 select/dropdown 交互

规则类型选择菜单（`<select>` 或自定义 dropdown）嵌套在 `button-block-panel` 面板内。面板已通过原生 mousedown handler 阻断 PM（场景 2）。若用 `<select>` 原生元素，其 `onChange` 是 React 合成事件，依赖 change 事件（不受 mousedown 拦截），可正常使用。若用自定义 dropdown（div 列表），点选项时须用 `onClick` 不用 `onMouseDown`，否则因面板 stopPropagation 失效（详见 `docs/knowledge/prosemirror-event-interception.md §场景 2`）。**推荐使用现有 `PanelSelect` 组件**（已解决 ISS-044 交互问题），复用已验证方案。

#### 风险 2：`append_content` 末尾插入位置

`insertOrUpdateBlock` 的默认行为是在当前聚焦块之后插入，而非文档末尾。使用错误 API 会导致内容插入在光标位置而非文档末尾，不符合需求。必须使用 `editor.insertBlocks([block], lastBlock, "after")`，其中 `lastBlock = editor.document[editor.document.length - 1]`。工程师实现时须特别注意这一点。

#### 风险 3：`executeRules` 模块级函数需要 `editor` 引用

`executeRules` 和 `executeSingleRule` 为模块级函数，需接收 `editor`（`BlockNoteEditor` 类型）作为参数。`editor` 由 `useCreateBlockNote` 返回，存在于 ButtonBlock render 函数作用域内。通过参数传递是干净的方式，不需要额外 ref。

#### 风险 4：`toast` 在 Editor.tsx 的引入

`Editor.tsx` 当前未 import `toast`，需新增 `import toast from "react-hot-toast"`。`<Toaster>` 已在 `App.tsx` 挂载，Editor 内直接 import toast 函数即可调用，无需额外配置。

#### 风险 5：规则 state 初始化的闭包陷阱

`rulesDraft` 使用 lazy initializer `React.useState(() => parseRules(...))` 初始化，但 `block.props.rules` 在 mount 后可能因外部更新（极少见）而变化。与现有 `labelDraft`/`colorDraft` 的处理一致：面板重新打开时，state 已经是上次 commit 后的值（commitPanel 写入 props 后面板关闭，再开时 state 维持最后 commit 值）——这与需求文档「重新打开设置面板时从已保存 props 解析并回填」有差异。正确做法：在面板打开的 effect 中同步 `rulesDraft`：

```ts
React.useEffect(() => {
  if (panelOpen) {
    try {
      const parsed = JSON.parse(block.props.rules ?? "[]");
      setRulesDraft(Array.isArray(parsed) ? parsed : []);
    } catch { setRulesDraft([]); }
  }
}, [panelOpen]);
```

这保证每次打开面板时从已保存的 props 回填，与现有 label/color/action 的 state 回填行为对齐（均在面板关闭时通过 commitPanel 写入，再开时 state 已对齐——实际上此处也需要对齐，因为外部如通过快捷方式改了 block.props，不走面板的 rulesDraft）。**工程师实现时须在 `panelOpen` effect 中同步 rulesDraft**。

#### 风险 6：TypeScript 类型安全

`propSchema` 中 `rules` 字段是 `string` 类型，`block.props.rules` 的类型为 `string`，解析后是 `ButtonRule[]`。`ButtonRule` 是联合类型，解析后须做运行时类型校验（或至少基于 `type` 字段 switch）。在 `executeSingleRule` 中使用 `switch(rule.type)` 可覆盖 TypeScript 的穷举检查。`rule.type` 未知时 switch 无 default 分支会被 TypeScript 标记为 unreachable（联合类型已穷举），安全。

---

### 3.6 回归影响分析

| 区域 | 影响评估 |
|------|---------|
| 现有按钮块（`action=none/open_url/new_subpage/edit_page_props`） | `rules` 字段默认 `"[]"`，执行时 `action !== "run_rules"` 分支不进入规则逻辑；现有 4 种动作行为完全不变 |
| 主按钮 mousedown handler | 新增 `run_rules` 分支，现有 4 个分支代码不动，无影响 |
| `commitPanel` | 新增 `rules: JSON.stringify(rulesDraft)` 字段，其他字段不变；旧数据 `rules` 字段为 undefined 时 BlockNote 使用 propSchema 默认值 `"[]"`，向后兼容 |
| 序列化 / buildDtosRecursive | button 分支已是 `JSON.stringify(b.props)`，`rules` 字段自动序列化，无需修改 |
| `buttonBlockCtxRef` 扩展（新增 `pageTitle`） | 仅新增字段，现有读 `pageId` / `onSelectPage` 的代码不受影响 |
| `ButtonAction` 枚举扩展 | 有效性校验数组须同步，否则 `"run_rules"` 会 fallback 到 `"none"`（见 §3.1）；`actionDraft` state 类型须更新 |
| 设置面板 PanelSelect options | 新增 `{ value: "run_rules", label: "运行规则" }` 选项，其他选项不变 |
| tsc 检查 | `ButtonRule` 联合类型须完整声明；`rules` 字段写入 `editor.updateBlock` 时继续使用现有 `as any` 断言；`executeSingleRule` switch 须覆盖所有 `ButtonRule["type"]` 值，TypeScript 穷举检查自动捕获遗漏 |

需回归验证的现有功能：
1. `action=open_url`：点击主按钮是否仍正常打开链接
2. `action=new_subpage`：点击主按钮是否仍创建子页面并跳转
3. `action=edit_page_props`：点击主按钮是否仍打开属性面板
4. `action=none`：点击主按钮无响应（无报错）
5. 设置面板打开/关闭/commitPanel 行为（因 commitPanel 函数有修改）
6. 按钮块保存后刷新页面，所有字段（含 `rules`）正确回填

---

### 3.7 任务拆分建议

| # | 角色 | 任务 | 前置 | 验收要点 |
|---|------|------|------|---------|
| T1 | 前端工程师 | FR-1+FR-2：`ButtonAction` 枚举扩展（`run_rules`）；`ButtonRule` 联合类型定义；`propSchema` 新增 `rules` 字段；`buttonBlockCtxRef` 新增 `pageTitle`；`resolveVariables` 工具函数；`parseRules` 解析函数；`executeRules`/`executeSingleRule` 模块级函数（含 toast 错误提示、btn.disabled 防重） | — | `tsc --noEmit` 零错误；类型定义完整；各函数签名符合本文档 §3.3/3.4 |
| T2 | 前端工程师 | FR-3：规则列表编辑 UI（`rulesDraft` state；`panelOpen` effect 回填；添加/删除/排序；参数输入区；10 条上限禁用；`commitPanel` 扩展写入 `rules`）；CSS 规则编辑区样式 | T1 | 规则 CRUD 正确；10 条上限生效；props 持久化；刷新回填；切换 action 行为符合需求 |
| T3 | 前端工程师 | FR-4+FR-5：`mainBtnRef` handler 新增 `run_rules` 分支；`ctxRef.pageTitle` 同步（Editor useEffect 扩展）；变量替换正确触发；`append_content` 使用 `editor.insertBlocks` 追加末尾；所有规则类型按预期执行 | T1 T2 | 各规则类型执行正确；失败场景 toast 提示正确；防重生效；变量替换正确 |
| T4 | 前端测试 | 验收 T1–T3：REQ-084 场景矩阵全覆盖；回归 §3.6 列出的现有功能；`tsc --noEmit` 零错误 | T3 | 全部验收标准通过 |

**实现边界说明**：
- T1 不包含 UI，只写数据结构和纯函数
- T2 只写面板 UI 和持久化，不包含执行逻辑（执行逻辑在 T3）
- T3 扩展 handler，依赖 T1 的函数和 T2 的 commitPanel（须 T2 已写入 `rules` prop，否则执行时读到空数组）
- T1/T2/T3 顺序依赖，不可并行

---

## 四、接口契约

### 4.1 ButtonBlock propSchema（修改后完整版）

```ts
propSchema: {
  label:   { default: "点击" },         // string
  color:   { default: "default" },      // ButtonColor
  bgColor: { default: "default" },      // ButtonBgColor
  action:  { default: "none" },         // ButtonAction（扩展含 run_rules）
  url:     { default: "" },             // string（仅 action=open_url 时有效）
  rules:   { default: "[]" },           // JSON string of ButtonRule[]（新增）
}
```

### 4.2 新增类型

```ts
type ButtonAction = "none" | "open_url" | "new_subpage" | "edit_page_props" | "run_rules";

type ButtonRule =
  | { type: "create_page"; title: string; parent: "current" | "root" }
  | { type: "append_content"; text: string }
  | { type: "set_page_prop"; prop: "title" | "icon" | "cover"; value: string }
  | { type: "notify"; message: string };
```

### 4.3 新增工具函数接口

| 函数 | 签名 | 位置 |
|------|------|------|
| `parseRules` | `(raw: string) => ButtonRule[] \| null` | `Editor.tsx` 模块级 |
| `resolveVariables` | `(template: string, ctxRef: { pageTitle: string }) => string` | `Editor.tsx` 模块级 |
| `executeRules` | `(rules: ButtonRule[], ctxRef, editor, btn: HTMLButtonElement) => Promise<void>` | `Editor.tsx` 模块级 |
| `executeSingleRule` | `(rule: ButtonRule, ctxRef, editor) => Promise<void>` | `Editor.tsx` 模块级 |

### 4.4 buttonBlockCtxRef 扩展后完整版

```ts
const buttonBlockCtxRef: {
  pageId: string;
  pageTitle: string;
  onSelectPage: ((id: string) => void) | undefined;
} = { pageId: "", pageTitle: "", onSelectPage: undefined };
```

### 4.5 API 调用（新增部分）

| 规则类型 | 调用 |
|---------|------|
| `create_page`（parent=current） | `api.pages.create({ parent_id: ctxRef.pageId, title, order_index: 9999 })` |
| `create_page`（parent=root） | `api.pages.create({ parent_id: null, title, order_index: 9999 })` |
| `append_content` | `editor.insertBlocks([{ type: "paragraph", content: [{type:"text", text:resolved, styles:{}}] }], lastBlock, "after")` |
| `set_page_prop` | `api.pages.update(ctxRef.pageId, { [rule.prop]: resolved })` |
| `notify` | `toast(resolved)` |

以上 API 均已存在，无需新增后端接口。

---

## 五、改动文件总览

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `web/src/components/editor/Editor.tsx` | 修改 | `ButtonAction` 枚举扩展；`ButtonRule` 类型新增；`propSchema` 新增 `rules`；`buttonBlockCtxRef` 新增 `pageTitle`；`parseRules`/`resolveVariables`/`executeRules`/`executeSingleRule` 模块级函数；`mainBtnRef` handler 新增 `run_rules` 分支；Editor useEffect 同步 `pageTitle`；规则编辑 UI（`rulesDraft` state、面板条件渲染）；`commitPanel` 扩展；`panelOpen` effect 回填 `rulesDraft`；`import toast` |
| `web/src/components/editor/Editor.css` | 修改 | 规则编辑区样式（`.button-rules-editor`、`.button-rule-row`、`.button-rules-empty`、`.button-rules-add`） |

**不涉及**：后端代码、`api/client.ts`、其他组件文件、路由、数据库 schema。

---

*前端架构师（arch-frontend）生成，DISPATCH #222，2026-05-05。*
