# REQ-071 架构评审：搜索能力增强（OPT-009）

| 字段 | 内容 |
|------|------|
| 评审 ID | ARCH-REV-071 |
| 版本 | v1.0 |
| 日期 | 2026-05-03 |
| 评审人 | 总架构师 |
| 被评审需求 | REQ-071（搜索增强） |
| 评审结论 | **通过** — FTS5 方案可行，无阻塞性风险 |

---

## 1. 技术可行性

### 1.1 SQLite FTS5 支持确认

`modernc.org/sqlite v1.37.0` 默认编译时包含 FTS5 扩展（通过 `-DSQLITE_ENABLE_FTS5` 编译标志），无需额外依赖。已在同一驱动版本的项目中验证可用。

### 1.2 迁移框架

现有迁移框架位于 `server/internal/db/`，通过 `Migrations` slice 注册版本化迁移（当前最高版本 = 4）。新增版本 5 追加到 `seed.go` 的 `init()` 函数即可，无需改动框架本身。

迁移内容：
- 创建 `pages_fts` / `blocks_fts` FTS5 虚拟表（`content=` 外表模式）
- 为 `pages` / `blocks` 表添加 INSERT / UPDATE / DELETE 触发器
- 一次性填充已有数据（`INSERT INTO pages_fts SELECT rowid, title FROM pages`）
- `blocks_fts` 仅索引文本块，排除 props-as-content 类型（`database`、`subpage`、`fileAttach`、`bookmark`、`embed`、`pdf`、`button`、`columnList`、`column`）

### 1.3 FTS5 content= 模式说明

使用 `content='pages'` / `content='blocks'` 的"外表"（external content）模式：FTS 表本身不存储原始文本，只存索引结构；通过触发器保持与源表同步。优点：减少存储冗余；缺点：需要触发器，`REBUILD` 命令可重建索引。这是 SQLite FTS5 推荐的与现有表集成方式。

---

## 2. 方案决策

### 2.1 搜索 API 改造

替换 `search.go` 中的两个 LIKE 查询，改为 FTS5 MATCH 查询。关键变化：

| 维度 | 旧（LIKE） | 新（FTS5） |
|------|-----------|-----------|
| 排序 | `ORDER BY updated_at DESC` | `ORDER BY rank`（BM25 相关性） |
| 分页 | 无 | `LIMIT ? OFFSET ?` |
| block_id | 无 | 返回匹配块的 `b.id` |
| 特殊字符 | 无需处理 | 需转义 FTS5 查询字符（`"`, `*`, `(`, `)` 等） |

FTS5 查询字符转义：在 Go 层将用户输入逐词拆分后用双引号包裹（`"word1" "word2"`），避免用户输入 `*` / `(` 等特殊字符触发 FTS 语法错误。

### 2.2 跳转定位实现

Editor 组件在 `readyRef.current = true`（内容加载完成）后读取 `sessionStorage.getItem('search_target_block')`。如果存在则调用：

```typescript
const el = document.querySelector(`[data-id="${blockId}"]`);
el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
el?.classList.add('search-highlight');
setTimeout(() => el?.classList.remove('search-highlight'), 800);
```

BlockNote 为每个块的 DOM 元素添加 `data-id` 属性，可安全使用此选择器。

### 2.3 搜索历史

纯前端实现，`localStorage` key `noteyard_search_history`，`string[]` 格式，最多 10 条。不涉及后端 API 变更，与 T2 并行开发。

---

## 3. 风险与注意事项

| # | 风险 | 等级 | 处置 |
|---|------|------|------|
| 1 | FTS5 触发器在批量 `BatchUpdate` 时每行均触发，1000 块的页面保存有额外开销 | 低 | 触发器开销相比网络 RTT 可忽略；单测验证即可 |
| 2 | 已有数据库（旧用户）首次运行版本 5 迁移时，初始填充耗时 | 低 | 254KB 的 DB 毫秒级完成；无需分批 |
| 3 | FTS5 特殊字符（`"`, `(`, `)`, `*`, `^`）若不转义会导致 MATCH 查询报错 | 中 | 后端 Go 层统一转义，单测覆盖场景 13 |
| 4 | `sessionStorage` 跳转定位依赖 Editor 组件挂载后的 DOM，需在 `readyRef = true` 后执行 | 低 | 已在 Editor 现有 `useEffect` 逻辑后追加，timing 可控 |
| 5 | `blocks_fts` 的 `content=` 外表模式：直接修改 `blocks` 表（绕过触发器）会导致索引脏数据 | 低 | 项目内所有写块操作均通过 `BatchUpdate`，触发器覆盖完整 |

---

## 4. 任务边界确认

T1（FTS5 迁移）和 T4（搜索历史）**可以并行启动**，两者无依赖。T2（后端改造）依赖 T1。T3（跳转定位）和 T5（分页）依赖 T2。

所有任务均只改动已有文件，无新文件依赖，风险低。

---

## 5. 结论

方案成熟，无需额外调研。按 REQ-071 任务拆分表直接执行。
