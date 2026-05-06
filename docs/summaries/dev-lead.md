# dev-lead 摘要

> 角色: 研发负责人（dev-lead）
> 最后更新: 2026-05-06
> 覆盖需求: REQ-064, REQ-065（CODE-REVIEW-001 修复规划）, REQ-075（本地化日志能力）, ISS-018（动态端口改造）, REQ-080（Go server 固定端口支持）, ISS-034（拖拽手柄不跟随移动）, ISS-035（drop cursor 竖线残留+浮层替换）, ISS-041（⚙ 按钮点击无响应）, REQ-085（网页端+桌面端双模式支持）

---

## 当前规划状态

### REQ-064（前端修复）
- 状态：前端架构师技术方案已完成（✅）
- 产出文件：`docs/review/ARCH-PLAN-FRONTEND.md`（42k）
- 覆盖问题：I-001(P0), I-002(P0), I-003(P0), I-006~I-009(P1), I-011(P1), I-012~I-013(P1), I-016~I-020(P2), I-022(P2)
- Dispatch：#39（delivered）

### REQ-065（后端修复）
- 状态：后端架构师技术方案已完成（✅）
- 产出文件：`docs/review/ARCH-PLAN-BACKEND.md`（18k）
- 覆盖问题：I-004(P0), I-005(P1), I-010(P1), I-014(P1), I-015(P1), I-021(P2)
- Dispatch：#40（delivered）

---

## 架构拆分决策（N2 已确认）

- **前端架构师**：负责 web/src/ 所有问题 + Tauri 集成层（I-011）
- **后端架构师**：负责 server/internal/ 所有问题
- 两路并行，互相独立（零共享状态、零文件交叉）

---

## 关键约束

- **I-005 需前后端对齐**：后端架构师主导输出 filter/sort API 契约，前端架构师参照该契约规划前端删除逻辑
- **I-020 需后端提供接口**：`GET /api/databases` 由后端架构师设计，前端架构师规划调用方
- 本轮（REQ-064/065）：只出技术方案，不写实现代码
- 下轮：研发负责人根据方案委派工程师实现，工程师按角色独立提交

---

## 关键文件路径

| 文件 | 说明 |
|------|------|
| `docs/requirements/REQ-064.md` | 前端修复需求文档 |
| `docs/requirements/REQ-065.md` | 后端修复需求文档 |
| `docs/review/CODE-REVIEW-001.md` | 源审查报告（22 条问题） |
| `docs/review/ARCH-PLAN-FRONTEND.md` | 前端架构师技术方案（待产出） |
| `docs/review/ARCH-PLAN-BACKEND.md` | 后端架构师技术方案（待产出） |
| `docs/tasks/REQ-064-arch-frontend-checklist.toml` | 前端架构师任务清单 |
| `docs/tasks/REQ-065-arch-backend-checklist.toml` | 后端架构师任务清单 |

---

## Dispatch 历史（本 REQ 相关）

| Dispatch ID | REQ | 委派方 | 被委派方 | 状态 |
|-------------|-----|--------|---------|------|
| #38 | REQ-063 | 总负责人 → 研发负责人 | 总架构师 | ✅（CODE-REVIEW-001 已完成） |
| #39 | REQ-064 | 研发负责人 | 前端架构师 | ✅（已交付）|
| #40 | REQ-065 | 研发负责人 | 后端架构师 | ✅（已交付）|

---

## REQ-075（日志基础设施，2026-05-04）

- 状态：全部完成（✅）
- 委派链：总架构师技术评审（#144）→ N2 → eng-backend（#145）+ eng-tauri（#146）并行 → eng-frontend（#147）串行
- 产出文件：
  - `docs/architecture/REQ-075-review.md`（架构评审，含模块列表：log-go/log-frontend/log-tauri）
  - `server/internal/log/log.go`（Init + lumberjack）
  - `server/internal/handler/log_handler.go`（POST /api/log）
  - `web/src/lib/logger.ts`（前端日志模块）
  - `src-tauri/src/lib.rs`（tauri-plugin-log 注册 + --log-dir 传参）
  - `ai-pro/docs/knowledge/logging-tauri-app.md`（工程规范沉淀）
  - `ai-pro/docs/engineering/NEW-PROJECT.md`（日志检查项更新）
- 并行执行线：Go 线（T1→T4）、Rust 线（T2）、前端线（T3→T5）
- 沉淀：ai-pro logging-tauri-app.md + NEW-PROJECT.md 在 eng-backend 阶段同步完成

---

## ISS-018（动态端口改造，2026-05-04）

- 状态：全部完成（✅）
- 委派链：arch 技术评审（#150）→ N2 → eng-tauri（#151）+ eng-backend（#152）并行 → eng-frontend（#153）串行
- 产出文件：
  - `docs/architecture/ISS-018-review.md`（架构评审，三层设计方案）
  - `src-tauri/src/lib.rs`（pick_free_port + PortState + get_port command）
  - `server/cmd/main.go`（--port flag，动态 addr 和 UploadHandler base URL）
  - `web/src/api/client.ts`（API_BASE let + setApiBase）
  - `web/src/lib/logger.ts`（引用 API_BASE）
  - `web/src/components/settings/SettingsPage.tsx`（引用 API_BASE）
  - `web/src/main.tsx`（bootstrap invoke get_port）
- 关键设计：Rust 层 TcpListener::bind(0) 分配空闲端口，通过 --port 传给 sidecar，通过 get_port command 暴露给前端
- 硬编码 8080 全部消除（Go/Rust/前端）

---

## REQ-080（Go server 固定端口支持，2026-05-05）

- 状态：全部完成（✅）
- 委派链：eng-backend（#174）+ eng-tauri（#175）并行 → tester（#177）
- 产出文件：
  - `server/cmd/main.go`（--port 参数：不传随机端口，非法端口验证，net.Listen 预绑定）
  - `src-tauri/src/lib.rs`（已在 ISS-018 完成，本次验证无需修改）
  - `docs/requirements/features/REQ-080.md`（状态改为已完成）
- 关键设计：flag.Visit 判断 --port 是否显式传入；net.Listen(":0") → OS 随机分配；非法端口（<1 或 >65535）立即 os.Exit(1)
- FR-2（Tauri 传端口）已在 ISS-018 完成，本次仅验证确认

---

## ISS-034（拖拽手柄不跟随移动，2026-05-05）

- 状态：统筹进行中（前端架构师根因分析 pending）
- 委派链：前端架构师根因分析（#183）→ dev-lead-续1（#184，prereqs=183）→ 工程师修复 → 测试执行者回归
- 关键排查方向：ISS-032 onDragOver 回归、SideMenuPlugin blockDragStart 调用链、Tauri WKWebView 兼容性、ISS-033 logger 动态 import 时序
- 续任务：dev-lead-续1（#184）在根因分析完成后负责委派工程师和测试执行者

---

## ISS-035（drop cursor 竖线松手后未消失 + 浮层替换，2026-05-05）

- 状态：统筹规划完成（#185 delivered），前端架构师根因分析 + 方案设计 pending（#186）
- 委派链：前端架构师根因分析+方案设计（#186）→ dev-lead-续1（#187，prereqs=186）→ 工程师实现 → 测试执行者回归
- 端属性：仅前端（Editor.tsx `dropCursor` 配置，`@blocknote/xl-multi-column` MultiColumnDropCursorPlugin）
- 关键排查方向：
  - dragDropEnabled:false（ISS-034 修复）后 wry 不触发 drop 事件，ProseMirror drop handler 未执行，cursor 清除逻辑未触发
  - multiColumnDropCursor 仅支持竖线（position:absolute cursor element），需替换 setCursor 逻辑实现半边/整行浮层
- 交付要求：松手后浮层立即消失；左/右边缘→半边浮层；上/下位置→整行浮层；tsc --noEmit 零错误

---

## ISS-041（⚙ 设置按钮点击无响应，2026-05-05）

- 状态：已修复（✅）
- 模块：frontend/editor
- 根因：ProseMirror 在 view.dom 注册原生 mousedown 并调用 stopPropagation()，React 合成事件未收到，⚙ 按钮 onMouseDown 不触发；ISS-040 修复了面板内交互但未覆盖触发按钮本身
- 修复：settingsBtnRef + native addEventListener 拦截 mousedown；outside-click 守卫排除按钮自身点击防止面板重开
- 产出文件：`web/src/components/editor/Editor.tsx`
- Commit：`816acb8`（fix）、`5e52613`（docs）
- Dispatch：#202（delivered）

---

## REQ-085（网页端+桌面端双模式支持，2026-05-06）

- 状态：架构评审中（前端架构师 #239 + 后端架构师 #240 并行，N2 待触发）
- 变更模块：frontend（vite.config.ts proxy + main.tsx VITE_API_BASE）+ backend（Makefile server-dev --port 8080）
- tauri 模块不变（动态端口注入方式保持现有设计）
- 委派链：dev-lead（#238）→ 并行 arch-frontend（#239）+ arch-backend（#240）→ N2 → 工程师实现 → 测试 → N3

---

## 上次变更摘要（2026-05-06）

REQ-085 规划：并行委派前端架构师（#239）和后端架构师（#240）评审双模式支持方案。变更范围小（3个文件），tauri 模块不动。
