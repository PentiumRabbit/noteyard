# REQ-037 架构评审 — 字体优化

**日期**：2026-04-30  
**需求**：编辑器字体观感对齐 Notion  
**状态**：待实现

---

## 一、现状分析

### 1.1 字体栈现状

| 位置 | 当前值 |
|------|--------|
| `index.css` body | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| `Editor.css` `.bn-default-styles` | `-apple-system, "Segoe UI", sans-serif`（缺 BlinkMacSystemFont、中文字体） |
| `DatabaseView.css` `.db-wrap` | `font-family: inherit`（继承 body） |
| BlockNote 内置 `.bn-default-styles` | `Inter, SF Pro Display, -apple-system, BlinkMacSystemFont, Open Sans, Segoe UI, ...`（完整字体栈，包含 Inter） |

**问题**：`Editor.css` 覆盖了 BlockNote 内置 `.bn-default-styles` 的字体栈，但自定义栈缺少 `BlinkMacSystemFont`、中文字体（PingFang SC、Hiragino Sans GB、Noto Sans CJK SC、Microsoft YaHei）。`index.css` body 字体同样缺少中文支持，导致中文字符回退到系统默认宋体/苹方，与 Notion 观感差距明显。

### 1.2 正文字体规格现状

| 属性 | 当前值 | 目标值 |
|------|--------|--------|
| `font-size` | `16px` | `16px` (一致) |
| `line-height` | `1.6` | `1.5` (偏高) |
| `font-weight` | 未显式声明（继承 400） | `400` (一致) |

### 1.3 标题规格现状

| 级别 | 当前 font-size | 目标 | 当前 line-height | 目标 |
|------|---------------|------|-----------------|------|
| H1 | `30px`（含 `!important`） | `1.875em`≈30px（基于16px一致） | `1.3` | `1.3` (一致) |
| H2 | `24px`（含 `!important`） | `1.5em`=24px（一致） | `1.3` | — (未指定保持) |
| H3 | `20px`（含 `!important`） | `1.25em`=20px（一致） | `1.3` | — (未指定保持) |

标题 px 值与目标 em 换算结果吻合，但当前用绝对 px + `!important` 写法，目标方案改为相对 em 更具弹性。H2/H3 的 `font-weight` 目标均为 600，当前已是 600，无需变更。

### 1.4 数据库单元格现状

| 选择器 | 当前 font-size | 目标 |
|--------|---------------|------|
| `.db-wrap` | `14px` | `14px` (一致) |
| `.cell-text-inner` 等 | `13px` | `14px`（偏小） |
| `line-height` | 未设置 | `1.4` |

单元格正文用 `13px`，目标是 `14px`；缺少 `line-height: 1.4` 声明。

### 1.5 代码块现状

| 属性 | 当前值 | 目标值 |
|------|--------|--------|
| `font-size`（`.bn-block-content[codeBlock] > pre`） | `14px` | `0.875em`（相对于正文 16px = 14px，数值一致） |
| `font-family` | 未在代码块 pre 上声明（继承正文字体） | 等宽字体栈 |
| `line-height` | `1.6` | `1.6` (一致) |
| 内联代码 `font-family` | `ui-monospace, "SF Mono", "Cascadia Code", monospace` | 需扩充为完整等宽栈 |

代码块 `pre` 缺少显式等宽字体声明，依赖 BlockNote 内置（BlockNote core style 在 `.bn-inline-content code` 上只设了 `font-family:monospace`，pre 无声明）。

---

## 二、BlockNote 样式覆盖机制分析

BlockNote 通过以下路径注入样式（按加载顺序）：
1. `@blocknote/react/style.css` — 编辑器结构样式
2. `@blocknote/mantine/style.css` — Mantine UI 组件样式
3. `@blocknote/core` dist `style.css`（bundled）— 含 `.bn-default-styles` 基础排版

关键发现（来自 BlockNote core style.css 解析）：
- `.bn-default-styles` 声明了 `font-size:16px; font-weight:400; font-family: Inter, SF Pro Display, -apple-system, ...`
- 标题由 CSS 变量 `--level`（H1=3em, H2=2em, H3=1.3em）+ `.bn-block-outer:not([data-prev-type]) > .bn-block > .bn-block-content[data-content-type=heading]` 控制，权重为普通选择器

**当前项目已正确处理覆盖**：`Editor.css` 使用 `.editor-wrap .bn-default-styles`（提升一级权重）覆盖字体和尺寸，标题用双路径 + `!important` 确保覆盖 BlockNote 的 `em` 变量机制。

**改动后仍需保持的选择器策略**：
- 正文：`.editor-wrap .bn-default-styles` — 足够，无需 `!important`
- 标题：保留 `!important` 或切换到 em 单位（em 相对于 `.bn-default-styles` 的 `font-size`，结果等价）
- 代码块 `pre`：`.editor-wrap .bn-block-content[data-content-type="codeBlock"] > pre` — 需加 `font-family`

---

## 三、具体改动方案

### 文件 1：`web/src/index.css`

```css
/* 修改前 */
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

/* 修改后 */
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
}
```

影响：全局字体回退，使中文字符在 macOS/Windows 均使用系统优质中文字体。

---

### 文件 2：`web/src/components/editor/Editor.css`

#### 2a — 正文字体栈（`.bn-default-styles`）

```css
/* 修改前 */
.editor-wrap .bn-default-styles {
  font-size: 16px;
  line-height: 1.6;
  color: #37352f;
  font-family: -apple-system, "Segoe UI", sans-serif;
}

/* 修改后 */
.editor-wrap .bn-default-styles {
  font-size: 16px;
  font-weight: 400;
  line-height: 1.5;
  color: #37352f;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
}
```

变更：`line-height 1.6 → 1.5`；补全字体栈。

#### 2b — 正文段落（`.bn-block-content[data-content-type="paragraph"]`）

```css
/* 修改前 */
.editor-wrap .bn-block-content[data-content-type="paragraph"] {
  font-size: 16px;
  line-height: 1.6;
}

/* 修改后 */
.editor-wrap .bn-block-content[data-content-type="paragraph"] {
  font-size: 16px;
  line-height: 1.5;
}
```

#### 2c — 列表行高

```css
/* 修改前（bulletListItem / numberedListItem） */
  line-height: 1.6;

/* 修改后 */
  line-height: 1.5;
```

影响选择器：
- `.editor-wrap .bn-block-content[data-content-type="bulletListItem"]`
- `.editor-wrap .bn-block-content[data-content-type="numberedListItem"]`

#### 2d — 标题改为 em 单位（可选，建议）

```css
/* H1：当前 30px !important → 改为 em（与 BlockNote 变量对齐，更弹性） */
.editor-wrap [data-content-type="heading"][data-level="1"],
.editor-wrap .bn-block-outer[data-prev-type="heading"][data-prev-level="1"] > .bn-block > .bn-block-content {
  font-size: 1.875em !important;  /* 1.875 × 16px = 30px */
  font-weight: 700 !important;
}

.editor-wrap [data-content-type="heading"][data-level="2"],
.editor-wrap .bn-block-outer[data-prev-type="heading"][data-prev-level="2"] > .bn-block > .bn-block-content {
  font-size: 1.5em !important;    /* 1.5 × 16px = 24px */
  font-weight: 600 !important;
}

.editor-wrap [data-content-type="heading"][data-level="3"],
.editor-wrap .bn-block-outer[data-prev-type="heading"][data-prev-level="3"] > .bn-block > .bn-block-content {
  font-size: 1.25em !important;   /* 1.25 × 16px = 20px */
  font-weight: 600 !important;
}
```

同步更新 `.bn-block-content[data-content-type="heading"][data-level="1/2/3"]` 块顶部的 px 声明，统一为 em。

#### 2e — 代码块补全字体栈

```css
/* 修改前 */
.editor-wrap .bn-block-content[data-content-type="codeBlock"] > pre {
  padding: 16px !important;
  font-size: 14px;
  line-height: 1.6;
  color: #37352f;
}

/* 修改后 */
.editor-wrap .bn-block-content[data-content-type="codeBlock"] > pre {
  padding: 16px !important;
  font-size: 0.875em;
  line-height: 1.6;
  color: #37352f;
  font-family: ui-monospace, "SF Mono", "Cascadia Code", "Fira Code",
    "Consolas", "Courier New", monospace;
}
```

#### 2f — 内联代码字体栈扩充（同步）

```css
/* 修改后 */
.editor-wrap .bn-inline-content code {
  ...
  font-family: ui-monospace, "SF Mono", "Cascadia Code", "Fira Code",
    "Consolas", "Courier New", monospace;
}
```

---

### 文件 3：`web/src/components/database/DatabaseView.css`

#### 3a — 单元格正文字号 & 行高

涉及选择器（当前 `13px`，目标 `14px / line-height 1.4`）：

```css
/* 修改选择器：.cell-text-inner, .cell-number-inner, .cell-date-inner, .cell-formula-inner */
font-size: 14px;      /* 13 → 14 */
line-height: 1.4;     /* 新增 */

/* 修改选择器：.cell-input */
font-size: 14px;      /* 13 → 14 */

/* 修改选择器：.db-wrap */
font-size: 14px;      /* 已是 14px，保持不变 */
```

---

## 四、风险评估

| 风险 | 级别 | 说明 | 缓解措施 |
|------|------|------|---------|
| BlockNote 升级后内置字体栈变化 | 低 | 项目用 `.editor-wrap` 前缀覆盖，与 BlockNote 版本解耦 | 保持 `!important` 或更高特异性选择器 |
| `line-height 1.6→1.5` 影响列表视觉紧凑度 | 低-中 | 视觉紧凑，需 QA 验证多行列表项阅读舒适度 | 视觉评审后可还原或调整至 1.55 |
| 数据库单元格 `13px→14px` 导致列宽不足换行 | 低 | 单元格有 `white-space:nowrap` + `text-overflow:ellipsis`，不会换行 | 测试宽列场景 |
| 中文字体栈在 Linux 环境（无 PingFang）下的回退 | 低 | `Noto Sans CJK SC` 覆盖大多数 Linux，最终回退 `sans-serif` | 可接受 |
| 标题 px→em 切换（可选项） | 低 | em 基于 `.bn-default-styles` font-size，若该值被覆盖则级联变化 | 保留 `!important` 防止被覆盖 |

---

## 五、任务拆分

| 子任务 | 文件 | 改动量 | 说明 |
|--------|------|--------|------|
| T1：全局字体栈补全中文 | `index.css` | 1 行 | 最优先，影响全局 |
| T2：编辑器字体栈 + 行高 | `Editor.css` | ~8 处 | 正文、列表、段落 line-height + font-family |
| T3：编辑器代码块字体栈 | `Editor.css` | 2 处 | pre + inline code font-family |
| T4：标题单位 px→em（可选） | `Editor.css` | ~6 处 | 风险最低；若团队偏好保持 px 可跳过 |
| T5：数据库单元格字号+行高 | `DatabaseView.css` | ~4 处 | cell-text/number/date/formula-inner |

建议执行顺序：T1 → T2 → T5 → T3 → T4（T4 可视评审结果决定是否执行）。
