# noteyard 模块角色分配

> 版本: 1.0　更新日期: 2026-05-05　制定人: dev-lead

---

## 模块树

> **命名规则**：`{父模块}-{子模块}-…-{角色}-{编号}`，名字本身即上报链。
> 例：`fe-editor-lead` 的上级是 `fe-lead`，`fe-lead` 的上级是 `dev-lead`。

```
研发负责人: dev-lead
├── frontend
│     模块组长:   fe-lead
│     模块架构师: fe-arch
│     模块工程师: fe-eng-1 / fe-eng-2
│     ├── frontend/editor        （web/src/components/editor）
│     │     模块组长:   fe-editor-lead
│     │     模块架构师: fe-editor-arch
│     │     模块工程师: fe-editor-eng-1
│     ├── frontend/sidebar       （web/src/components/sidebar）
│     │     模块组长:   fe-sidebar-lead
│     │     模块架构师: fe-sidebar-arch
│     │     模块工程师: fe-sidebar-eng-1
│     └── frontend/settings      （web/src/components/settings + stores/settings）
│           模块组长:   fe-settings-lead
│           模块架构师: fe-settings-arch
│           模块工程师: fe-settings-eng-1
│
├── backend
│     模块组长:   be-lead
│     模块架构师: be-arch
│     模块工程师: be-eng-1
│     ├── backend/handler        （server/internal/handler）
│     │     模块组长:   be-handler-lead
│     │     模块架构师: be-handler-arch
│     │     模块工程师: be-handler-eng-1
│     └── backend/repository     （server/internal/repository）
│           模块组长:   be-repo-lead
│           模块架构师: be-repo-arch
│           模块工程师: be-repo-eng-1
│
└── tauri
      模块组长:   tauri-lead
      模块架构师: tauri-arch
      模块工程师: tauri-eng-1
```

---

## 递归终止条件（模块组长判断）

满足任一条，不再向下设子模块组长：
- 子模块单人可直接执行
- 子模块数 ≤ 1 个工程师可独立完成
- 用户明确指定不需要继续拆分

拆分上限（强制）：
- 同一层级子模块数不得超过 6 个；超出须先归组再拆分

---

## 变更记录

| 日期 | 变更内容 | 裁决人 |
|------|---------|--------|
| 2026-05-05 | 初始制定 | dev-lead |
