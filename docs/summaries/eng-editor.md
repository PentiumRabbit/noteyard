# eng-editor 摘要

| 字段 | 内容 |
|------|------|
| 角色 | 前端工程师（eng） |
| 模块 | editor（`web/src/components/editor/`） |
| 最后更新 | 2026-05-07（REQ-087 T4） |
| 对应需求 | REQ-083 T1/T2/T3/T4, ISS-045, ISS-046, REQ-084 T1/T2/T3, REQ-086 T1/T2/T3, REQ-087 T1/T2/T3/T4 |

---

## 模块边界

- 负责：BlockNote 编辑器自定义块定义（`ButtonBlock` 等）、相关 CSS 样式、拖拽引擎（`dropOverlayPlugin.ts`）
- 不负责：后端接口、`api/client.ts`、`App.tsx` 级别状态、其他组件文件

## REQ-084 新增结构概览

`ButtonBlock` 在 REQ-084 T1/T2 新增了规则引擎数据结构、执行函数和编辑 UI：
- `ButtonAction` 枚举增加 `run_rules`；`ButtonRule` 联合类型（4种规则）定义在 `Editor.tsx` 模块顶层
- `propSchema` 新增 `rules` 字段（JSON 序列化的 `ButtonRule[]`，默认 `"[]"`）
- `buttonBlockCtxRef` 新增 `pageTitle` 字段，用于变量替换
- 新增 4 个模块级函数：`parseRules`（解析/校验规则串）、`resolveVariables`（占位符替换）、`executeSingleRule`（单条规则执行）、`executeRules`（顺序执行 + btn 防重）
- `append_content` 规则使用 `editor.insertBlocks([block], lastBlock, "after")` 追加至文档末尾（非 `insertOrUpdateBlock`）
- 执行期间通过 `btn.disabled` 直接操作 DOM 防重，不走 React state（与 mainBtnRef handler 渲染周期解耦）
- T2 新增：`rulesDraft` state（lazy init）+ `panelOpen` effect 回填 + `commitPanel` 写入 rules + 规则编辑区 JSX（4种类型、CRUD、10条上限）+ CSS 样式

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

## 变更记录（REQ-084 T1，2026-05-05，dispatch #223）

- `Editor.tsx`：`ButtonAction` 枚举扩展含 `"run_rules"`；新增 `ButtonRule` 联合类型（4种）；`propSchema` 新增 `rules`（default: `"[]"`）；`buttonBlockCtxRef` 新增 `pageTitle`（初始值空字符串）；新增模块级函数 `parseRules` / `resolveVariables` / `executeSingleRule` / `executeRules`；顶部新增 `import toast from "react-hot-toast"`；action 有效性校验数组同步扩展含 `"run_rules"`
- `tsc --noEmit` 零错误，不含 UI 改动，不修改 mainBtnRef handler

## 变更记录（REQ-084 T2，2026-05-05，dispatch #224）

- `Editor.tsx`：ButtonBlock 新增 `rulesDraft` state（lazy init）和 `showRuleTypeMenu` state；`panelOpen` effect 回填 rulesDraft + reset showRuleTypeMenu；`commitPanel` 写入 `rules: JSON.stringify(rulesDraft)`；PanelSelect 新增「运行规则」选项；新增规则编辑区 JSX（`actionDraft=run_rules` 条件渲染，支持 4 种规则类型 CRUD + 参数输入 + 10 条上限禁用）；document mousedown effect 依赖数组新增 rulesDraft
- `Editor.css`：新增规则编辑区全套样式（`.button-rules-editor`、`.button-rule-row`、`.button-rule-header`、`.button-rule-params`、`.button-rules-add`、`.button-rule-type-menu` 等）
- `tsc --noEmit` 零错误，不含执行逻辑（mainBtnRef handler 的 run_rules 分支在 T3 实现）

## 变更记录（REQ-084 T3，2026-05-05，dispatch #225）

- `Editor.tsx`：`mainBtnRef` handler 新增 `run_rules` 分支（pageId 守卫 + parseRules 校验 + void executeRules 调用）；Editor useEffect 新增 `buttonBlockCtxRef.pageTitle = ""` 同步（降级处理：pageMeta 不在 Props 中，pageTitle 固定为空字符串）
- `tsc --noEmit` 零错误；现有 open_url / new_subpage / edit_page_props / none 行为不变

## 变更记录（REQ-083 T4 / FR-4，2026-05-05，dispatch #216）

- `Editor.tsx`：新增 `EMOJI_COMMON` 常量（inline 30项）；新增 `PagePropsPanel` 内联组件（api.pages.get 回填 + 图标/封面/标题编辑 + 外部点击/Escape/scroll 关闭）；ButtonBlock render 新增 `pagePropsPanelOpen`/`pagePropsPanelAnchorRect` state；`mainBtnRef` handler 新增 `edit_page_props` 分支（关闭设置面板 + 锚点坐标 + 打开属性面板）；设置面板动作下拉新增「编辑页面属性」选项
- `Editor.css`：新增 `.page-props-panel`、`.page-props-panel-section`、`.page-props-panel-label`、`.page-props-emoji-grid`、`.page-props-emoji-btn`、`.page-props-cover-*`、`.page-props-title-input` 样式
- `tsc --noEmit` 零错误

## 变更记录（REQ-086 T1，2026-05-07，dispatch #247）

- `dropOverlayPlugin.ts`：`DropOverlayView` 新增 pointer events 状态（`isDragging`/`sourceBlockEl`/`sourceBlockPos`/`ghostEl`/`pointerId`/`rafId`）；新增 pointerdown 处理（drag handle 检测、blockOuter 定位、ghost 克隆创建、opacity 0.3、setPointerCapture try/catch、userSelect=none）；新增 pointermove rAF 节流框架（ghost 坐标跟随，T2 在此添加让位计算）；新增 pointerup（isDragging 保护、console.log 占位 T3 事务）和 pointercancel（不提交事务）处理；`cleanupDrag()` 统一清理 ghost/opacity/userSelect/状态；`destroy()` 移除新增监听器并清理进行中的拖拽
- HTML5 drag 路径（ISS-048 handleMultiColumnDrop / lastDragoverSide / dragover/dragleave/drop/dragend 监听）全量保留，零修改
- `tsc --noEmit` 零错误

## 变更记录（REQ-086 T2，2026-05-07，dispatch #248）

- `dropOverlayPlugin.ts`：新增 `dropLineEl`/`currentTargetPos`/`currentPlacement` 状态；pointermove rAF 回调实现命中目标块计算（复用 `getBlockPosFromPoint`）、上/下半区判断（placement before/after）、批量读取所有 blockOuter rects 后批量写 translateY（± sourceBlockHeight，150ms ease 过渡），以及 `.bn-drop-line` 元素实时跟随目标块上/下边缘；新增 `_clearYieldTransforms()` / `_hideDropLine()` 辅助方法；`cleanupDrag()` 补充清除所有 blockOuter transform/transition 及移除 dropLineEl
- `Editor.css`：新增 `.bn-drag-ghost`（position: fixed, pointer-events: none, opacity: 0.6, z-index: 100）和 `.bn-drop-line`（position: fixed, height: 2px, background: rgba(59,130,246,0.9), z-index: 100）样式
- `tsc --noEmit` 零错误；handleMultiColumnDrop 零修改

## 变更记录（REQ-086 T3，2026-05-07，dispatch #249）

- `dropOverlayPlugin.ts`：提取 `findBlockById` 为模块级共享函数（原位于 `handleMultiColumnDrop` 内部）；`DropOverlayView` 构造函数新增 `editor` 参数；`onPointerUp` 替换 console.log 占位为实际事务提交——在 `cleanupDrag()` 之前捕获 `currentTargetPos`/`currentPlacement`/`sourceBlockPos`，清理视觉状态后通过 `getNearestBlockPos`+`getBlockInfo`+`nodeToBlock` 解析 targetBlock，通过文档位置解析 sourceBlock，调用 `editor.removeBlocks([sourceBlock])` + `editor.insertBlocks([sourceBlock], targetBlock, placement)`，try/catch 包裹（失败时视觉已清理，不崩溃）；`isDragging` 保护确保幂等；`onPointerCancel` 只执行 `cleanupDrag()`，不提交事务（T1 已实现，T3 验证无变化）；`destroy()` 全量清理验证完整（4个 pointer 监听器均在 destroy 中移除，`cleanupDrag` 覆盖 ghost/dropLine/transform/opacity/userSelect）
- `tsc --noEmit` 零错误；handleMultiColumnDrop 零修改

## 变更记录（REQ-087 T1，2026-05-07，dispatch #256）

- `dropOverlayPlugin.ts`：`DropOverlayView` 新增 `onKeyDownBound` 属性；构造函数中注册 `document.addEventListener("keydown", ...)` 监听 Escape 键，按下且 `isDragging` 时调用 `cleanupDrag()` 取消拖拽（ghost/遮罩/挤压变换/落点线/userSelect 全部清除，块回原位，不提交事务）；`destroy()` 中通过 `document.removeEventListener("keydown", ...)` 正确移除监听器，无泄漏
- `tsc --noEmit` 零错误

## 变更记录（REQ-087 T3，2026-05-07，dispatch #258）

- `dropOverlayPlugin.ts`：`onPointerUp` 中新增 columnList 目标提升逻辑——在 `cleanupDrag()` 之后、目标块解析之前，通过 `state.doc.resolve(targetPos)` 检测目标是否在 column 内部（`parent.type.name === "column"`），若是则将 `targetPos` 提升到 columnList 位置（`resolved.before(depth - 1)`），确保 `insertBlocks` 将拖拽块插入到 columnList 同级而非 column 内部
- `tsc --noEmit` 零错误；非 column 场景拖拽排序行为不变

## 变更记录（REQ-087 T4，2026-05-07，dispatch #259）

- `dropOverlayPlugin.ts`：扩展 `onPointerMove` 中源块 `data-id` 重查找范围至 `allBlockOuters`（原仅 `topLevelBlockOuters`）。当源块在 column 内部时，在 `allBlockOuters` 中找到后通过 `getBlockPosFromPoint` 重新解析 `sourceBlockPos`；同时将提前 return 条件从 `sourceIdx === -1` 改为 `!this.sourceBlockEl`，确保 column 内部源块能继续参与拖拽逻辑
- `tsc --noEmit` 零错误；非 column 场景拖拽排序行为不变
