# REQ-066 需求确认文档 — PM 产出

| 字段 | 内容 |
|------|------|
| REQ ID | REQ-066 |
| PM | 产品经理-REQ066-53 |
| DISPATCH ID | #53 |
| 日期 | 2026-05-02 |
| 状态 | 需求确认完成，待 N1 汇报 |

---

## 一、需求摘要

在 `ai-pro` 规范体系中新增「前端架构师（arch-frontend）」和「后端架构师（arch-backend）」两个专项架构师角色，同时收窄总架构师（arch）的职责范围，将单端审查/方案设计工作移交给专项角色。

---

## 二、实施边界确认

### 2.1 需要新建的文件

| 文件路径 | 说明 |
|---------|------|
| `ai-pro/docs/engineering/rules/arch-frontend.md` | 前端架构师角色规则，角色标签 `[arch-frontend]` |
| `ai-pro/docs/engineering/rules/arch-backend.md` | 后端架构师角色规则，角色标签 `[arch-backend]` |
| `noteyard/docs/summaries/arch-frontend.md` | 前端架构摘要（基于 CODE-REVIEW-001 + ARCH-PLAN-FRONTEND.md） |
| `noteyard/docs/summaries/arch-backend.md` | 后端架构摘要（基于 CODE-REVIEW-001 + ARCH-PLAN-BACKEND.md） |

### 2.2 需要更新的文件

| 文件路径 | 变更内容 |
|---------|---------|
| `ai-pro/docs/engineering/TEAM.md` | 新增 §3.7a 前端架构师、§3.7b 后端架构师的角色定义；总架构师（§3.7）职责收窄为「跨层架构决策、接口契约仲裁、全局技术方向」 |
| `ai-pro/docs/engineering/DELEGATION.md` | 架构师委派选择逻辑更新：单端任务 → 专项架构师；跨层决策 → 总架构师；研发负责人执行路径模板（模板 4）补充选择规则 |
| `ai-pro/docs/engineering/templates/delegation-templates.md` | 新增模板：前端架构师委派模板、后端架构师委派模板（基于现有模板 5 总架构师模板格式） |

### 2.3 总架构师与专项架构师共存规则

| 场景 | 委派对象 |
|------|---------|
| 仅涉及前端（web/src/、Tauri 集成） | 前端架构师（arch-frontend） |
| 仅涉及后端（server/internal/） | 后端架构师（arch-backend） |
| 涉及前后端接口契约、数据格式定义、跨层技术决策 | 总架构师（arch） |
| 前后端均需独立评审 + 跨层仲裁 | 先并行启动前端/后端架构师，后由总架构师汇总仲裁 |

**总架构师不再承接**：单端组件设计、单端代码审查、单端性能/重构方案。

### 2.4 DELEGATION.md 委派链调整

研发负责人在收到任务后，判断路径新增一步：

```
研发负责人 → 判断任务端属性
  ├─ 仅前端 → 前端架构师（arch-frontend）
  ├─ 仅后端 → 后端架构师（arch-backend）
  ├─ 跨层 → 总架构师（arch）
  └─ 前后端均需 → 前端架构师 + 后端架构师（并行），最终由总架构师汇总
```

N2 汇报节点的「架构师委派强制规则」中，"总架构师"改为"总架构师（或前端/后端架构师）"——此条已在 DELEGATION.md §三中预先写入，只需确认措辞与新规则一致。

---

## 三、不在本 REQ 范围

1. 不修改 REQ-064/REQ-065 执行中任务
2. 不废弃总架构师角色
3. 不改变 N1/N2/N3 节点机制
4. 不涉及测试角色、PM、模块工程师的规则

---

## 四、场景矩阵

| # | 维度 | 场景 | 预期行为 |
|---|------|------|---------|
| 1 | 新建文件 | arch-frontend.md 已创建 | 包含角色标签、职责范围（web/src/ + Tauri 集成层）、禁止行为、N2 汇报前必产出 frontend-review.md |
| 2 | 新建文件 | arch-backend.md 已创建 | 包含角色标签、职责范围（server/internal/）、禁止行为、N2 汇报前必产出 backend-review.md |
| 3 | TEAM.md 更新 | 总架构师职责边界 | 职责聚焦「跨层决策、接口契约仲裁」，明确不再承接单端审查 |
| 4 | TEAM.md 更新 | 新角色条目存在 | 前端架构师、后端架构师有独立角色定义，含汇报对象（研发负责人）、核心职责、输出物 |
| 5 | DELEGATION.md 更新 | 研发负责人委派路径 | 含端属性判断分支；单端 → 专项架构师；跨层 → 总架构师；模板 4 已更新 |
| 6 | 委派模板更新 | 前端架构师委派模板 | 含 role_key = arch-frontend、评估范围（组件/状态/工具函数/Tauri）、输出物路径 |
| 7 | 委派模板更新 | 后端架构师委派模板 | 含 role_key = arch-backend、评估范围（handler/repository/model/config）、输出物路径 |
| 8 | 摘要文件 | arch-frontend.md 摘要 | 基于 ARCH-PLAN-FRONTEND.md，覆盖前端当前架构要点、关键文件路径、重要约束 |
| 9 | 摘要文件 | arch-backend.md 摘要 | 基于 ARCH-PLAN-BACKEND.md，覆盖后端当前架构要点、关键文件路径、重要约束 |
| 10 | 共存规则 | 跨层任务（如新 API 接口） | 研发负责人委派总架构师，不委派专项架构师 |
| 11 | 共存规则 | 纯前端任务（如组件重构） | 研发负责人委派前端架构师，不再委派总架构师 |
| 12 | 规则文件格式 | arch-frontend.md / arch-backend.md 格式 | 与现有 rules/arch.md 格式一致（角色标签注释 + 强制规则列表） |

---

## 五、验收标准

- [ ] `ai-pro/docs/engineering/rules/arch-frontend.md` 已创建，包含角色标签、职责范围、禁止行为
- [ ] `ai-pro/docs/engineering/rules/arch-backend.md` 已创建，包含角色标签、职责范围、禁止行为
- [ ] `ai-pro/docs/engineering/TEAM.md` 中前端/后端架构师条目存在，总架构师职责已收窄
- [ ] `ai-pro/docs/engineering/DELEGATION.md` §三架构师委派规则已更新，含端属性判断逻辑
- [ ] `ai-pro/docs/engineering/templates/delegation-templates.md` 已新增前端/后端架构师委派模板
- [ ] `noteyard/docs/summaries/arch-frontend.md` 已产出并 git commit
- [ ] `noteyard/docs/summaries/arch-backend.md` 已产出并 git commit

---

## 六、交付物清单（按任务划分）

### T1 — 规范文档（ai-pro 工程，委派给：总架构师）

| # | 文件 | 操作 |
|---|------|------|
| T1-1 | `ai-pro/docs/engineering/rules/arch-frontend.md` | 新建 |
| T1-2 | `ai-pro/docs/engineering/rules/arch-backend.md` | 新建 |
| T1-3 | `ai-pro/docs/engineering/TEAM.md` | 更新 §3.7 + 新增 §3.7a/§3.7b |
| T1-4 | `ai-pro/docs/engineering/DELEGATION.md` | 更新 §三 + 委派选择逻辑 |
| T1-5 | `ai-pro/docs/engineering/templates/delegation-templates.md` | 新增模板 |

### T2 — 摘要初始化（noteyard 工程，委派给：前端架构师 + 后端架构师）

| # | 文件 | 素材来源 |
|---|------|---------|
| T2-1 | `noteyard/docs/summaries/arch-frontend.md` | `noteyard/docs/review/CODE-REVIEW-001.md`（前端部分）+ `ARCH-PLAN-FRONTEND.md` |
| T2-2 | `noteyard/docs/summaries/arch-backend.md` | `noteyard/docs/review/CODE-REVIEW-001.md`（后端部分）+ `ARCH-PLAN-BACKEND.md` |

---

## 七、可复用组件/公共逻辑识别

- `rules/arch-frontend.md` 和 `rules/arch-backend.md` 的格式高度相似，可参考 `rules/arch.md` 作为模板，两者结构对称
- 无需提取新公共逻辑，属于文档规范扩展

---

## 八、备注

- REQ-066.md 需求文档已完整定义于 `/Users/pr/Work/GitSource/noteyard/docs/requirements/tech/REQ-066.md`，本文档为 PM 的需求确认层，补充实施边界和场景矩阵
- T2 摘要素材（CODE-REVIEW-001、ARCH-PLAN-FRONTEND、ARCH-PLAN-BACKEND）均已存在于 `noteyard/docs/review/`，可直接读取
- 本 REQ 不涉及代码变更，全部为文档规范变更，无需测试角色介入
