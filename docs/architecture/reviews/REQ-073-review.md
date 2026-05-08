# REQ-073 架构评审：Markdown 导入（OPT-011）

| 字段 | 内容 |
|------|------|
| 评审 ID | ARCH-REV-073 |
| 版本 | v1.0 |
| 日期 | 2026-05-03 |
| 评审人 | 总架构师 |
| 被评审需求 | REQ-073（Markdown 导入） |
| 评审结论 | **通过** — goldmark AST 方案可行，风险低 |

---

## 1. 技术可行性

### 1.1 Markdown 解析库选型

选用 `github.com/yuin/goldmark`：
- Go 生态事实标准，CommonMark 规范兼容
- 提供完整 AST，遍历节点类型明确
- 支持 GFM 扩展（task list、strikethrough）通过 `goldmark-extension` 包
- MIT 许可证

替代方案 `github.com/russross/blackfriday/v2` 不提供 AST 遍历（只有 HTML 输出），排除。

### 1.2 AST 遍历策略

goldmark 的 `ast.Walk` 函数以回调方式遍历节点树，`entering bool` 参数区分进入/退出。对于块级节点（Paragraph、Heading、List 等）在 `entering=true` 时收集块，在 `entering=false` 时 flush。内联节点在遍历内层时递归收集 InlineContent。

### 1.3 块插入策略

逐块调用 `BlockRepository.Create`，每块赋一个递增的 `order_index`（0, 1, 2...）。不需要事务包裹（单块 create 失败概率极低，且导入场景可重试），简化实现。

### 1.4 文件大小限制

`http.MaxBytesReader(w, r.Body, 5<<20)` 在解析 multipart 前设置，超过 5MB 返回 413。

---

## 2. 方案决策

### 2.1 嵌套列表简化

本期只处理顶层 ListItem，不递归子列表。goldmark AST 中嵌套列表是 `List` 节点作为 `ListItem` 的子节点；跳过子 `List` 节点即可实现此限制，不影响其他功能。

### 2.2 图片链接处理

Markdown 中的 `![alt](url)` 导入为 `image` 块，props 中 `url` 保留原始 URL（可能是外链）。不做图片下载或转存，行为与 Notion 导入类似。

### 2.3 页面标题来源

优先取文件名（去 `.md` 后缀）作为页面标题，而非解析 Markdown 中的第一个 `# 标题`。原因：
1. 用户上传时文件名是显式意图
2. 避免与 Markdown 内第一个 `#` 块重复
3. 简化逻辑

### 2.4 goldmark 扩展启用

```go
md := goldmark.New(
    goldmark.WithExtensions(
        extension.GFM,        // task list + strikethrough + table
        extension.Strikethrough,
    ),
)
```

`extension.GFM` 包含 TaskList、Strikethrough、Table、Autolink。本期不处理 Table 节点（跳过即可，不报错）。

---

## 3. 风险与注意事项

| # | 风险 | 等级 | 处置 |
|---|------|------|------|
| 1 | goldmark 尚未在 go.mod 中，需 go get | 低 | 标准 `go get`，MIT 许可证无问题 |
| 2 | 嵌套列表跳过，用户导入 Obsidian 多层列表时子项丢失 | 低 | 已在需求范围说明中标注，本期限制 |
| 3 | 超大 Markdown（数千块）逐块 Create 调用多次 DB insert | 低 | 5MB 上限约 5 万行，单次 insert 微秒级，总耗时 < 1s |
| 4 | 文件名含非 ASCII 字符（中文等）作为页面标题 | 低 | Go 原生 UTF-8，无问题 |

---

## 4. 结论

方案成熟，goldmark 是 Go 最主流的 Markdown 解析库，AST 遍历路径清晰。按 REQ-073 任务拆分直接执行。
