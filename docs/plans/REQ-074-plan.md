# REQ-074 执行计划 — 空状态展示快速入门说明

| 字段 | 内容 |
|------|------|
| REQ ID | REQ-074 |
| PM | pm-REQ-074 (DISPATCH#129) |
| 计划版本 | v1.0 |
| 日期 | 2026-05-03 |
| 状态 | 待实现 |

---

## 一、需求范围确认

### 核心目标

未选中页面时，主区域（`App.tsx` `.empty-state` 区域）移除现有提示文字，替换为静态快速入门说明卡片：
- 卡片内容预置于前端 `web/src/data/quickstart.json`（noteyard seed 方言，≤20 块）
- 用轻量 HTML 渲染，不复用 Editor 组件
- 卡片底部「导入为页面」按钮，调用现有 API（`POST /api/pages` + `POST /api/pages/{id}/blocks`），导入成功后 `handleSelect` 跳转
- 卡片始终展示，无关闭/隐藏逻辑

### 关键约束

| 约束 | 说明 |
|------|------|
| 卡片宽度 | `max-width: 600px`，水平居中 |
| 渲染方式 | 轻量 HTML（React JSX），不使用 BlockNote Editor 组件 |
| 导入接口 | 使用现有 `api.pages.create` + `api.blocks.create` 逐块写入（JSON seed 格式 → DB block 格式） |
| 导入成功 | 调用 `handleSelect(page_id)` 跳转 |
| 导入失败 | 展示错误提示（toast.error 或卡片内 inline 提示），不跳转 |
| 空状态持久 | 导入后回到空状态（未选中页面）时卡片依然展示 |

### 不在范围

- 后端新增 `/api/import/json` 接口（无需，前端直接调用 pages/blocks API）
- 说明内容国际化 / 可配置化
- 卡片可关闭 / 一次性展示 flag
- 与 `welcome.json` 内容复用

---

## 二、任务拆解

### T1 — 新建 `web/src/data/quickstart.json`

**负责角色**：前端工程师（eng-frontend）

**交付物**：
- `web/src/data/quickstart.json`

**要求**：
- 格式与 `server/internal/db/seeds/welcome.json` 相同（noteyard seed 方言，`version: 1`）
- `page.id` 可为任意固定 UUID（如 `00000000-0000-0000-0002-000000000001`）；仅作为结构元数据，导入时会生成新 UUID
- 块总数 ≤ 20，覆盖以下 5 个章节：

| 章节 | 块构成 |
|------|--------|
| 标题 | `heading`（level=1）：「快速开始」 |
| 创建页面 | `heading`（level=2）+ 3 个 `bulletListItem` |
| 块编辑器 | `heading`（level=2）+ 3 个 `bulletListItem` |
| 数据库 | `heading`（level=2）+ 2 个 `bulletListItem` |
| 常用快捷键 | `heading`（level=2）+ 3 个 `bulletListItem`（⌘K 搜索 / `/` 斜杠菜单 / ⌘Z 撤销） |

- 合计：1 + 4 + 4 + 3 + 4 = 16 块，满足 ≤20 约束
- `content` 字段使用纯字符串形式（与 welcome.json 相同，渲染器侧展开为 inline array）

**验收标准**：
- JSON 可用 `JSON.parse` 正常解析
- 块数量为 16，覆盖全部 5 个章节

---

### T2 — 新建 `web/src/components/quickstart/QuickstartCard.tsx`（含样式）

**负责角色**：前端工程师（eng-frontend）

**交付物**：
- `web/src/components/quickstart/QuickstartCard.tsx`
- `web/src/components/quickstart/QuickstartCard.css`

**要求**：

#### 渲染逻辑

- 读取 `quickstart.json`，将 seed blocks 渲染为纯 HTML 结构：
  - `heading`（level=1）→ `<h1>`
  - `heading`（level=2）→ `<h2>`
  - `bulletListItem` → `<ul><li>`（相邻同类块合并到同一 `<ul>` 中）
  - `paragraph` → `<p>`
  - `content` 字段为字符串时直接渲染，为 inline array 时拼接 `text` 字段
- 不引入 BlockNote / Editor 组件

#### 导入逻辑

- 组件接收 `onImported: (pageId: string) => void` prop
- 点击「导入为页面」按钮时：
  1. 调用 `api.pages.create({ title: "快速开始", icon: "🚀" })` 创建页面
  2. 遍历 quickstart.json blocks，依次调用 `api.blocks.create(pageId, { type, content, props, order_index })` 写入块
  3. 全部成功后调用 `onImported(pageId)`
  4. 任一步骤失败：调用 `toast.error(错误信息)`，不调用 `onImported`

#### 样式约束

- 外层容器：`max-width: 600px; margin: 0 auto; padding: 40px 24px`
- 按钮位于卡片底部，与内容区留 24px 间距
- 导入进行中按钮 disabled + 文字改为「导入中…」

**验收标准**：
- 渲染 16 个块，5 个章节标题可见
- 点击「导入为页面」后正确创建 page + blocks，并回调 `onImported`
- 导入失败时 toast 提示，按钮恢复可用
- 卡片宽度 ≤ 600px，居中

---

### T3 — 修改 `web/src/App.tsx` — 替换 empty-state

**负责角色**：前端工程师（eng-frontend）

**交付物**：
- `web/src/App.tsx`（修改）

**要求**：
- 将 `App.tsx:298–300` 的 `.empty-state` 内容替换：

**修改前**：
```tsx
<div className="empty-state">
  <p>从左侧选择页面，或点击 + 新建</p>
</div>
```

**修改后**：
```tsx
<div className="empty-state">
  <QuickstartCard onImported={handleSelect} />
</div>
```

- 在文件顶部 import `QuickstartCard`
- 调整 `.empty-state` CSS（`App.css`）以适配卡片展示（改为 `align-items: flex-start` 或 `padding: 32px`，避免纯文字居中的弹性布局压缩卡片）

**验收标准**：
- 未选中页面时展示 `QuickstartCard`，不再显示原提示文字
- 卡片宽度正常（≤ 600px，居中）

---

### T4 — E2E / 手动回归验证

**负责角色**：测试执行者（test-executor）

**验收场景**：

| 场景 | 预期结果 |
|------|---------|
| 未选中页面 | 展示快速入门卡片，5 个章节标题可见 |
| 点击「导入为页面」 | 侧边栏出现新页面，自动跳转，内容可编辑 |
| 导入后回到空状态 | 卡片依然展示 |
| 卡片宽度 | Chrome DevTools 量取 ≤ 600px，水平居中 |
| 导入接口失败（Mock 502） | toast 错误提示，不跳转，按钮恢复 |

---

## 三、交付顺序

```
T1（quickstart.json）→ T2（QuickstartCard）→ T3（App.tsx 替换）→ T4（回归验证）
```

T1 先于 T2，因 T2 需要读取 JSON 结构；T3 依赖 T2 完成；T4 在 T1–T3 全部完成后执行。

---

## 四、导入接口方案说明

后端已有 `POST /api/import/markdown`（markdown 文件上传），不适用于 JSON seed 格式。

本需求采用前端直接拼装调用方式：
1. `POST /api/pages` → 获取 `page_id`
2. `POST /api/pages/{page_id}/blocks` × N（逐块写入，order_index 按数组位置）

这与现有导入 Markdown 的后端效果等价（最终都是 pages + blocks 落库），无需新增后端接口。

Content 转换规则（seed JSON → API 请求体）：
- seed `content` 为字符串 → `content: JSON.stringify([{ type: "text", text: value, styles: {} }])`
- seed `content` 为数组 → `content: JSON.stringify(value)`
- seed `props` 缺省 / null → `props: "{}"`，或按块类型补默认值（heading 补 `{"level": N}`）

---

## 五、验收矩阵

| 验收标准 | 关联任务 |
|---------|---------|
| 未选中页面时展示快速入门说明卡片，不显示原提示文字 | T3 |
| 说明卡片覆盖 5 个章节（创建页面、块编辑器、数据库、常用快捷键、标题） | T1, T2 |
| 点击「导入为页面」后内容导入数据库并自动跳转 | T2, T3 |
| 导入后页面可正常编辑（块可增删改） | T2 |
| 重回空状态卡片依然展示（导入不影响空状态展示） | T3 |
| 卡片 ≤ 600px 居中 | T2, T3 |
