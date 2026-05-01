# Issues

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
| 状态 | 修复中 |
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
