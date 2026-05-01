# 交付记录

状态: 📬 已交付
交付时间: 2026-05-01 14:30
交付物:
  - docs/tasks/ISS-003-architect-checklist.md
摘要: columnCellSchema 注册了 ColumnsBlock，导致 mini-editor 实例化时 getBlockFromPos 在 mini-editor 的 doc 中找不到外层 columns 块 ID，返回 undefined，触发 s.type TypeError
验收结果: ✅ 通过
验收时间: 2026-05-01

---

## 根因分析

### 定义顺序与依赖关系

文件：`web/src/components/editor/Editor.tsx`

| 行号 | 符号 | 角色 |
|------|------|------|
| 226 | `ColumnsBlock` | `createReactBlockSpec` 定义的外层 columns 块，render 闭包引用 `ColumnsBlockInner` |
| 275 | `ColumnsBlockInner` | function 声明（hosting），JSX 内使用 `<ColumnCell>` |
| 591 | `columnCellSchema` | `const`，`BlockNoteSchema.create`，**blockSpecs 中包含 `columns: ColumnsBlock`（行599）** |
| 612 | `ColumnCell` | function 声明，`useCreateBlockNote({ schema: columnCellSchema })`（行618） |
| 667 | `schema`（主编辑器） | 与 columnCellSchema 结构相同，同样含 `columns: ColumnsBlock`（行675） |

**循环引用结构**（运行时，非 const TDZ）：

```
ColumnsBlock.render（行239）
  → ColumnsBlockInner（行275，JSX 行318）
    → <ColumnCell>（行612）
      → useCreateBlockNote({ schema: columnCellSchema })（行618）
        → columnCellSchema.blockSpecs.columns = ColumnsBlock（行599）
          → ColumnsBlock 的 nodeView 被注册进 mini-editor 的 Tiptap 实例
```

### 崩溃触发路径（精确）

1. 用户在主编辑器斜杠菜单触发 `columnsItem.onItemClick`（行907）  
   `insertOrUpdateBlock(editor, { type: "columns", props: { cols: "2", columnsData: "[[],[]]" } })`

2. ProseMirror 将 `columns` 节点写入主编辑器 doc，BlockNote 为 `ColumnsBlock` 建立 nodeView（`@blocknote/react/dist/blocknote-react.js` 行3817 `addNodeView`）。

3. `ColumnsBlock.render` 被调用 → `ColumnsBlockInner` → `<ColumnCell>` React 渲染 → `ColumnCell` mount，`useCreateBlockNote({ schema: columnCellSchema })` 创建 **mini-editor**（BlockNote 实例，记为 `miniEditor`）。

4. `columnCellSchema` 含 `columns: ColumnsBlock`，因此 `ColumnsBlock` 的 `addNodeView` 被注册进 `miniEditor` 的 Tiptap 实例。此时 `this.options.editor`（即后续 `c`）= `miniEditor`。

5. mini-editor 初始化期间（Tiptap/ProseMirror 触发内部 decoration 或 state 更新），`ColumnsBlock` 的 nodeView render 回调被调用：  
   `@blocknote/react/dist/blocknote-react.js` 行3822：  
   ```js
   const c = this.options.editor;   // = miniEditor
   const d = un(l.getPos, c, this.editor, e.type);
   ```  
   `un` = `getBlockFromPos`（`@blocknote/core/dist/blocknote.js` 行6848 `Yi`）：  
   ```js
   function Yi(e, o, t, i) {
     const n = e();          // getPos() — 取 Tiptap doc 中节点位置
     const a = t.state.doc.resolve(n).node().attrs.id;  // columns 块的 id（属于主编辑器 doc）
     const s = o.getBlock(a);   // o = miniEditor，在 miniEditor.doc 中查找该 id
     if (s.type !== i)           // s === undefined → TypeError
       throw new Error(...)
     return s;
   }
   ```

6. `miniEditor.getBlock(columns_block_id)` — miniEditor 的 doc 为空或不含该 id → 返回 `undefined`  
   → `s.type` → **`TypeError: Cannot read properties of undefined (reading 'type')`**  
   此即 Cr2 组件（`@blocknote/react` 内部 nodeView React 组件）内抛出的错误。

### 关键：为何 ISS-002 修复后崩溃仍存在

ISS-002 修复了 `updateBlock` prop 误用（改为 `editor.updateBlock`），但未触及 `columnCellSchema` 含 `columns: ColumnsBlock` 这一结构性缺陷。只要 `columnCellSchema`（行591）包含 `columns: ColumnsBlock`（行599），每个 `ColumnCell` 实例化时都会重现上述崩溃路径。

---

## 修复方案

### 方案 A：从 columnCellSchema 中移除 columns（最小改动）

**核心思路**：  
`columnCellSchema` 的目的是支持列内使用所有自定义块，但列内不应支持嵌套 columns（避免无限递归，斜杠菜单中已有过滤逻辑，行655-656）。因此直接从 `columnCellSchema.blockSpecs` 中去掉 `columns: ColumnsBlock`，彻底断开循环。

**改动文件**：  
`web/src/components/editor/Editor.tsx`，第 591-610 行 `columnCellSchema` 的 `blockSpecs`：
- 删除 `columns: ColumnsBlock,`（行599）

**改动范围**：1 行删除，其余逻辑不变。

**风险**：  
- 低：列内本就不支持再插入 columns（斜杠菜单已过滤），去掉 schema 注册后行为与用户可见功能一致。  
- 低：若 `columnsData` 中历史数据包含嵌套 columns 块，读取时 mini-editor 的 `replaceBlocks` 会抛出 `isInGroup undefined`，但这本身是非法数据，修复后可在 load 层做防御性过滤。  
- 无数据迁移风险，新旧 schema 兼容。

### 方案 B：延迟 ColumnsBlock nodeView render 至 miniEditor 稳定后（防御性补丁）

**核心思路**：  
在 `ColumnCell` 的 render 中，用 `useState` + `useEffect` 控制 mini-editor 是否已就绪，仅在就绪后才挂载 `BlockNoteView`，避免 Tiptap 在初始化阶段触发 `ColumnsBlock` 的 nodeView render。

**改动文件**：  
`web/src/components/editor/Editor.tsx`，`ColumnCell` 组件（行612-664）：
- 添加 `const [ready, setReady] = useState(false)`
- `useEffect(() => { setReady(true); }, [])` 在首次挂载完成后才渲染 `BlockNoteView`
- 未 ready 时返回 `null` 或占位符

**改动范围**：~10 行，仅 `ColumnCell` 内部。

**风险**：  
- 中：只是延迟了触发时机，若 ProseMirror 在 ready 后仍会对 `ColumnsBlock` nodeView 执行 getBlockFromPos（例如重新排版时），崩溃路径依然存在，只是概率降低。  
- 不推荐作为唯一修复，应与方案 A 结合使用。

### 方案 C：使用 BlockNote 原生 columnList/column 替换自定义 columns 实现（架构重构）

**核心思路**：  
BlockNote 0.26 已内置 `columnList`/`column` 块类型，其存储和渲染完全由 BlockNote 自身管理，无需 mini-editor 实例，彻底消除循环依赖。

**改动文件**：  
- `web/src/components/editor/Editor.tsx`：删除 `ColumnsBlock`、`ColumnsBlockInner`、`ColumnCell`、`columnCellSchema`，改用 `@blocknote/react` 提供的 `defaultBlockSpecs.columnList`/`column`  
- `web/src/utils/toBlockNote.ts`：适配 `columnList`/`column` 的数据格式  
- 后端数据：历史 `columnsData` JSON prop 需迁移为 children 结构

**改动范围**：大。涉及数据模型、序列化、历史数据迁移。

**风险**：  
- 高：改动面广，存量数据需迁移，BlockNote 0.26 columnList API 文档不完整，存在兼容性风险。

---

**推荐**：优先实施方案 A（1 行改动，消除循环引用根因），选择性叠加方案 B 作为防御层。方案 C 作为中期重构目标。
