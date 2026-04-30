# BUG-001 架构评审：编辑器内容区域空白

**Bug 编号**: BUG-001  
**评审日期**: 2026-04-30  
**严重等级**: P0 — 所有含 horizontalRule / quote 块的页面完全无法查看内容  
**状态**: 待修复

---

## 一、根因定位

### 主因：BlockNote Schema 与数据库存储类型不匹配（Editor.tsx + DB）

**文件**: `web/src/components/editor/Editor.tsx`，第 49–54 行

```ts
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,   // paragraph / heading / bulletListItem 等标准块
    database: DatabaseBlock, // 自定义块
    // ❌ 缺失: horizontalRule, quote
  },
});
```

`defaultBlockSpecs`（来自 `@blocknote/core`）仅包含：
`paragraph`, `heading`, `codeBlock`, `bulletListItem`, `numberedListItem`, `checkListItem`, `table`, `file`, `image`, `video`, `audio`。

**`horizontalRule` 和 `quote` 均不在其中。**

然而，`DatabaseSlashItem`（第 196–212 行）的斜杠菜单提供了这两个插入入口：

```ts
onItemClick: () => insertOrUpdateBlock(editor, { type: "horizontalRule" } as any)
onItemClick: () => insertOrUpdateBlock(editor, { type: "quote" } as any)
```

`insertOrUpdateBlock` 在 BlockNote 内部通过 ProseMirror 节点树直接写入，绕过 schema 校验（`as any` 强转），因此**插入时不报错**，数据库中成功存储了 `type="horizontalRule"` 和 `type="quote"` 的行。

**触发时序（页面加载 → 空白）**：

```
useEffect[pageId] 执行
  → api.blocks.listByPage(pageId)         // 返回含 horizontalRule/quote 的数组
  → toBlockNote(blocks)                   // 转换成 { type:"horizontalRule", ... }
  → editor.replaceBlocks(document, ...)   // BlockNote 校验 type，发现未注册 → 抛出异常
  → catch { editor.replaceBlocks(document, [{ type:"paragraph" }]) }  // 回退到空段落
  → requestAnimationFrame → readyRef=true
```

结果：页面呈现 1 个空段落，所有块消失，与 BUG 描述完全吻合。

**精确定位**：

| 位置 | 问题 |
|------|------|
| `Editor.tsx` 第 49–54 行 | schema 未注册 `horizontalRule` 和 `quote` |
| `Editor.tsx` 第 118–121 行 | `catch` 块将整个 editor 内容替换为空段落，掩盖错误 |
| `Editor.tsx` 第 198, 207 行 | 斜杠菜单用 `as any` 插入未注册类型，数据写入但无法读回 |

---

### 次因（独立问题）：order_index 重复导致块排序不稳定

**文件**: `server/internal/repository/sqlite/block_repo.go`，第 18 行

```go
`SELECT ... FROM blocks WHERE page_id=? ORDER BY order_index`
```

数据库中存在多个 `order_index=0` 的块（经 API 验证，`5f5b2fc4` 页面有 5 个 order=0 的块）。SQLite 对相同 order_index 的排序不确定，导致页面每次加载块顺序可能不同。

此问题不导致空白，但会引发内容顺序错乱。

---

## 二、影响范围

| 受影响范围 | 说明 |
|-----------|------|
| 所有含 `horizontalRule` 块的页面 | 加载即空白 |
| 所有含 `quote` 块的页面 | 加载即空白 |
| REQ-035 生成的使用说明页面 | 全部涉及 horizontalRule/quote，无一可正常显示 |
| 纯 paragraph/heading/bulletListItem 页面 | 不受影响（如 test page、测试页） |
| 含 database 块的页面 | 不受影响 |

经 API 验证，受影响页面包括：
- `📖 noteyard 使用说明` 及其所有子页面（5 个）
- 其他通过斜杠菜单插入过分隔线/引用的页面

---

## 三、修复方案

### 方案选择

BlockNote 原生支持 `horizontalRule` 和 `quote`（它们存在于 BlockNote 的官方扩展包，但未导出到 `defaultBlockSpecs`）。正确做法是将两者作为自定义块注册到 schema，而非依赖 `as any` 绕过校验。

查阅 BlockNote 文档，`horizontalRule` 对应 `BlockNoteSchema` 的 `content: "none"` 块，`quote` 对应 `content: "inline"` 块，两者均可用 `createReactBlockSpec` 实现。

### 具体改动

**T01 — 注册 horizontalRule 到 schema**

文件: `web/src/components/editor/Editor.tsx`

```ts
// 在 DatabaseBlock 定义之后，schema 定义之前添加：
const HorizontalRuleBlock = createReactBlockSpec(
  {
    type: "horizontalRule" as const,
    propSchema: {},
    content: "none",
  },
  {
    render: () => <hr style={{ border: "none", borderTop: "1px solid #e0e0e0", margin: "8px 0" }} />,
  },
);
```

**T02 — 注册 quote 到 schema**

文件: `web/src/components/editor/Editor.tsx`

```ts
const QuoteBlock = createReactBlockSpec(
  {
    type: "quote" as const,
    propSchema: {
      textColor: { default: "default" },
      backgroundColor: { default: "default" },
      textAlignment: { default: "left" as const },
    },
    content: "inline",
  },
  {
    render: ({ block, contentRef }) => (
      <blockquote
        style={{ borderLeft: "3px solid #ccc", paddingLeft: 12, margin: 0, color: "#555" }}
        ref={contentRef}
      />
    ),
  },
);
```

**T03 — 将两个块加入 schema**

文件: `web/src/components/editor/Editor.tsx`，第 49–54 行

```ts
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    database: DatabaseBlock,
    horizontalRule: HorizontalRuleBlock, // 新增
    quote: QuoteBlock,                   // 新增
  },
});
```

**T04 — 改善 catch 块，避免数据损失**

文件: `web/src/components/editor/Editor.tsx`，第 118–122 行

将无声的 catch-reset 替换为带日志的降级策略：

```ts
} catch (err) {
  console.error("[Editor] replaceBlocks failed:", err, blocks);
  // 仅当 blocks 为空时才重置为空段落，否则保留 document 不变
  if (!blocks || blocks.length === 0) {
    editor.replaceBlocks(editor.document, [{ type: "paragraph" }] as any);
  }
  // readyRef 仍需置 true，否则编辑器永久锁死
}
```

**T05 — 修复 order_index 重复问题（次因）**

文件: `server/internal/repository/sqlite/block_repo.go`，第 18 行

在 `ORDER BY` 中加入 `created_at` 作为二级排序，保证相同 order_index 的块按插入顺序返回：

```go
`SELECT ... FROM blocks WHERE page_id=? ORDER BY order_index, created_at`
```

---

## 四、风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| T01/T02 新块 CSS 渲染差异 | 低 | 仅影响视觉表现，功能不受影响 |
| T03 schema 变更影响已保存数据 | 无 | 数据库字段不变，仅前端解析层新增类型 |
| T04 catch 改动 | 低 | 现有异常路径仍被捕获，只是不再强制清空 |
| T05 order_index 排序改动 | 低 | 纯 SELECT 层变更，不写库，无数据风险 |
| 遗留的 `as any` 斜杠菜单代码 | 中 | T01/T02 完成后 `as any` 可以安全移除；若不移除，未来新增块类型仍有同样风险 |

---

## 五、任务拆分

| 任务 | 文件 | 改动描述 | 优先级 |
|------|------|---------|--------|
| T01 | `web/src/components/editor/Editor.tsx` | 实现并注册 `HorizontalRuleBlock` | P0 |
| T02 | `web/src/components/editor/Editor.tsx` | 实现并注册 `QuoteBlock` | P0 |
| T03 | `web/src/components/editor/Editor.tsx` | schema 中加入 `horizontalRule` 和 `quote` | P0（依赖 T01/T02） |
| T04 | `web/src/components/editor/Editor.tsx` | 改善 catch 块，增加错误日志，避免有效内容被清空 | P1 |
| T05 | `server/internal/repository/sqlite/block_repo.go` | `ORDER BY order_index, created_at` 二级排序 | P2 |

T01–T03 必须同一批次提交（三者共同构成完整修复），T04/T05 可独立跟进。

---

## 六、验证步骤

修复后需验证：

1. 打开 `📖 noteyard 使用说明` 页面，所有段落、分隔线、引用块正常渲染
2. 打开 `🚀 快速开始` 子页面，horizontalRule 和 quote 块可见
3. 用斜杠菜单插入分隔线 / 引用，切换页面再返回，内容持久
4. 纯 paragraph 页面（test page）不受影响
5. database 块页面不受影响
