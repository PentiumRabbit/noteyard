# eng-editor 摘要

| 字段 | 内容 |
|------|------|
| 角色 | 前端工程师（eng） |
| 模块 | editor（`web/src/components/editor/`） |
| 最后更新 | 2026-05-05 |
| 对应需求 | REQ-083 T1/T2/T3/T4, ISS-045, ISS-046 |

---

## 模块边界

- 负责：BlockNote 编辑器自定义块定义（`ButtonBlock` 等）和相关 CSS 样式
- 不负责：后端接口、`api/client.ts`、`App.tsx` 级别状态、其他组件文件

## 核心数据流

`ButtonBlock` 是 BlockNote atom 节点（`content: "none"`），主按钮点击事件通过原生 `addEventListener("mousedown")` 注册在 `mainBtnRef` 上，绕过 ProseMirror 的事件拦截；handler 内直接读 `block.props` 获取最新 `action`/`url`/`bgColor`，避免闭包快照过期。

背景色（`bgColor`）通过 `propSchema` 持久化到 `block.props`，经 `buildDtosRecursive` 的 `button` 分支序列化为 JSON 写入后端，无需修改序列化逻辑。

`new_subpage` / `edit_page_props` 动作需要 Editor 组件的 `pageId` / `onSelectPage` prop，通过模块级 `buttonBlockCtxRef` 对象传递（ButtonBlock 定义在 Editor 组件外，无法直接接收 props）；Editor 组件通过 `useEffect` 在每次 `pageId`/`onSelectPage` 变化时同步该对象。

## 关键约束

- atom 节点的交互事件必须用原生 `addEventListener("mousedown")` + `e.stopPropagation()`，不可用 React 合成 `onClick`（ISS-043 根因）
- mousedown handler 内须读 `block.props.*`，不可读 render 时的闭包变量（闭包快照在 mount 后不更新）
- URL 合法性校验复用 `isSafeUrl`（`web/src/utils/urlUtils.ts`），已在 Editor.tsx 顶部 import
- `new_subpage` handler 入口须检查 `buttonBlockCtxRef.pageId` 非空，为空则 `console.warn` 并 return（防御 HMR 等边界场景）
- `.button-block-btn.bg-*:hover` 规则须在 `.button-block-btn:hover` 之后定义，才能覆盖通用 hover 背景色（CSS specificity 相等，后定义优先）
- `PagePropsPanel` 标题更新通过 `CustomEvent("page-props-updated")` 通知 App 层，不直接修改 App state
- 面板内原生 mousedown handler 调用 stopPropagation() 会阻断事件到达 React root，导致面板内所有子组件的 React 合成 onMouseDown 失效；面板内交互组件若需响应点击，须改用 onClick（click 事件不受 mousedown 拦截影响，ISS-044 根因）

## 关键文件路径

| 文件 | 职责 |
|------|------|
| `web/src/components/editor/Editor.tsx` | ButtonBlock 定义（含 mainBtnRef effect、buttonBlockCtxRef、PagePropsPanel、ctxRef sync useEffect） |
| `web/src/components/editor/Editor.css` | ButtonBlock 背景色变体（.bg-*）、PagePropsPanel 面板样式 |
| `web/src/utils/urlUtils.ts` | isSafeUrl 工具函数 |

## 变更记录（ISS-045/ISS-046，2026-05-05，dispatch #220）

- `Editor.tsx`：设置面板「确认」按钮从 `onMouseDown` 改为 `onClick`，解决 ISS-045（commitPanel 未执行、面板未关闭）；ISS-046（action=new_subpage 主按钮无响应）根因为 ISS-045 导致动作无法保存，ISS-045 修复后 new_subpage 分支正常执行
- `tsc --noEmit` 零错误，向后兼容（其他面板功能和主按钮 action 类型不受影响）

## 变更记录（ISS-044，2026-05-05，dispatch #219）

- `web/src/components/common/CustomSelect.tsx`：选项 div 的 `onMouseDown` 仅保留 `e.preventDefault()`（防焦点抢占），选值逻辑从 `onMouseDown` 移至 `onClick`，解决动作下拉在 ProseMirror 面板内无响应问题
- `tsc --noEmit` 零错误，向后兼容（其他 CustomSelect 使用场景行为不变）

## 变更记录（REQ-083 T1 / ISS-043，2026-05-05，dispatch #213）

- `Editor.tsx`：新增 `mainBtnRef`（`useRef<HTMLButtonElement>`）及原生 mousedown effect；删除 `handleClick`；主按钮 JSX 移除 `onClick`，添加 `ref={mainBtnRef}`
- `tsc --noEmit` 零错误，向后兼容（action=none 无副作用，设置面板行为不变）

## 变更记录（REQ-083 T2 / FR-1，2026-05-05，dispatch #214）

- `Editor.tsx`：新增 `ButtonBgColor` 类型 + `BUTTON_BG_COLORS` 常量（10种背景色含 hoverHex）；propSchema 新增 `bgColor`（default: "default"）；render 层新增 `bgColor` 解析 + `bgColorDraft` state；`commitPanel` 写入 `bgColor: bgColorDraft`；主按钮 className 追加 `bg-${bgColor}`；设置面板新增「背景色」区块（10色 swatch 点选）
- `Editor.css`：新增 `.button-block-btn.bg-*` 背景色变体（亮色 + hover 覆盖）和 `.dark .button-block-btn.bg-*`（暗色 + hover 覆盖）
- `tsc --noEmit` 零错误，`bgColor=default` 向后兼容

## 变更记录（REQ-083 T3 / FR-3，2026-05-05，dispatch #215）

- `Editor.tsx`：`ButtonAction` 类型扩展为包含 `"new_subpage"` / `"edit_page_props"`；新增模块级 `buttonBlockCtxRef`；Editor 组件新增 `useEffect` 同步 ctxRef；`mainBtnRef` handler 新增 `new_subpage` 分支（pageId 守卫 + create + insertOrUpdateBlock + onSelectPage）；设置面板动作下拉新增「新建子页面」选项；action 有效性校验数组同步扩展
- `tsc --noEmit` 零错误

## 变更记录（REQ-083 T4 / FR-4，2026-05-05，dispatch #216）

- `Editor.tsx`：新增 `EMOJI_COMMON` 常量（inline 30项）；新增 `PagePropsPanel` 内联组件（api.pages.get 回填 + 图标/封面/标题编辑 + 外部点击/Escape/scroll 关闭）；ButtonBlock render 新增 `pagePropsPanelOpen`/`pagePropsPanelAnchorRect` state；`mainBtnRef` handler 新增 `edit_page_props` 分支（关闭设置面板 + 锚点坐标 + 打开属性面板）；设置面板动作下拉新增「编辑页面属性」选项
- `Editor.css`：新增 `.page-props-panel`、`.page-props-panel-section`、`.page-props-panel-label`、`.page-props-emoji-grid`、`.page-props-emoji-btn`、`.page-props-cover-*`、`.page-props-title-input` 样式
- `tsc --noEmit` 零错误
