# REQ-053 架构评审 — 附件列 (Files Column)

| 字段 | 内容 |
|------|------|
| REQ | REQ-053 |
| 评审人 | 总架构师 |
| 日期 | 2026-05-01 |
| 状态 | 待确认 |

---

## 一、现有技术基础摘要

| 层 | 关键约束 |
|----|---------|
| 后端上传接口 | `POST /api/uploads` 仅允许 `image/jpeg / image/png / image/gif / image/webp`，响应只返回 `{ url }`，无 `name / size / mime` |
| 前端类型 | `DBColumn.type` 无 `"files"` 枚举；`DBRow.cells` 为 `Record<string, string>`，单元格存字符串 |
| 单元格渲染 | `DatabaseView.tsx` 中通过 `col.type` 的 `if/else` 链分支渲染；`COL_TYPES` 数组驱动列类型选择器；`COL_ICONS` 对象提供图标 |
| 行详情弹窗 | `rowModal` 状态 + `rowModalDraft: Record<string, string>` 草稿；弹窗内按 `col.type` 分支渲染编辑控件；`saveRowModal` 统一提交 |
| 样式 | `DatabaseView.css` 独立文件，已有 `.cell-tag / .cell-empty / .cell-url-wrap` 等 cell 级样式规范 |

---

## 二、方案对比

### 方案 A（推荐）：最小侵入扩展，所有附件 UI 内联于 DatabaseView

**核心思路**

在现有 `DatabaseView.tsx` 的 `col.type` 分支链中新增 `"files"` 分支，附件 UI（上传按钮、文件条目列表、悬停缩略图）直接写在同一文件内的单元格渲染和行详情弹窗区块；后端只扩展 `allowedTypes` 并为响应追加 `name / size / mime` 三个字段；类型定义集中写在 `index.ts`。

**改动范围**

| 文件 | 变更 |
|------|------|
| `server/internal/handler/upload_handler.go` | `allowedTypes` 新增 6 种 MIME；响应 JSON 追加 `name / size / mime` |
| `web/src/types/index.ts` | `DBColumn.type` 联合类型新增 `"files"`；新增 `FileAttachment` 接口 |
| `web/src/components/database/DatabaseView.tsx` | `COL_TYPES / COL_ICONS` 新增 `"files"`；单元格渲染区新增 `files` 分支；行详情弹窗新增 `files` 分支 |
| `web/src/components/database/DatabaseView.css` | 新增附件条目、缩略图 tooltip 相关样式 |

**风险**

- `DatabaseView.tsx` 当前约 1300 行；新增附件逻辑约增加 120–160 行，逼近但不超过单文件 200 行新增上限。须严格控制，超出则触发拆分规则。
- 行详情弹窗改为"附件即存即存"模式（上传/删除直接调 API，不走 `rowModalDraft`），与其他列「保存才提交」语义不一致，需注意代码区分。

**优势**

- 改动高度集中，不引入新文件，符合现有架构惯例（checkbox、select、url、email 均内联于主文件）。
- 列类型注册逻辑（`COL_TYPES` / `COL_ICONS`）一处维护，不存在遗漏注册风险。
- 无跨文件接口契约，不产生新的集成风险。

---

### 方案 B：将附件单元格渲染抽取为独立组件文件

**核心思路**

新建 `web/src/components/database/FilesCell.tsx` 封装附件单元格（表格视图）和 `FilesModalField.tsx` 封装行详情弹窗的附件区域，`DatabaseView.tsx` 只保留调用入口。

**改动范围**

| 文件 | 变更 |
|------|------|
| `server/internal/handler/upload_handler.go` | 同方案 A |
| `web/src/types/index.ts` | 同方案 A |
| `web/src/components/database/DatabaseView.tsx` | 注册 `"files"` 类型；两处分支改为 `<FilesCell>` / `<FilesModalField>` 调用 |
| `web/src/components/database/FilesCell.tsx`（新建） | 单元格渲染 + 上传 + 删除 + 缩略图 tooltip |
| `web/src/components/database/FilesModalField.tsx`（新建） | 行详情弹窗附件管理区域 |
| `web/src/components/database/DatabaseView.css` | 同方案 A（样式仍集中在此文件） |

**风险**

- 引入两个新文件，形成新的跨文件 props 契约：`DatabaseView.tsx` 需向子组件传递 `databaseId / rowId / colId / attachments / onAdd / onDelete` 等，接口设计不当易出现 props drilling。
- 当前其他列类型（select、multi-select、formula）均未抽组件，方案 B 为附件列单独提升，造成渲染架构不统一，未来维护者可能困惑。
- 新增文件增加委派粒度（需额外的工程师任务），交付链更长。

**优势**

- 单文件行数控制更好（各文件明显低于 200 行新增上限）。
- 未来若附件交互复杂化（如拖拽排序、版本管理），组件边界清晰易扩展。

---

## 三、方案对比表

| 维度 | 方案 A（内联） | 方案 B（独立组件） |
|------|-------------|----------------|
| 新增文件数 | 0 | 2 |
| 与现有架构一致性 | 高（遵循所有列类型内联惯例） | 低（孤例抽组件） |
| 新增代码行数 | ~140 行（主文件 +120，CSS +20） | ~50+80+20=150 行（分散） |
| 跨文件接口契约风险 | 无 | 有（props 设计依赖） |
| 文件膨胀风险 | 中（主文件接近限制） | 低 |
| 委派复杂度 | 低 | 高（多出 1–2 个工程师子任务） |
| 适合本期需求规模 | 是 | 过度设计 |

---

## 四、推荐方案

**推荐方案 A（最小侵入内联扩展）**

原因：本期需求改动适中（4 个文件）、附件 UI 与现有列类型渲染模式完全对齐，不引入新文件降低集成风险；当前主文件新增量在 200 行上限内，方案 A 不触发强制拆分规则。方案 B 引入的独立组件在其他列类型均无先例，会造成架构不统一，且对本期功能规模属于过度设计。

---

## 五、后端技术决策

### 上传接口 MIME 扩展策略

现有逻辑先检测文件头字节（`http.DetectContentType`），再回退文件名扩展名。对于非图片 MIME（如 PDF），`http.DetectContentType` 可能返回 `application/octet-stream` 而非精确 MIME，需补充扩展名白名单作为主路径校验（与现有图片回退逻辑对称）。

**具体方案**：将 `allowedTypes` 改为 `mimeToExt` + `extToMime` 双向映射；PDF/docx 等文件走扩展名白名单主路径，图片走字节检测主路径。响应结构从 `{ url }` 扩展为 `{ url, name, size, mime }`（`name` 取 `header.Filename` 保留原始文件名，`size` 从 `header.Size` 取，`mime` 为校验后的最终 MIME）。

### 单元格存储

沿用 REQ-053 数据模型：`JSON.stringify(FileAttachment[])` 写入 `cells[col_id]`，空单元格为 `""` 或 `"[]"`，读取时解析失败降级为空数组（满足场景 12）。

---

## 六、子任务拆分

> 原子任务原则：单文件 + 单职责 + 可独立验收。各任务之间有前置依赖关系，见「前置」列。

| # | 角色 | 任务 | 交付文件 | 验收标准 | 前置 |
|---|------|------|---------|---------|------|
| 1 | 后端模块工程师 | 扩展上传接口：`allowedTypes` 新增 6 种 MIME；响应追加 `name / size / mime` 字段 | `server/internal/handler/upload_handler.go` | 上传 PDF/docx 返回 200 + `{url,name,size,mime}`；上传超 10MB 返回 400；上传不支持类型返回 400 | — |
| 2 | 后端测试人员 | 对 #1 做回归：覆盖场景 8（超限）、场景 10（特殊文件名）、新 MIME 上传、原有图片上传不退化 | `server/internal/handler/upload_handler_test.go`（新增或追加） | 所有测试用例通过，覆盖上述 4 类场景 | #1 |
| 3 | 前端模块工程师 | 前端类型定义：`DBColumn.type` 新增 `"files"`；新增 `FileAttachment` 接口 | `web/src/types/index.ts` | 文件含 `"files"` 枚举值；含 `FileAttachment { url, name, size, mime }` 接口；TypeScript 编译无错误 | — |
| 4 | 前端模块工程师 | 单元格渲染：`COL_TYPES / COL_ICONS` 注册 `"files"`；表格视图 `files` 分支（显示条目列表、+N 折叠、上传按钮、删除按钮、图片缩略图 tooltip、非图片下载）；调用 `POST /api/uploads` 触发上传并写入 cells | `web/src/components/database/DatabaseView.tsx` | 场景 1–6（含折叠、预览、下载、删除）均可操作；场景 9（10 个上限前端拦截）通过；场景 12（JSON 损坏降级）通过；TypeScript 编译无错误 | #1 #3 |
| 5 | 前端测试人员 | 对 #4 单元格渲染做验收：逐条覆盖场景 1–6、8–9、12 | 测试记录（手动验收清单或自动化测试） | 上述场景全部通过，无控制台未捕获异常 | #4 |
| 6 | 前端模块工程师 | 行详情弹窗：`rowModal` 内 `files` 分支（附件列表 + 上传 + 删除，即存即存不走 rowModalDraft）；与表格视图双向同步 | `web/src/components/database/DatabaseView.tsx` | 场景 7（弹窗上传/删除与表格视图双向同步，刷新持久）通过；TypeScript 编译无错误 | #4 |
| 7 | 前端测试人员 | 对 #6 行详情弹窗做验收：覆盖场景 7（上传、删除、刷新持久、双向同步）及场景 11（断网提示） | 测试记录 | 场景 7、11 通过，刷新后数据持久 | #6 |
| 8 | 前端模块工程师 | 样式：附件条目布局、文件图标、+N 折叠标签、缩略图 tooltip（≤200px）、上传/删除按钮悬停态 | `web/src/components/database/DatabaseView.css` | 样式符合需求描述；tooltip 最大宽高 ≤ 200px；移开消失；视觉与现有 cell-tag / cell-url 风格一致 | #4 |
| 9 | 前端测试人员 | 对 #8 样式做视觉验收：缩略图尺寸、折叠标签展示、hover 态 | 测试记录 | 缩略图 ≤ 200px；超 3 个附件显示「+N」；删除/上传按钮 hover 态正常 | #8 |

**并行关系说明**

- #1（后端）与 #3（前端类型）无共享文件，可并行启动。
- #4 和 #6 均修改 `DatabaseView.tsx`，须串行（#6 前置 #4）。
- #8（样式）修改 `DatabaseView.css`，与 #4/#6 修改不同文件，理论上可并行于 #6，但因 #4 完成后样式才有承载结构，建议 #4 交付后再启动 #8。
- 测试任务（#2 / #5 / #7 / #9）各自前置于对应实现任务，不互相依赖，可并行。

---

## 七、风险清单

| # | 风险 | 等级 | 缓解措施 |
|---|------|------|---------|
| R1 | `DatabaseView.tsx` 新增行数若超出 200 行上限需强制拆分 | 中 | 开发前精确估算；若 #4+#6 合计超出，拆附件单元格逻辑为独立 hook（`useFilesCell`）而非独立组件文件 |
| R2 | `http.DetectContentType` 对 PDF 等返回 `application/octet-stream`，导致扩展名校验成为实际主路径 | 低 | 在 #1 中显式补充扩展名-MIME 双向映射，测试覆盖 PDF/docx 上传 |
| R3 | 附件「即存即存」与其他列「草稿暂存」语义不一致，行详情弹窗点「保存」时重复写入 | 低 | #6 中 files 分支不写入 `rowModalDraft`，`saveRowModal` 中跳过 files 列 |
| R4 | 删除附件记录时不删除 `/uploads/` 实体文件（孤儿文件），存储持续增长 | 低（本期已知不在范围内） | REQ-053 已标注不在本期，后续单独跟踪 |
