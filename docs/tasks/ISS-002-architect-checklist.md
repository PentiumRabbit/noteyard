# 交付记录

状态: 📬 已交付
交付时间: 2026-05-01 当日
交付物:
  - docs/tasks/ISS-002-architect-checklist.md（含根因分析和修复方案）
摘要: ColumnsBlock render props 误用 `updateBlock`（BlockNote 未提供）+ ColumnCell mini-editor schema 仅含 defaultBlockSpecs
验收结果: ✅ 通过
验收时间: 2026-05-01

---

## 根因分析

### 崩溃根因

**直接错误："Cannot read properties of undefined (reading 'type')"**

触发路径：

1. **文件**：`web/src/components/editor/Editor.tsx`，第 239 行  
   `render: ({ block, updateBlock }) => { ... }`

   BlockNote `createReactBlockSpec` 的 render 回调签名为  
   `{ block, editor, contentRef }`（见 `@blocknote/react/types/src/schema/ReactBlockSpec.d.ts` 第 3–6 行）。  
   `updateBlock` **不在接口内**，因此运行时值为 `undefined`。

2. **文件**：`web/src/components/editor/Editor.tsx`，第 254 行  
   `updateBlock({ props: { ...block.props, columnsData: JSON.stringify(next) } } as any)`  
   当 ColumnCell 的 `onSave` 触发 `saveColBlocks` → `saveWidths` 时，调用 `undefined(...)` 抛出  
   `TypeError: updateBlock is not a function`。

3. 该 TypeError 导致 React 渲染中断。在错误边界或 React 重新渲染时，  
   `@blocknote/react/src/schema/ReactBlockSpec.tsx` 第 161 行的 `getBlockFromPos` 可能返回 `undefined`（Prosemirror 状态尚未稳定时，`resolve(pos).node()` 可能返回没有 `id` 属性的节点），  
   使 `block` 为 `undefined`，随后第 180 行  
   `blockType={block.type}`  
   抛出 **"Cannot read properties of undefined (reading 'type')"**（报告中看到的具体错误）。

**精确定位**：
| 位置 | 代码 | 问题 |
|------|------|------|
| `Editor.tsx:239` | `render: ({ block, updateBlock })` | `updateBlock` 不属于 BlockNote render props |
| `Editor.tsx:254` | `updateBlock({ props: ... })` | 调用 `undefined` 函数 |
| `ReactBlockSpec.tsx:180` | `blockType={block.type}` | `block` 为 `undefined` 时崩溃 |

---

### 子块限制根因

**文件**：`web/src/components/editor/Editor.tsx`，第 343 行

```typescript
const editor = useCreateBlockNote({
  schema: BlockNoteSchema.create({ blockSpecs: defaultBlockSpecs }) as any
});
```

ColumnCell 的 mini-editor **只注册了 `defaultBlockSpecs`**，包含：  
paragraph / heading / codeBlock / bulletListItem / numberedListItem / checkListItem / table / image / video / audio

**未注册的自定义块**：quote、callout、toggle、columns、subpage、fileAttach、bookmark、embed、pdf

两个直接后果：

1. **斜杠菜单只显示默认 10 种块**：ColumnCell 的 `BlockNoteView` 未设置 `slashMenu={false}`，默认菜单激活，但 `getDefaultReactSlashMenuItems` 只能感知 mini-editor schema 中存在的类型，自定义块（callout、quote 等）不出现。

2. **加载时崩溃风险**：若 `columnsData` 中存有自定义块类型（如 `type: "quote"`），ColumnCell 在 `replaceBlocks` 时调用 `blockToNode`，第 325 行  
   `schema.nodes[block.type].isInGroup("blockContent")`  
   → `schema.nodes["quote"]` 为 `undefined`  
   → `Cannot read properties of undefined (reading 'isInGroup')`

---

## 修复方案

### 方案 A：用 `editor.updateBlock` 替换错误的 `updateBlock` prop

**核心思路**：  
ColumnsBlock render 已收到 `editor` prop（正确的 BlockNoteEditor 实例）。  
将所有 `updateBlock(...)` 调用改为 `editor.updateBlock(block, ...)`，  
并从解构中移除 `updateBlock`。

**改动文件**：
- `web/src/components/editor/Editor.tsx`  
  - 第 239 行：`render: ({ block, editor })` （删去 `updateBlock`）  
  - 第 254 行：`updateBlock(...)` → `editor.updateBlock(block, ...)`  
  - 第 258 行：`updateBlock(...)` → `editor.updateBlock(block, ...)`

配合子块能力扩展，还需：
- 第 343 行：将 mini-editor schema 换成完整 schema（或包含所需自定义块的子集 schema），并同步暴露自定义斜杠菜单项给 ColumnCell 的 `BlockNoteView`。

**风险**：
- 低：仅替换调用方式，逻辑不变。`editor.updateBlock` 是 BlockNote 稳定公共 API。  
- 中：若 mini-editor schema 包含所有自定义块，`columns` 块可嵌套 `columns`（无限递归）。需在斜杠菜单中手动过滤 `columns` 类型，防止用户在列内再插入分栏块。  
- 低：mini-editor 共享完整 schema 意味着 ColumnCell 需要和外层编辑器同步 `uploadFile` 等依赖，需一并传入。

### 方案 B：将列内容改为 BlockNote 原生嵌套 children（架构重构）

**核心思路**：  
放弃将每列数据序列化进 `columnsData` prop 的方案，改为让 `columns` block 使用  
BlockNote 的 `children` 字段存储每列内容，每列对应一个 `column` 子块（BlockNote 0.26 已内置 `columnList`/`column` 块类型）。

**改动文件**：
- `web/src/components/editor/Editor.tsx`：完全重写 ColumnsBlock，去掉 ColumnCell mini-editor，改用原生 `columnList`/`column` ProseMirror 节点结构。  
- `web/src/utils/toBlockNote.ts`：适配新存储格式。  
- 后端 `blocks` 表/API：可能需要支持 children 结构的保存。

**风险**：
- 高：改动面广，涉及数据模型和存储格式迁移，需同步迁移已存在的旧 `columnsData` 数据。  
- BlockNote 0.26 的 `columnList`/`column` API 较新，文档不完整，存在兼容性风险。

---

**推荐**：优先实施方案 A（改动最小，可快速修复崩溃并解锁子块能力），同时在斜杠菜单中过滤掉 `columns` 类型防止递归嵌套。
