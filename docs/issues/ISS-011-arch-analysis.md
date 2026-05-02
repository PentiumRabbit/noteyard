# ISS-011 根因分析报告

| 字段 | 内容 |
|------|------|
| 分析角色 | 总架构师-ISS011-72（arch-frontend） |
| 分析时间 | 2026-05-02 |
| BlockNote 版本 | @blocknote/react ^0.26.0 |
| 目标文件 | web/src/components/editor/Editor.tsx |

---

## 错误一：TS2540 — readonly 属性赋值（行 190、219）

### 错误现象
```
TS2540: Cannot assign to 'icon' because it is a read-only property  // 行 190
TS2540: Cannot assign to 'open' because it is a read-only property  // 行 219
```

### 根因
`createReactBlockSpec` 中 `render` 函数接收的 `block` 参数类型为 `BlockFromConfig<T, I, S>`，其 `props` 字段是深度 readonly 的。

```typescript
// ReactCustomBlockRenderProps 定义（node_modules/@blocknote/react/types/src/schema/ReactBlockSpec.d.ts）
export type ReactCustomBlockRenderProps<T, I, S> = {
    block: BlockFromConfig<T, I, S>;  // props 是 readonly
    editor: BlockNoteEditor<...>;
    contentRef: (node: HTMLElement | null) => void;
};
```

直接赋值 `block.props.icon = e` 违反 TypeScript readonly 约束。

### 修复方案
通过 `editor.updateBlock(block, { props: { ... } })` 修改 props，不可直接赋值。

callout block（行 190）：
```typescript
// 错误：block.props.icon = e;
// 正确：
editor.updateBlock(block, { props: { icon: e } });
```

toggle block（行 219）：
```typescript
// 错误：block.props.open = isOpen ? "false" : "true";
// 正确：
editor.updateBlock(block, { props: { open: isOpen ? "false" : "true" } });
```

---

## 错误二：TS2339 — updateBlock 不存在于 ReactCustomBlockRenderProps（行 259/306/362/425/506）

### 错误现象
```
TS2339: Property 'updateBlock' does not exist on type 'ReactCustomBlockRenderProps<...>'
```
影响块：fileAttach（259）、bookmark（306）、embed（362）、pdf（425）、button（506）

### 根因
BlockNote 0.26 的 `ReactCustomBlockRenderProps` 类型定义中不包含 `updateBlock`：

```typescript
// 当前类型定义
export type ReactCustomBlockRenderProps<T, I, S> = {
    block: BlockFromConfig<T, I, S>;
    editor: BlockNoteEditor<...>;   // 只有 editor，没有 updateBlock
    contentRef: (node: HTMLElement | null) => void;
};
```

旧版本可能在 props 解构中暴露了 `updateBlock` 便捷函数，0.26 版本已将其移除，必须通过 `editor.updateBlock()` 访问。

### 修复方案
将所有 5 个 block 的 `render` 解构参数从：
```typescript
render: ({ block, updateBlock }) => {
```
改为：
```typescript
render: ({ block, editor }) => {
```
然后将所有 `updateBlock(...)` 调用改为 `editor.updateBlock(block, ...)`。

注意：`editor.updateBlock` 第一个参数接受 block 对象或 block ID，第二个参数为 partial block。现有代码已有 `as any` 类型断言处理 props 类型差异，保留即可。

---

## 错误三-A：TS2719/TS2322 — BlockNoteEditor 类型不兼容（行 894/895）

### 错误现象
```
TS2719: Type 'BlockNoteEditor<...>' is not assignable to 'BlockNoteEditor<...>'
TS2322: Type 'BlockNoteEditor<...>' is not assignable to type 'BlockNoteEditor<...'
```

### 根因
`DatabaseSlashItem` 和 `MentionMenu` 组件接收 `editor` prop，其参数类型声明为：
```typescript
editor: BlockNoteEditor<typeof schema.blockSchema>
```
而 `useCreateBlockNote` 返回的 editor 类型包含更完整的泛型（含 inlineContent 和 style 类型参数），导致类型不兼容（两个同名但泛型参数不同的 BlockNoteEditor 类型）。

### 修复方案
将 `DatabaseSlashItem` 的参数类型改为 `BlockNoteEditor<any>`（与 `MentionMenu` 保持一致）：
```typescript
function DatabaseSlashItem({
  editor,
  pageId,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: BlockNoteEditor<any>;
  pageId: string;
})
```

---

## 错误三-B：TS6133 — 未使用变量 onSelectPage（行 1063）

### 错误现象
```
TS6133: 'onSelectPage' is declared but its value is never read
```

### 根因
`DatabaseSlashItem` 函数签名中声明了 `onSelectPage` 参数，但函数体内从未使用。

### 修复方案
从 `DatabaseSlashItem` 的参数解构中删除 `onSelectPage`：
```typescript
function DatabaseSlashItem({
  editor,
  pageId,
}: {
  editor: BlockNoteEditor<any>;
  pageId: string;
})
```

---

## 错误三-C：TS2322 — mention 类型不匹配（行 1079）

### 错误现象
```
TS2322: Type '"mention"' is not assignable to type '"text" | "link"'
```

### 根因
`editor.insertInlineContent` 的类型签名期望标准 inline content 类型（`"text" | "link"`），但代码插入了自定义 `"mention"` 类型。这是自定义 inline content spec 的已知类型推断限制，即使 schema 中注册了 mention，TypeScript 泛型层面无法自动推断。

### 修复方案
在 `insertInlineContent` 调用处添加类型断言：
```typescript
editor.insertInlineContent([
  {
    type: "mention",
    props: { pageId: page.id, title: page.title || "Untitled", icon: page.icon ?? "📄" },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  " ",
]);
```

---

## 汇总：修改清单

| 错误 | 行号 | 修改类型 |
|------|------|---------|
| TS2540 icon readonly | 190 | `block.props.icon = e` → `editor.updateBlock(block, { props: { icon: e } })` |
| TS2540 open readonly | 219 | `block.props.open = ...` → `editor.updateBlock(block, { props: { open: ... } })` |
| TS2339 fileAttach updateBlock | 257 | 解构 `updateBlock` → `editor`，调用 `editor.updateBlock` |
| TS2339 bookmark updateBlock | 304 | 同上 |
| TS2339 embed updateBlock | 360 | 同上 |
| TS2339 pdf updateBlock | 423 | 同上 |
| TS2339 button updateBlock | 504 | 同上 |
| TS2719/TS2322 BlockNoteEditor | 894/895 | DatabaseSlashItem 参数类型 → `BlockNoteEditor<any>` |
| TS6133 onSelectPage 未使用 | 1063 | 删除 DatabaseSlashItem 的 onSelectPage 参数 |
| TS2322 mention 类型 | 1079 | insertInlineContent 内的 mention 对象加 `as any` |

*由 总架构师-ISS011-72（arch-frontend）产出，dispatch #72 / ISS-011。*
