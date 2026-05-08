# REQ-072 架构评审：数据导出（OPT-010）

| 字段 | 内容 |
|------|------|
| 评审 ID | ARCH-REV-072 |
| 版本 | v1.0 |
| 日期 | 2026-05-03 |
| 评审人 | 总架构师 |
| 被评审需求 | REQ-072（数据导出） |
| 评审结论 | **通过** — 纯标准库方案，无外部依赖，低风险 |

---

## 1. 技术可行性

### 1.1 Markdown 转换

BlockNote 块的 `content` 字段为 JSON 序列化的 `InlineContent[]`（StyledText / Link），在 Go 层反序列化后按块类型拼接 Markdown 字符串即可，无需额外库。

嵌套块（toggle、callout、bulletListItem children）通过递归处理，传入缩进深度参数。

### 1.2 ZIP 生成

使用 Go 标准库 `archive/zip` + `io.Pipe` 或直接写 `http.ResponseWriter`：
```go
w.Header().Set("Content-Type", "application/zip")
w.Header().Set("Content-Disposition", `attachment; filename="noteyard-export-2026-05-03.zip"`)
zw := zip.NewWriter(w)
// 逐页写入
zw.Close()
```
无需临时文件，流式写入，对大库友好。

### 1.3 前端触发下载

使用 `window.location.href = url` 或创建隐藏 `<a>` 标签并点击，利用浏览器对 `Content-Disposition: attachment` 的原生处理，无需 Base64 编码或 Blob 操作。

```typescript
function triggerDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.click();
}
```

---

## 2. 方案决策

### 2.1 文件命名去特殊字符

```go
func sanitizeFilename(title string) string {
    re := regexp.MustCompile(`[/\\:*?"<>|]`)
    s := re.ReplaceAllString(title, "-")
    if s == "" { s = "untitled" }
    if len(s) > 80 { s = s[:80] }
    return s
}
```

### 2.2 全库导出文件名去重

ZIP 内文件名格式：`<sanitized_title>-<page_id[:8]>.md`，利用 ID 前缀确保唯一性，即使有同名页面也不冲突。

### 2.3 blocks_fts 与导出无交叉

导出直接读 `blocks` 表，不依赖 FTS 索引，与 REQ-071 无耦合。

### 2.4 database 块处理

`database`、`subpage`、`fileAttach`、`bookmark`、`embed`、`pdf`、`button` 类型输出 `<!-- [type] -->` HTML 注释占位，不展开内容。告知用户此处有不可导出的块。

---

## 3. 风险与注意事项

| # | 风险 | 等级 | 处置 |
|---|------|------|------|
| 1 | 全库导出时 ZIP 流式写入，若写到一半连接断开，ZIP 不完整 | 低 | 标准浏览器下载行为，断开即丢弃，用户重试即可 |
| 2 | 超大库（数万块）ZIP 生成耗时 | 低 | 流式写入无内存堆积问题；Go 标准库性能足够 |
| 3 | 页面标题全部相同（大量"Untitled"）| 低 | 文件名加 ID 前缀，无冲突 |
| 4 | 前端更多菜单位置需确认（sidebar/breadcrumb/页面头部） | 低 | 读现有组件确定位置后插入 |

---

## 4. 任务边界确认

T1（单页导出）和 T2（全库 ZIP）后端顺序执行，T2 直接复用 T1 的 `blockToMarkdown` 函数。T3/T4 前端并行，分别依赖 T1/T2。

---

## 5. 结论

方案成熟，全部使用 Go 标准库，无新依赖。按 REQ-072 任务拆分直接执行。
