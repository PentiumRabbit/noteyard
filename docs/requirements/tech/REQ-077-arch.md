# REQ-077 技术设计文档 — 欢迎页改版为块类型展示台

| 字段 | 内容 |
|------|------|
| REQ ID | REQ-077 |
| 文档类型 | 架构设计 / 技术评审 |
| 版本 | v1.0 |
| 日期 | 2026-05-04 |
| 作者 | [arch] |
| 前置 | REQ-070（欢迎页 Seed 内容与代码分离） |

---

## 一、技术方案概述

REQ-077 的实现范围极为精确：**只修改 `server/internal/db/seeds/welcome.json` 的 `blocks` 数组**，不涉及任何 Go 代码、前端代码、数据库 Schema 的改动。

核心决策：
1. seed 加载机制（`ApplySeed`）对已存在页面完全幂等跳过——旧数据用户不受影响，无需修改 Go 代码。
2. 新内容全量替换 blocks 数组（原有 45 条 → 新版约 80 条），ID 从 `...000000000046` 顺序递增，无复用。
3. 特殊块类型（`database`、`subpage`、`bookmark`、`button`、`fileAttach`、`embed`、`pdf`）的 JSON 格式与 Editor.tsx 的 `buildDtosRecursive` 写入逻辑保持一致（props 写入 DB content 字段）。
4. `toggle` 块在 seed 中内容字段写入 `summary`（通过 props），子内容通过 `children` 嵌套表达——见下文格式规范。

---

## 二、seed 加载机制分析

### 2.1 当前行为

`loader.go` 中 `ApplySeed` 函数：

```go
// 幂等检查 — 页面已存在则完全跳过
var count int
tx.QueryRow(`SELECT COUNT(*) FROM pages WHERE id = ?`, page.ID).Scan(&count)
if count > 0 {
    return nil  // 直接返回，不写入任何块
}
```

行为特征：
- **首次启动**（pages 表中无 `00000000-0000-0000-0000-000000000001`）：写入 page + 所有 blocks。
- **再次启动**（page 已存在）：`ApplySeed` 立即返回 `nil`，不读取 blocks，不做任何 INSERT。
- 粒度是 **page 级别**，不是 block 级别。一旦欢迎页存在，任何后续 blocks 变化均不会同步。

### 2.2 幂等性结论

| 场景 | 行为 | 是否需要处理 |
|------|------|-------------|
| 全新安装（首次启动） | 写入新 welcome.json 全部内容 | 无需处理 |
| 已有旧版欢迎页的用户 | `ApplySeed` 跳过，用户看到的仍是其已有内容（可能已被编辑） | 符合预期，不覆盖用户数据 |
| 用户手动删除欢迎页后重启 | 页面 id 已不在 pages 表，重新写入新版内容 | 符合预期 |

**结论：不需要修改 Go 代码。** 幂等逻辑对新老用户均正确：
- 新用户看到改版后的展示台。
- 老用户保留其已有内容（含已编辑的欢迎页），不被强制覆盖。

验收标准中"已有旧数据库启动后 seed 幂等跳过"天然满足。

### 2.3 content 字段的展开规则（expandContent）

seed JSON 中 `content` 字段支持两种形式，loader 均可处理：

| seed 中写法 | DB 存储结果 |
|-------------|------------|
| `"content": "纯文字"` | `[{"type":"text","text":"纯文字","styles":{}}]` |
| `"content": [{"type":"text",...}]` | 原样存储 |
| `"content": null` 或省略 | `[]` |

特殊块（`database`、`subpage`、`bookmark`、`button`、`fileAttach`、`embed`、`pdf`）由 **前端** `buildDtosRecursive` 负责将 props 序列化写入 DB content 字段。seed 层的 `expandContent` 对这些块类型**同样会被调用**——因此 seed JSON 中这些块的 `content` 字段须写成正确的 JSON 对象或字符串，**不能是普通 inline 数组**。详见第三节各类型格式规范。

---

## 三、各块类型 JSON 格式规范

以下格式经过 `loader.go` 逻辑分析 + `Editor.tsx` propSchema 交叉验证，为 welcome.json 实现的权威参考。

### 3.1 基础文本块

**paragraph — 纯文本**
```json
{
  "id": "00000000-0000-0000-0001-XXXXXXXXXXXX",
  "type": "paragraph",
  "content": "段落文字"
}
```

**paragraph — 含 inline 样式**
```json
{
  "id": "...",
  "type": "paragraph",
  "content": [
    {"type": "text", "text": "普通 ", "styles": {}},
    {"type": "text", "text": "加粗", "styles": {"bold": true}},
    {"type": "text", "text": " ", "styles": {}},
    {"type": "text", "text": "斜体", "styles": {"italic": true}},
    {"type": "text", "text": " ", "styles": {}},
    {"type": "text", "text": "下划线", "styles": {"underline": true}},
    {"type": "text", "text": " ", "styles": {}},
    {"type": "text", "text": "删除线", "styles": {"strike": true}},
    {"type": "text", "text": " ", "styles": {}},
    {"type": "text", "text": "行内代码", "styles": {"code": true}}
  ]
}
```

**heading**（props.level 为 1/2/3）
```json
{
  "id": "...",
  "type": "heading",
  "props": {"level": 1, "textColor": "default", "backgroundColor": "default", "textAlignment": "left"},
  "content": "标题文字"
}
```

**quote**
```json
{
  "id": "...",
  "type": "quote",
  "content": "引用文字"
}
```

### 3.2 列表块

**bulletListItem — 普通项**
```json
{
  "id": "...",
  "type": "bulletListItem",
  "content": "列表项文字"
}
```

**bulletListItem — 含子项缩进**（通过 `children` 字段实现，loader 递归处理）
```json
{
  "id": "...",
  "type": "bulletListItem",
  "content": "父项",
  "children": [
    {
      "id": "...",
      "type": "bulletListItem",
      "content": "缩进子项"
    }
  ]
}
```

**numberedListItem**
```json
{
  "id": "...",
  "type": "numberedListItem",
  "content": "有序列表项"
}
```

**checkListItem**
```json
{
  "id": "...",
  "type": "checkListItem",
  "props": {"checked": false},
  "content": "任务项文字"
}
```

注意：`checked` 在 Editor.tsx `blockToMd` 中判断为字符串 `"true"`/`"false"`，但 propSchema 未指定类型。seed 中写 `false`（boolean）由 loader defaultProps 透传原始值，前端 BlockNote 正常解析。实现时建议保持与现有 welcome.json 风格一致，写 `false`/`true`（boolean）。

### 3.3 代码块

```json
{
  "id": "...",
  "type": "codeBlock",
  "props": {"language": "javascript"},
  "content": "// 示例代码\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\nconsole.log(greet('noteyard'));"
}
```

注意：`content` 为纯字符串，loader `expandContent` 会将其包装为 `[{"type":"text","text":"...","styles":{}}]`，BlockNote `codeBlock` 渲染时正确取 text 展示。

### 3.4 标注与分割

**callout**
```json
{
  "id": "...",
  "type": "callout",
  "props": {"icon": "💡"},
  "content": "标注文字"
}
```

图标可选值（来自 Editor.tsx `CALLOUT_EMOJIS`）：`💡 📌 ⚠️ ✅ ❌ 🔥 💬 📝 🎯 🚀`

**horizontalRule**（无 content，无 props）
```json
{
  "id": "...",
  "type": "horizontalRule"
}
```

### 3.5 折叠块（toggle）

toggle 的设计特殊性：propSchema 中 `summary`（折叠标题）作为 prop，`content` 字段对应折叠块标题的 inline 内容（渲染在 `<span ref={contentRef}>`）。折叠内部的块内容须通过 `children` 表达：

```json
{
  "id": "...",
  "type": "toggle",
  "props": {"open": "true", "summary": "点击展开查看详情"},
  "content": "点击展开查看详情",
  "children": [
    {
      "id": "...",
      "type": "paragraph",
      "content": "这是折叠块内的内容，收起后不可见。折叠块可以用来隐藏细节、展示补充说明。"
    }
  ]
}
```

注意：`open` 值为字符串 `"true"`/`"false"`（来自 propSchema `default: "true"`），不是 boolean。

### 3.6 表格

```json
{
  "id": "...",
  "type": "table",
  "content": {
    "type": "tableContent",
    "rows": [
      {"cells": [
        [{"type": "text", "text": "姓名", "styles": {"bold": true}}],
        [{"type": "text", "text": "角色", "styles": {"bold": true}}],
        [{"type": "text", "text": "状态", "styles": {"bold": true}}]
      ]},
      {"cells": [
        [{"type": "text", "text": "Alice", "styles": {}}],
        [{"type": "text", "text": "设计师", "styles": {}}],
        [{"type": "text", "text": "在职", "styles": {}}]
      ]},
      {"cells": [
        [{"type": "text", "text": "Bob", "styles": {}}],
        [{"type": "text", "text": "工程师", "styles": {}}],
        [{"type": "text", "text": "在职", "styles": {}}]
      ]}
    ]
  }
}
```

注意：`content` 为 JSON 对象，`expandContent` 的 switch 语句中 `{` 开头会走 `default` 分支报错。**需要确认 loader 处理 table 的路径。**

分析 loader.go `expandContent`：switch 仅处理 `"` (string) 和 `[` (array)，`{` 开头会返回 error。

**但 table 实际上是 BlockNote `defaultBlockSpecs` 中的原生块**，其 content 格式（`tableContent`）由 BlockNote 内部处理，不走 `expandContent` 的 inline 展开路径——前提是 seed 写入时对 table 的 content 须是原始 JSON 对象。

**这是一个实现风险点**（见第六节）。需要工程师确认 loader 对 `{` 开头 content 的处理，或在 loader 中为 table 类型添加对象 content 的直通路径。

建议预防措施：在 `expandContent` 中增加 `{` 分支直接透传原始 JSON 字符串：
```go
case '{':
    return string(raw), nil
```

### 3.7 并排布局（columnList + column）

columnList/column 结构完全通过 `children` 嵌套实现，loader `flattenNodes` 递归处理：

```json
{
  "id": "...",
  "type": "columnList",
  "children": [
    {
      "id": "...",
      "type": "column",
      "children": [
        {
          "id": "...",
          "type": "paragraph",
          "content": "左列：可以放任意块"
        }
      ]
    },
    {
      "id": "...",
      "type": "column",
      "children": [
        {
          "id": "...",
          "type": "paragraph",
          "content": "右列：将块拖到另一块的左/右边缘即可分栏"
        }
      ]
    }
  ]
}
```

loader 对 columnList 的处理：`defaultProps` 返回 `{}`，`expandContent(null)` 返回 `[]`，递归进入 children 处理 column 及其子块。与 Editor.tsx `buildDtosRecursive` 的写入逻辑一致。

### 3.8 特殊块（props 写入 DB content 字段）

以下块类型在 Editor.tsx `buildDtosRecursive` 中统一走：
```js
content: JSON.stringify(b.props), props: "{}"
```

seed 中需将数据写在 `content` 字段（JSON 对象格式），seed loader 会将其存入 DB content 列，前端读取时再解析回 props。

**bookmark**
```json
{
  "id": "...",
  "type": "bookmark",
  "content": {
    "url": "https://noteyard.app",
    "title": "noteyard — 本地优先的块编辑器",
    "description": "像 Notion 一样组织知识，数据完全存储在本地。",
    "favicon": ""
  }
}
```

**button**
```json
{
  "id": "...",
  "type": "button",
  "content": {
    "label": "示例按钮",
    "color": "blue",
    "action": "none",
    "url": ""
  }
}
```

```json
{
  "id": "...",
  "type": "button",
  "content": {
    "label": "访问官网",
    "color": "green",
    "action": "open_url",
    "url": "https://noteyard.app"
  }
}
```

**database**
```json
{
  "id": "...",
  "type": "database",
  "content": {
    "databaseId": ""
  }
}
```

空 `databaseId` 时，DatabaseBlock 渲染 "Database 初始化中…" 占位文案，用户点击后可通过斜杠菜单重新创建。seed 层不需要自动创建数据库。

**subpage**
```json
{
  "id": "...",
  "type": "subpage",
  "content": {
    "pageId": "",
    "title": "示例子页面",
    "icon": "📄"
  }
}
```

**fileAttach**（占位，无实际文件）— 用 callout 说明替代，无需写实际 fileAttach 块

**embed / pdf**（同上）— 用 callout 说明替代，无需写实际 embed/pdf 块

> 注：bookmark、button、database、subpage 的 `content` 是 JSON 对象，会触发 `expandContent` 中 `{` 开头分支的问题（同 table）。需要同样的 loader 修复。

---

## 四、block ID 规划

### 4.1 现有 ID 情况

当前 welcome.json 使用的 ID 范围：
- 最小：`00000000-0000-0000-0001-000000000001`
- 最大：`00000000-0000-0000-0001-000000000045`
- 中间有一处跳号：`000000000026` → `000000000035`（000000000027~000000000034 被 27~34 号块的 id 用于快捷键节，原排布非严格递增但仍在 045 以内）

实际出现的所有 ID（45 个）：001~034, 035~045 共 45 个，均在 `045` 范围内。

### 4.2 新版 ID 分配原则

- **起始编号：`000000000046`**（紧接当前最大值 045）
- 格式保持：`00000000-0000-0000-0001-XXXXXXXXXXXX`，共 12 位十进制，左补零
- 按 blocks 数组物理顺序顺序递增，不跳号，不复用
- children 内部的块也占用独立编号（columnList、column、toggle children 内的块各自有 ID）

### 4.3 ID 数量估算

根据需求文档页面结构设计，各节块数：

| 节 | 内容 | 估计块数 |
|----|------|---------|
| 节1 | H1 + callout | 2 |
| 节2 | H2 + paragraph(inline) + H1示例 + H2示例 + H3示例 + quote | 6 |
| 节3 | H2 + bullet×3(含1子项) + numbered×3 + check×3 | 11 |
| 节4 | H2 + codeBlock | 2 |
| 节5 | H2 + callout×2 + horizontalRule | 4 |
| 节6 | H2 + toggle(含1 paragraph child) | 3（toggle本身+1子块） |
| 节7 | H2 + table | 2 |
| 节8 | H2 + columnList(含2 column,各1 paragraph) + callout | 6（columnList+2 column+2 paragraph+callout） |
| 节9 | H2 + callout×5 + bookmark | 7 |
| 节10 | H2 + button×2 | 3 |
| 节11 | H2 + database + callout | 3 |
| 节12 | H2 + subpage + callout | 3 |
| 节13 | horizontalRule + quote | 2 |
| **合计** | | **约 54 块** |

新版 ID 范围：`000000000046` 到约 `000000000099`，预留至 `000000000099` 足够（共 54 个新 ID）。

---

## 五、实施步骤

工程师只需执行以下步骤：

### Step 1：修复 loader.go 中 expandContent 对 `{` 的处理

文件：`server/internal/db/seeds/loader.go`

在 `expandContent` 函数的 switch 语句中添加 `{` 分支：

```go
case '{':
    // JSON object content (table, bookmark, button, database, etc.) — pass through as-is.
    return string(raw), nil
```

位置：在 `case '['` 之后、`default` 之前。

**此为必须修复项**，否则 table、bookmark、button、database、subpage 块在 seed 加载时会报错。

### Step 2：更新 welcome.json 的 blocks 数组

文件：`server/internal/db/seeds/welcome.json`

只替换 `"blocks": [...]` 数组内容，page 元数据保持不变：

```json
{
  "version": 1,
  "page": {
    "id": "00000000-0000-0000-0000-000000000001",
    "title": "欢迎使用 noteyard",
    "icon": "👋",
    "order_index": 0
  },
  "blocks": [
    // 按 REQ-077 页面结构设计编写，共约 54 块
    // ID 范围：000000000046 ~ 000000000099
  ]
}
```

### Step 3：运行 seed loader 单测

```bash
cd server && go test ./internal/db/seeds/... -v
```

确保 `loader_test.go` 全部通过。如有必要，为 table 和 bookmark 块类型补充测试用例。

### Step 4：启动全新数据库验证

```bash
rm -f noteyard.db  # 删除旧数据库
./noteyard         # 重新启动
```

打开欢迎页，逐节检查各块类型渲染正确，无控制台报错。

---

## 六、风险与注意事项

### 风险 1：expandContent 不支持 `{` 开头的 JSON 对象（高）

**影响**：table、bookmark、button、database、subpage 块在 seed 加载时 `expandContent` 报错，导致 `ApplySeed` 返回 error，欢迎页无法写入。

**解决**：Step 1 中添加 `case '{'` 分支直通。该改动向后兼容，不影响现有块类型。

### 风险 2：toggle 的 children 内容渲染（中）

toggle propSchema 中 `content: "inline"` 对应的 contentRef 渲染的是 **summary 标题文字**，而非折叠内部内容。折叠内部内容通过 BlockNote 的 children 机制渲染。seed 的 `children` 字段由 `flattenNodes` 递归处理，parent_block_id 指向 toggle 块 ID。需验证前端 `toBlockNote` 工具函数（`web/src/utils/toBlockNote.ts`）是否正确将 parent_block_id 重建为 children 树，并由 BlockNote 正确渲染 toggle 子块。

**建议**：在 Step 4 验证时重点测试 toggle 折叠/展开行为。

### 风险 3：database 块空 databaseId 渲染（低）

DatabaseBlock 对空 databaseId 渲染 "Database 初始化中…" 占位，而非报错。展示台场景下此行为符合预期（REQ-077 明确"空状态或初始化占位均可"）。无需特殊处理。

### 风险 4：subpage 空 pageId（低）

SubpageBlock 对空 pageId 渲染占位链接，点击无跳转（`dataset.pageId` 为空字符串时 handler 不触发 `onSelectPage`）。展示台场景可接受。

### 风险 5：bookmark content 字段格式歧义（中）

bookmark 在 seed 中写 `content: { url:..., title:..., ... }` 对象，经 loader 存入 DB content 列。前端 `toBlockNote` 读取时需将 DB content 解析为 props 结构。需确认 `toBlockNote.ts` 对 bookmark/button/subpage 类型的反序列化逻辑与 `buildDtosRecursive` 的序列化逻辑对称。如不对称，seed 中的 bookmark 会渲染为空白状态（显示 URL 输入框）。

**建议**：实现前检查 `toBlockNote.ts` 中 bookmark/button/database/subpage 的反序列化路径。

### 风险 6：ID 不连续不影响功能（信息）

现有 welcome.json 中 ID 存在跳号（026 后接 035），但 seed loader 仅使用 ID 作为主键，不依赖 ID 连续性。新版从 046 开始顺序递增，无副作用。

---

## 七、附：需要工程师确认的前置问题

在开始编写 welcome.json 之前，需工程师确认：

1. **`toBlockNote.ts` 对 bookmark/button/database/subpage 的反序列化**：确认 DB content 字段（JSON 字符串）能正确还原为 BlockNote props，保证 seed 写入的数据前端能正确渲染。

2. **expandContent `{` 分支**：确认在 Step 1 中添加该分支不会影响现有测试（`loader_test.go`）。

3. **toggle children 渲染**：确认 `toBlockNote.ts` 将 parent_block_id 指向 toggle ID 的子块正确重建为 toggle 的 children，并由 BlockNote 渲染为折叠内容区域。

以上三点均为实施前必须验证的条件，否则建议架构师在评审后指派工程师先完成确认再开始编写 welcome.json。
