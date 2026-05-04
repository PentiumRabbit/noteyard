# Issues

## ISS-016: 数据库单选/多选交互体验不符合预期（点击切换）

| 字段 | 内容 |
|------|------|
| Issue ID | ISS-016 |
| 严重程度 | P2 |
| 状态 | 待修复 |
| 指派给 | 研发负责人 |

点击单元格后下拉面板弹出，但选项交互不直观。需对标 Notion：点击选项直接切换选中/取消，多选不自动关闭面板，单选点击后关闭，下拉内提供"添加新选项"快捷入口。

---

## ISS-015: 数据库表格单选/多选字段无法编辑

| 字段 | 内容 |
|------|------|
| Issue ID | ISS-015 |
| 严重程度 | P2 |
| 状态 | 待修复 |
| 指派给 | 研发负责人 |

点击数据库表格中单选（select）或多选（multi-select）单元格时，下拉菜单不弹出或无法交互，无法完成字段编辑。同类可编辑字段（date、number、status）需一并排查。

---

## ISS-010: 应用内无默认使用说明/引导内容

| 字段 | 内容 |
|------|------|
| Issue ID | ISS-010 |
| 严重程度 | P2 |
| 状态 | 开放 |
| 指派给 | 研发负责人 |

首次打开应用，侧边栏和编辑区为空，无任何引导页、欢迎页或示例内容，用户不知道如何开始。

---

## ISS-009: 应用图标只显示白色圆角方块，无橙色 N 字

| 字段 | 内容 |
|------|------|
| Issue ID | ISS-009 |
| 严重程度 | P1 |
| 状态 | 开放 |
| 指派给 | 研发负责人 |

macOS Dock 中图标仅显示白色圆角方块，橙色斜体 N 字未出现。icon.icns/icon.png 文件本身 RGBA 正确，binary 已重新编译，怀疑 N 字笔划在图标生成脚本中存在问题或 tauri icon 转换时丢失内容。

---

## ISS-003: Columns block 仍崩溃（columnCellSchema 循环引用）

| 字段 | 内容 |
|------|------|
| Issue ID | ISS-003 |
| 严重程度 | P1 |
| 状态 | ✅ 已修复 |
| 指派给 | 总架构师 |

**标题**: ISS-002 修复后 columns block 仍崩溃，columnCellSchema 与 ColumnsBlock 存在循环引用

**复现步骤**:
1. 打开编辑器
2. 插入 columns 块

**实际结果**: `Uncaught TypeError: Cannot read properties of undefined (reading 'type')` at BlockNote 内部 `Cr2` 组件

**预期结果**: columns block 正常渲染

**根因分析**: `columnCellSchema`（Editor.tsx:591）blockSpecs 中注册了 `columns: ColumnsBlock`（行599），mini-editor 初始化时 BlockNote 对 ColumnsBlock 注册 nodeView，触发 `getBlockFromPos` 在 mini-editor doc 中查找主编辑器的块 ID，返回 undefined，导致 `s.type` TypeError。

**修复方案**: 
- 当前修复（方案 A）：从 `columnCellSchema` 中删除 `columns: ColumnsBlock` 一行
- 长期方案（方案 C）：迁移至 BlockNote 原生 columnList/column 架构，见 REQ-052

---

## ISS-002: Columns block 崩溃 + 不支持子块类型

| 字段 | 内容 |
|------|------|
| Issue ID | ISS-002 |
| 严重程度 | P1 |
| 状态 | ✅ 已修复 |
| 指派给 | 总架构师 |

**标题**: Columns block 使用时崩溃，且列内无法插入任意块类型

**复现步骤**:
1. 在编辑器中插入 columns 块
2. 在列内尝试输入内容或使用斜杠菜单插入子块

**实际结果**: 控制台报错 `Cannot read properties of undefined (reading 'type')`，页面崩溃；列内只能输入纯文本，无法插入其他块类型

**预期结果**: columns 块稳定渲染，列内可插入任意块类型（heading、list、code block 等）

**根因分析**: 待总架构师分析

**修复方案**: 方案 A — 最小修复（当前实施）

1. `Editor.tsx:239`：`render: ({ block, updateBlock })` → `render: ({ block, editor })`
2. `Editor.tsx:254,258`：`updateBlock(...)` → `editor.updateBlock(block, ...)`
3. `Editor.tsx:343`：mini-editor schema 扩展为完整自定义块集合，斜杠菜单过滤 `columns` 类型防递归嵌套

改动范围：`web/src/components/editor/Editor.tsx` 一个文件
风险：低

**技术债（待排期）**: 方案 B — 架构迁移至 BlockNote 原生 columnList/column 结构

当前方案 A 的结构性问题：每列是独立 mini-editor 实例，列数据序列化进 `columnsData` prop，schema/uploadFile 等上下文需手动同步，undo/redo 无法感知列内变更。

方案 B 核心：改用 BlockNote 原生 `columnList`/`column` ProseMirror 节点，列内容成为文档树一部分，所有能力自动继承。
改动范围：Editor.tsx 重写 ColumnsBlock + toBlockNote.ts 适配 + 后端 children 结构支持 + 已有 columnsData 数据迁移。

---

## ISS-001: 切换页面时编辑内容丢失

| 字段 | 内容 |
|------|------|
| Issue ID | ISS-001 |
| 严重程度 | P1 |
| 状态 | ✅ 已修复 |
| 修复版本 | v0.1.0 前 |
| 指派给 | 研发负责人 |

**标题**: 切换页面时编辑内容丢失，自动保存未可靠生效

**复现步骤**:
1. 创建页面 A，输入内容
2. 800ms 内切换到页面 B
3. 切回页面 A

**实际结果**: 页面 A 内容丢失

**预期结果**: 内容自动保存，切换后内容保留

**根因分析**:
1. `BatchUpdate` 只做 `UPDATE`，新建页面块从未 `INSERT`，`UPDATE` 找不到行，静默失败
2. 防抖 800ms timer 在页面切换时被 React unmount 丢弃，`save()` 从未执行
3. `beforeunload` 使用 `fetch`，浏览器卸载时异步请求被截断

**修复方案**:
1. 服务端 `BatchUpdate` 改为 `INSERT OR REPLACE`（upsert）
2. Editor unmount 时同步 flush 未保存内容
3. 防抖从 800ms 延长至 1s，更自然
4. 额外加 30s 定时兜底保存
5. `beforeunload` 改用 `sendBeacon`，不会被浏览器截断
6. App 层持有 flush ref，切换页面前主动调用

**修复 commits**: 96f48cb（upsert）、79473d1（batchUpdateBeacon）、4a42d5c（flush+防抖+兜底）

---

## ISS-004: column 空内容导致编辑器崩溃

| 字段 | 内容 |
|------|------|
| Issue ID | ISS-004 |
| 严重程度 | P1 |
| 状态 | ✅ 已修复 |
| 修复版本 | v0.1.19 |
| 指派给 | 前端工程师 |

**标题**: 含空 column 的 columnList 页面打开时编辑器崩溃，内容全部丢失

`toBlockNote.ts` 反序列化 columnList 时，若某列无子块（colChildren 为空），BlockNote ProseMirror schema 要求 column 节点至少有一个子节点，传入空数组导致 `RangeError: Invalid content for node column: <>`，整个 `replaceBlocks` 失败。

**修复**: `colChildren` 为空时补充空段落占位块（`safeChildren` 逻辑，`toBlockNote.ts` 第 26-28 行），经 REQ-079 T01 验证有效。

---

## ISS-027: 数据库视图公式弹窗超出视口，编辑公式功能表现消失

| 字段 | 内容 |
|------|------|
| Issue ID | ISS-027 |
| 严重程度 | P1 |
| 状态 | ✅ 已修复 |
| 修复版本 | v0.1.17 |
| 指派给 | 前端工程师 |

**标题**: formula 列列头菜单「编辑公式」点击后弹窗渲染在视口外，不可见

ISS-023 修复弹窗定位时遗漏了 `openFormulaPopover`，仍使用 `y: rect.bottom + 4` 硬编码。修复将其替换为 `getPopoverY(rect)`，实现视口感知的自动向上/向下展开。

**修复 commit**: f522179

