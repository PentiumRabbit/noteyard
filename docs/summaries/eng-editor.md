# eng-editor 摘要

| 字段 | 内容 |
|------|------|
| 角色 | 前端工程师（eng） |
| 模块 | editor（`web/src/components/editor/`） |
| 最后更新 | 2026-05-05 |
| 对应需求 | REQ-083 T1 / ISS-043 |

---

## 模块边界

- 负责：BlockNote 编辑器自定义块定义（`ButtonBlock` 等）和相关 CSS 样式
- 不负责：后端接口、`api/client.ts`、`App.tsx` 级别状态、其他组件文件

## 核心数据流

`ButtonBlock` 是 BlockNote atom 节点（`content: "none"`），主按钮点击事件通过原生 `addEventListener("mousedown")` 注册在 `mainBtnRef` 上，绕过 ProseMirror 的事件拦截；handler 内直接读 `block.props` 获取最新 `action`/`url`，避免闭包快照过期。

## 关键约束

- atom 节点的交互事件必须用原生 `addEventListener("mousedown")` + `e.stopPropagation()`，不可用 React 合成 `onClick`（ISS-043 根因）
- mousedown handler 内须读 `block.props.action`/`block.props.url`，不可读 render 时的闭包变量（闭包快照在 mount 后不更新）
- URL 合法性校验复用 `isSafeUrl`（`web/src/utils/urlUtils.ts`），已在 Editor.tsx L39 import

## 关键文件路径

| 文件 | 职责 |
|------|------|
| `web/src/components/editor/Editor.tsx` | ButtonBlock 定义（含 mainBtnRef effect） |
| `web/src/utils/urlUtils.ts` | isSafeUrl 工具函数 |

## 变更记录（REQ-083 T1 / ISS-043，2026-05-05，dispatch #213）

- `Editor.tsx`：新增 `mainBtnRef`（`useRef<HTMLButtonElement>`）及原生 mousedown effect；删除 `handleClick`；主按钮 JSX 移除 `onClick`，添加 `ref={mainBtnRef}`
- `tsc --noEmit` 零错误，向后兼容（action=none 无副作用，设置面板行为不变）
